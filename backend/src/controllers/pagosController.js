import Stripe from 'stripe';
import { query } from '../config/db.js';
import { aCentimos, formatearEuros, lineasParaStripe, MINIMO_STRIPE_CENTIMOS } from '../utils/importesStripe.js';

// Inicialización condicional y tolerante (Feature Flag)
const stripeKey = process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.trim() : null;
const stripe = stripeKey ? new Stripe(stripeKey) : null;

if (!stripe) {
  console.log('ℹ️ [Stripe] Pasarela de pagos inactiva (STRIPE_SECRET_KEY no configurada). Métodos tradicionales activos.');
} else {
  console.log('💳 [Stripe] Pasarela de pagos inicializada en modo activo.');
}

/**
 * Expira una sesión de Checkout para que ya no se pueda pagar (por ejemplo, al cobrar
 * el pedido en caja). Si falla (no existe, ya no está abierta o Stripe no responde),
 * lo registra y devuelve false: quien llama decide si sigue.
 */
export async function expirarSesionStripe(sessionId, pedidoId) {
  if (!stripe || !sessionId) return false;
  try {
    await stripe.checkout.sessions.expire(sessionId);
    console.log(`🔒 [Stripe] Sesión ${sessionId} del pedido #${pedidoId} expirada.`);
    return true;
  } catch (error) {
    console.warn(`⚠️ [Stripe] No se pudo expirar la sesión ${sessionId} del pedido #${pedidoId}: ${error.message}`);
    return false;
  }
}

/** Indica si un error de Stripe significa que la sesión no existe (y no un fallo de red o de Stripe). */
const esSesionInexistente = (error) => error?.code === 'resource_missing' || error?.statusCode === 404;

/** Indica si una sesión de Checkout es del pedido (client_reference_id o metadata.pedido_id). */
const sesionDelPedido = (session, pedidoId) =>
  [session.client_reference_id, session.metadata?.pedido_id].some(
    (valor) => valor !== null && valor !== undefined && String(valor) === String(pedidoId)
  );

/**
 * Marca un pedido como pagado por una sesión de Stripe. Es idempotente y detecta el
 * cobro doble: si el pedido ya estaba pagado con otra sesión (o en caja), no cambia
 * nada y lo deja registrado en el log con el pedido y las dos sesiones.
 * Devuelve 'marcado', 'ya_pagado', 'segundo_pago' o 'no_existe'.
 */
async function marcarPedidoPagado(pedidoId, sessionId, origen) {
  const id = parseInt(pedidoId, 10);
  const actualizado = await query(
    `UPDATE pedidos
     SET estado_pago = 'pagado',
         stripe_session_id = $1
     WHERE id = $2 AND estado_pago IS DISTINCT FROM 'pagado'
     RETURNING id`,
    [sessionId, id]
  );
  if (actualizado.rowCount > 0) {
    console.log(`✅ [Stripe ${origen}] Pedido #${id} marcado como PAGADO (sesión ${sessionId}).`);
    return 'marcado';
  }

  const previo = await query('SELECT stripe_session_id, metodo_pago FROM pedidos WHERE id = $1', [id]);
  if (previo.rowCount === 0) {
    console.warn(`⚠️ [Stripe ${origen}] La sesión ${sessionId} es del pedido #${id}, que no existe.`);
    return 'no_existe';
  }

  const { stripe_session_id: sesionGuardada, metodo_pago: metodoPago } = previo.rows[0];
  if (sesionGuardada === sessionId && metodoPago === 'stripe') {
    return 'ya_pagado'; // Mismo pago notificado otra vez (reintento del webhook, sondeo...)
  }

  console.warn(
    `🚨 [Stripe ${origen}] Posible cobro doble del pedido #${id}: ya estaba pagado ` +
      `(metodo_pago ${metodoPago}, sesión guardada ${sesionGuardada || 'ninguna'}) y Stripe confirma ` +
      `el pago de la sesión ${sessionId}. No se cambia nada; revisa el reembolso en Stripe.`
  );
  return 'segundo_pago';
}

/**
 * Consulta el estado de configuración de la pasarela Stripe (útil para diagnóstico en clase)
 */
export const getConfigStatus = (req, res) => {
  res.json({
    success: true,
    stripe_configured: Boolean(stripe),
    webhook_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    frontend_url: process.env.FRONTEND_URL || null,
  });
};

/**
 * Crear una sesión de Stripe Checkout para un pedido existente
 */
