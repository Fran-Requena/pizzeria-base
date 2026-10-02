import Stripe from 'stripe';
import { query } from '../config/db.js';

// Inicialización condicional y tolerante (Feature Flag)
const stripeKey = process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.trim() : null;
const stripe = stripeKey ? new Stripe(stripeKey) : null;

if (!stripe) {
  console.log('ℹ️ [Stripe] Pasarela de pagos inactiva (STRIPE_SECRET_KEY no configurada). Métodos tradicionales activos.');
} else {
  console.log('💳 [Stripe] Pasarela de pagos inicializada en modo activo.');
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

    // 3. Transformar los ítems al formato requerido por Stripe (precios en céntimos enteros)
    const lineItems = lineasRes.rows.map(linea => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: linea.nombre,
          description: linea.notas ? `Nota: ${linea.notas}` : undefined,
        },
        unit_amount: Math.round(Number(linea.precio_unitario) * 100),
      },
      quantity: linea.cantidad,
    }));

    // Determinar la URL base de retorno (prioridad: FRONTEND_URL > cabeceras proxy > host)
    let frontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : null;
    if (!frontendUrl) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host');
      frontendUrl = `${proto}://${host}`.replace(/:3000$/, '');
    }

    // 4. Crear sesión en Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
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

    // 5. Guardar el ID de sesión en el pedido para trazabilidad
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

  try {
    if (webhookSecret && sig) {
      const payload = req.rawBody || req.body;
      event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    } else {
      // Si no hay firma o secret configurado (modo pruebas directas)
      event = req.body;
    }
  } catch (err) {
    console.error(`⚠️ [Stripe Webhook] Error en la firma del webhook: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const pedidoId = session.client_reference_id || session.metadata?.pedido_id;

      if (pedidoId) {
        await query(
          `UPDATE pedidos 
           SET estado_pago = 'pagado', 
               stripe_session_id = $1 
           WHERE id = $2`,
          [session.id, parseInt(pedidoId, 10)]
        );
        console.log(`✅ [Stripe Webhook] Pedido #${pedidoId} marcado como PAGADO tras confirmación de Stripe.`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('❌ [Stripe Webhook Error] Error al procesar evento de base de datos:', err);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
};