export const crearSesionCheckout = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: 'La pasarela de pagos Stripe no está configurada en este servidor. Por favor, selecciona Pago en Efectivo o Datáfono.',
      });
    }

    const { pedido_id } = req.body;

    if (!pedido_id) {
      return res.status(400).json({
        success: false,
        message: 'Falta el parámetro pedido_id',
      });
    }

    // 1. Obtener los datos del pedido de la base de datos
    const pedidoRes = await query('SELECT * FROM pedidos WHERE id = $1', [pedido_id]);
    if (pedidoRes.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: `El pedido #${pedido_id} no existe`,
      });
    }

    const pedido = pedidoRes.rows[0];

    if (pedido.estado_pago === 'pagado') {
      return res.status(400).json({
        success: false,
        message: `El pedido #${pedido_id} ya fue pagado anteriormente`,
      });
    }

    // Un pedido cancelado no se cobra (hallazgo 7): ni siquiera se llama a Stripe
    if (pedido.estado === 'cancelado') {
      return res.status(409).json({
        success: false,
        message: `El pedido #${pedido_id} está cancelado y no se puede cobrar`,
      });
    }

    // 2. Obtener las líneas del pedido con los nombres de las pizzas
    const lineasRes = await query(`
      SELECT lp.id, lp.cantidad, lp.precio_unitario, lp.notas, pz.nombre
      FROM lineas_pedido lp
      JOIN pizzas pz ON lp.pizza_id = pz.id
      WHERE lp.pedido_id = $1
    `, [pedido_id]);

    if (lineasRes.rowCount === 0) {
      return res.status(400).json({
        success: false,
        message: `El pedido #${pedido_id} no tiene pizzas asociadas`,
      });
    }

    // 3. Líneas de Stripe en céntimos: se cobra el total guardado del pedido (con su
    //    descuento o ajuste), no la suma de las líneas a precio completo (hallazgo 5)
    if (aCentimos(pedido.total) < MINIMO_STRIPE_CENTIMOS) {
      return res.status(400).json({
        success: false,
        message: `El total del pedido #${pedido_id} (${formatearEuros(aCentimos(pedido.total))} €) es inferior al mínimo de ${formatearEuros(MINIMO_STRIPE_CENTIMOS)} € que admite Stripe. Cóbralo en efectivo o con datáfono.`,
      });
    }
    const lineItems = lineasParaStripe(pedido, lineasRes.rows);

    // 4. Una sola sesión viva por pedido (hallazgo 3): antes de crear otra se consulta la anterior
    if (pedido.stripe_session_id) {
      let anterior = null;
      try {
        anterior = await stripe.checkout.sessions.retrieve(pedido.stripe_session_id);
      } catch (error) {
        if (!esSesionInexistente(error)) {
          console.error(`❌ [Stripe] No se pudo consultar la sesión ${pedido.stripe_session_id} del pedido #${pedido.id}:`, error.message);
          return res.status(503).json({
            success: false,
            message: `No se pudo comprobar con Stripe la sesión de pago anterior del pedido #${pedido_id}. Inténtalo de nuevo en unos segundos.`,
          });
        }
        // La sesión anterior ya no existe en Stripe: se puede crear otra
      }

      if (anterior?.payment_status === 'paid') {
        // Pagado aunque el webhook no llegara: se marca ahora y no se cobra otra vez
        await marcarPedidoPagado(pedido.id, anterior.id, 'crear-sesion');
        return res.status(400).json({
          success: false,
          message: `El pedido #${pedido_id} ya fue pagado anteriormente`,
        });
      }

      if (anterior?.status === 'open') {
        if (!(await expirarSesionStripe(anterior.id, pedido.id))) {
          return res.status(503).json({
            success: false,
            message: `No se pudo cerrar en Stripe la sesión de pago anterior del pedido #${pedido_id}. Inténtalo de nuevo en unos segundos.`,
          });
        }
      } else if (anterior && anterior.status !== 'expired') {
        // Completada pero sin pagar: el pago se está procesando (por ejemplo, un adeudo bancario)
        return res.status(409).json({
          success: false,
          message: `El pago del pedido #${pedido_id} se está procesando en Stripe. Espera a que se confirme antes de intentarlo de nuevo.`,
        });
      }
    }

    // Determinar la URL base de retorno (prioridad: FRONTEND_URL > cabeceras proxy > host)
    let frontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : null;
    if (!frontendUrl) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host');
      frontendUrl = `${proto}://${host}`.replace(/:3000$/, '');
    }

    // 5. Crear sesión en Stripe (utilizando Dynamic Payment Methods de Stripe)
    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: 'payment',
      client_reference_id: String(pedido.id),
      customer_email: pedido.cliente_email || undefined,
      metadata: {
        pedido_id: String(pedido.id),
        cliente_nombre: pedido.cliente_nombre || 'Cliente Web',
      },
      success_url: `${frontendUrl}/?pago=exito&pedido_id=${pedido.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/?pago=cancelado&pedido_id=${pedido.id}`,
    });

    // 6. Guardar el ID de sesión en el pedido para trazabilidad
    await query('UPDATE pedidos SET stripe_session_id = $1, metodo_pago = $2 WHERE id = $3', [
      session.id,
      'stripe',
      pedido.id,
    ]);

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('❌ [Stripe Error] Error al crear sesión de Checkout:', error);
    res.status(500).json({
      success: false,
      message: 'Error al iniciar la sesión de pago con Stripe',
      error: error.message,
    });
  }
};

/**
 * Endpoint de Webhook para procesar eventos asíncronos de Stripe (checkout.session.completed)
 */
export const handleWebhook = async (req, res) => {
  if (!stripe) {
    return res.status(503).send('Stripe no configurado');
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ? process.env.STRIPE_WEBHOOK_SECRET.trim() : null;
  const sig = req.headers['stripe-signature'];

  let event;

  if (webhookSecret) {
    // Con secreto configurado la firma es obligatoria (M-13)
    if (!sig) {
      console.error('⚠️ [Stripe Webhook] Evento rechazado: falta la cabecera stripe-signature.');
      return res.status(400).send('Webhook Error: falta la cabecera stripe-signature');
    }
    try {
      const payload = req.rawBody || req.body;
      event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    } catch (err) {
      console.error(`⚠️ [Stripe Webhook] Error en la firma del webhook: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Sin secreto (modo pruebas directas) se acepta el evento sin verificar
    console.warn('⚠️ [Stripe Webhook] STRIPE_WEBHOOK_SECRET no está definido: se acepta el evento SIN verificar la firma. Configúralo fuera de las pruebas.');
    event = req.body;
  }

  try {
    if (event?.type === 'checkout.session.completed') {
      const session = event.data.object;
      const pedidoId = session.client_reference_id || session.metadata?.pedido_id;

      if (session.payment_status !== 'paid') {
        // Checkout completado sin el pago confirmado (por ejemplo, un adeudo bancario en proceso)
        console.log(`ℹ️ [Stripe Webhook] Sesión ${session.id} del pedido #${pedidoId} completada con payment_status "${session.payment_status}": no se marca como pagado.`);
      } else if (pedidoId) {
        await marcarPedidoPagado(pedidoId, session.id, 'Webhook');
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('❌ [Stripe Webhook Error] Error al procesar evento de base de datos:', err);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
};

/**
 * Confirmación síncrona inmediata al retornar de Stripe Checkout (Patrón de Doble Verificación)
 */
export const confirmarSesion = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ success: false, message: 'Stripe no configurado' });
    }

    const { pedido_id, session_id } = req.body;
    if (!session_id && !pedido_id) {
      return res.status(400).json({ success: false, message: 'Falta session_id o pedido_id' });
    }

    let targetSessionId = session_id;
    let targetPedidoId = pedido_id;

    // Si solo viene pedido_id, buscar la session_id en BD
    if (!targetSessionId && targetPedidoId) {
      const pRes = await query('SELECT stripe_session_id FROM pedidos WHERE id = $1', [targetPedidoId]);
      if (pRes.rowCount > 0) targetSessionId = pRes.rows[0].stripe_session_id;
    }

    if (!targetSessionId) {
      return res.status(400).json({ success: false, message: 'No se encontró sesión de Stripe asociada' });
    }

    // Consultar a Stripe el estado real de la sesión
    const session = await stripe.checkout.sessions.retrieve(targetSessionId);

    // La sesión debe ser del pedido indicado: si no, se podría marcar como pagado
    // un pedido con el pago de otro (M-13)
    if (targetPedidoId && !sesionDelPedido(session, targetPedidoId)) {
      console.warn(`⚠️ [Stripe Confirmación] La sesión ${session.id} no pertenece al pedido #${targetPedidoId}: no se cambia nada.`);
      return res.status(409).json({
        success: false,
        message: `La sesión de pago no pertenece al pedido #${targetPedidoId}`,
      });
    }

    if (session.payment_status === 'paid') {
      const finalPedidoId = targetPedidoId || session.client_reference_id || session.metadata?.pedido_id;
      if (finalPedidoId) {
        await marcarPedidoPagado(finalPedidoId, session.id, 'Confirmación');
        return res.json({ success: true, estado_pago: 'pagado', pedido_id: finalPedidoId });
      }
    }

    res.json({
      success: true,
      estado_pago: session.payment_status,
      message: `Estado actual en Stripe: ${session.payment_status}`,
    });
  } catch (error) {
    console.error('❌ [Error al confirmar sesión Stripe]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

