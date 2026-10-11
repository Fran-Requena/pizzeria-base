/**
 * Caracterización (comportamiento ACTUAL) de los pagos con Stripe configurado.
 * Stripe es un doble de pruebas (tests/soporte/stripe-doble.js): nunca se llama a la API real.
 * Los tests marcados "[actual, hallazgo N]" fijan comportamientos que MEJORAS.md
 * (sección 11) considera incorrectos; cambiarán cuando se arregle ese hallazgo.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { reiniciarEsquema, arrancarApp, pedir, pool, leerPedido } from './soporte/entorno.js';
import { control, generarFirma } from './soporte/stripe-doble.js';

const SECRETO = 'whsec_doble_de_pruebas';

let api;

before(async () => {
  await reiniciarEsquema();
  api = await arrancarApp();
});

after(async () => {
  await api.cerrar();
  await pool.end();
});

beforeEach(() => {
  control.reiniciar();
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

/** Crea un pedido para recoger: 2 x Margherita (9.50) + 1 x Cuatro Quesos (13.50) con nota. */
async function crearPedido() {
  const r = await pedir(api.url, 'POST', '/api/pedidos', {
    tipo_pedido: 'recoger',
    cliente_nombre: 'Pago Prueba',
    cliente_telefono: '600555666',
    metodo_pago: 'stripe',
    lineas: [
      { pizza_id: 1, cantidad: 2 },
      { pizza_id: 3, cantidad: 1, notas: 'Poco hecha' },
    ],
  });
  assert.equal(r.estado, 201);
  return r.json.data.id;
}

const crearSesion = (cuerpo) => pedir(api.url, 'POST', '/api/pagos/crear-sesion', cuerpo);

const cobrar = (id, cuerpo, metodo = 'PUT') => pedir(api.url, metodo, `/api/pedidos/${id}/cobro`, cuerpo);

/** Evento checkout.session.completed como el que envía Stripe. */
const eventoCompletado = (pedidoId, sesionId = 'cs_test_webhook', paymentStatus = 'paid') =>
  JSON.stringify({
    id: `evt_${pedidoId}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sesionId,
        status: 'complete',
        payment_status: paymentStatus,
        client_reference_id: String(pedidoId),
        metadata: { pedido_id: String(pedidoId) },
      },
    },
  });

const enviarWebhook = (payload, cabeceras = {}, ruta = '/api/pagos/webhook') =>
  pedir(api.url, 'POST', ruta, payload, cabeceras);

describe('POST /api/pagos/crear-sesion', () => {
  test('responde 400 sin pedido_id y no llama a Stripe', async () => {
    const r = await crearSesion({});
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, 'Falta el parámetro pedido_id');
    assert.equal(control.llamadas.length, 0);
  });

  test('responde 404 si el pedido no existe', async () => {
    const r = await crearSesion({ pedido_id: 999999 });
    assert.equal(r.estado, 404);
    assert.equal(r.json.message, 'El pedido #999999 no existe');
    assert.equal(control.llamadas.length, 0);
  });

  test('responde 400 si el pedido ya está pagado', async () => {
    const id = await crearPedido();
    await pool.query(`UPDATE pedidos SET estado_pago = 'pagado' WHERE id = $1`, [id]);

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, `El pedido #${id} ya fue pagado anteriormente`);
    assert.equal(control.llamadas.length, 0);
  });

  test('responde 400 si el pedido no tiene líneas', async () => {
    const ins = await pool.query(
      `INSERT INTO pedidos (tipo_pedido, cliente_nombre) VALUES ($1, $2) RETURNING id`,
      ['recoger', 'Sin líneas']
    );
    const id = ins.rows[0].id;

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, `El pedido #${id} no tiene pizzas asociadas`);
  });

  test('crea la sesión con las líneas en céntimos y guarda stripe_session_id y metodo_pago', async () => {
    const id = await crearPedido();

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 200);
    assert.equal(r.json.success, true);
    assert.equal(r.json.sessionId, 'cs_test_doble_1');
    assert.equal(r.json.url, 'https://checkout.stripe.test/pay/cs_test_doble_1');

    assert.equal(control.llamadas.length, 1);
    const { metodo, params } = control.llamadas[0];
    assert.equal(metodo, 'checkout.sessions.create');
    assert.equal(params.mode, 'payment');
    assert.equal(params.client_reference_id, String(id));
    assert.equal(params.metadata.pedido_id, String(id));
    assert.equal(params.metadata.cliente_nombre, 'Pago Prueba');
    assert.equal(params.customer_email, undefined);
    assert.equal(params.success_url, `http://pizzeria.test/?pago=exito&pedido_id=${id}&session_id={CHECKOUT_SESSION_ID}`);
    assert.equal(params.cancel_url, `http://pizzeria.test/?pago=cancelado&pedido_id=${id}`);

    const margherita = params.line_items.find((l) => l.price_data.product_data.name === 'Margherita Clásica');
    assert.equal(margherita.quantity, 2);
    assert.equal(margherita.price_data.currency, 'eur');
    assert.equal(margherita.price_data.unit_amount, 950);
    assert.equal(margherita.price_data.product_data.description, undefined);

    const quesos = params.line_items.find((l) => l.price_data.product_data.name === 'Cuatro Quesos Cremosa');
    assert.equal(quesos.quantity, 1);
    assert.equal(quesos.price_data.unit_amount, 1350);
    assert.equal(quesos.price_data.product_data.description, 'Nota: Poco hecha');

    const p = await leerPedido(id);
    assert.equal(p.stripe_session_id, 'cs_test_doble_1');
    assert.equal(p.metodo_pago, 'stripe');
    assert.equal(p.estado_pago, 'pendiente');
    assert.equal(p.estado, 'pendiente');
  });

  test('crear-sesion cobra en Stripe el total del pedido con su descuento, no la suma de las líneas a precio completo', async () => {
    const id = await crearPedido();
    // 32.50 a precio de carta; descuento de 3.25 aplicado al total
    await pool.query(`UPDATE pedidos SET total = 29.25 WHERE id = $1`, [id]);

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 200);

    const { params } = control.llamadasA('checkout.sessions.create')[0];
    assert.equal(params.line_items.length, 1);
    assert.equal(params.line_items[0].price_data.product_data.name, `Pedido #${id}`);
    assert.equal(params.line_items[0].price_data.unit_amount, 2925);
    assert.equal(params.line_items[0].quantity, 1);
    assert.equal(control.sesiones.get(r.json.sessionId).amount_total, 2925);
  });

  test('responde 400 si el total es inferior al mínimo de Stripe (0.50 €) y no llama a Stripe', async () => {
    const id = await crearPedido();
    await pool.query(`UPDATE pedidos SET total = 0.30 WHERE id = $1`, [id]);

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 400);
    assert.equal(r.json.success, false);
    assert.match(r.json.message, new RegExp(`^El total del pedido #${id} \\(0\\.30 €\\) es inferior al mínimo de 0\\.50 €`));
    assert.equal(control.llamadas.length, 0);
  });

  test('responde 500 si Stripe falla y no modifica el pedido', async () => {
    const id = await crearPedido();
    control.crear = () => {
      throw new Error('Fallo simulado de Stripe');
    };

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 500);
    assert.equal(r.json.success, false);
    assert.equal(r.json.message, 'Error al iniciar la sesión de pago con Stripe');
    assert.equal((await leerPedido(id)).stripe_session_id, null);
  });

  test('crear-sesion expira la sesión abierta anterior antes de crear otra: nunca hay dos sesiones cobrables a la vez', async () => {
    const id = await crearPedido();

    const a = await crearSesion({ pedido_id: id });
    const b = await crearSesion({ pedido_id: id });
    assert.equal(b.estado, 200);
    assert.notEqual(a.json.sessionId, b.json.sessionId);

    assert.deepEqual(
      control.llamadas.map((l) => l.metodo),
      ['checkout.sessions.create', 'checkout.sessions.retrieve', 'checkout.sessions.expire', 'checkout.sessions.create']
    );
    assert.equal(control.sesiones.get(a.json.sessionId).status, 'expired');
    assert.equal(control.sesiones.get(b.json.sessionId).status, 'open');
    assert.equal((await leerPedido(id)).stripe_session_id, b.json.sessionId);
  });

  test('si la sesión anterior está pagada, marca el pedido como pagado y responde 400 "ya fue pagado"', async () => {
    const id = await crearPedido();
    const a = await crearSesion({ pedido_id: id });
    control.pagar(a.json.sessionId); // El cliente pagó, pero el webhook no llegó

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, `El pedido #${id} ya fue pagado anteriormente`);
    assert.equal(control.llamadasA('checkout.sessions.create').length, 1);

    const p = await leerPedido(id);
    assert.equal(p.estado_pago, 'pagado');
    assert.equal(p.stripe_session_id, a.json.sessionId);
  });

  test('si la sesión anterior ya caducó, crea otra sin intentar expirarla', async () => {
    const id = await crearPedido();
    const a = await crearSesion({ pedido_id: id });
    control.caducar(a.json.sessionId);

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 200);
    assert.equal(control.llamadasA('checkout.sessions.expire').length, 0);
    assert.equal((await leerPedido(id)).stripe_session_id, r.json.sessionId);
  });

  test('si la sesión anterior no existe en Stripe, crea otra', async () => {
    const id = await crearPedido();
    await pool.query(`UPDATE pedidos SET stripe_session_id = 'cs_borrada' WHERE id = $1`, [id]);

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 200);
    assert.equal((await leerPedido(id)).stripe_session_id, r.json.sessionId);
  });

  test('si Stripe falla al consultar la sesión anterior, responde 503 y no crea otra', async (t) => {
    const id = await crearPedido();
    const a = await crearSesion({ pedido_id: id });
    control.recuperar = () => {
      throw new Error('Fallo simulado de red');
    };
    t.mock.method(console, 'error', () => {});

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 503);
    assert.equal(r.json.success, false);
    assert.equal(control.llamadasA('checkout.sessions.create').length, 1);
    assert.equal((await leerPedido(id)).stripe_session_id, a.json.sessionId);
  });

  test('si no puede expirar la sesión anterior, responde 503 y no crea otra', async (t) => {
    const id = await crearPedido();
    const a = await crearSesion({ pedido_id: id });
    control.expirar = () => {
      throw new Error('Fallo simulado de Stripe');
    };
    t.mock.method(console, 'warn', () => {});

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 503);
    assert.equal(control.llamadasA('checkout.sessions.create').length, 1);
    assert.equal((await leerPedido(id)).stripe_session_id, a.json.sessionId);
  });

  test('si la sesión anterior está completada pero sin pagar (pago en proceso), responde 409 y no crea otra', async () => {
    const id = await crearPedido();
    const a = await crearSesion({ pedido_id: id });
    control.fijarSesion(a.json.sessionId, { status: 'complete', payment_status: 'unpaid' });

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 409);
    assert.match(r.json.message, /se está procesando en Stripe/);
    assert.equal(control.llamadasA('checkout.sessions.create').length, 1);
  });

  test('crear-sesion rechaza un pedido cancelado y no llama a Stripe', async () => {
    const id = await crearPedido();
    await pool.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id = $1`, [id]);

    const r = await crearSesion({ pedido_id: id });
    assert.equal(r.estado, 409);
    assert.equal(r.json.success, false);
    assert.equal(r.json.message, `El pedido #${id} está cancelado y no se puede cobrar`);
    assert.equal(control.llamadas.length, 0);
    assert.equal((await leerPedido(id)).stripe_session_id, null);
  });
});

describe('PUT/POST /api/pedidos/:id/cobro', () => {
  test('registra el cobro, cambia metodo_pago y devuelve el pedido con sus líneas', async () => {
    const id = await crearPedido();

    const r = await cobrar(id, { metodo_pago: 'efectivo_entrega', importe_entregado: 40, cambio: 7.5 });
    assert.equal(r.estado, 200);
    assert.equal(r.json.success, true);
    assert.equal(r.json.data.estado_pago, 'pagado');
    assert.equal(r.json.data.metodo_pago, 'efectivo_entrega');
    assert.equal(r.json.data.lineas.length, 2);
    assert.equal(r.json.detalles_cobro.importe_entregado, 40);
    assert.equal(r.json.detalles_cobro.cambio, 7.5);
  });

  test('responde 404 si el pedido no existe', async () => {
    const r = await cobrar(999999, { metodo_pago: 'efectivo_entrega' });
    assert.equal(r.estado, 404);
    assert.equal(r.json.message, 'Pedido #999999 no encontrado');
  });

  test('/cobro rechaza un pedido cancelado', async () => {
    const id = await crearPedido();
    await pool.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id = $1`, [id]);

    const r = await cobrar(id, { metodo_pago: 'efectivo_entrega' }, 'POST');
    assert.equal(r.estado, 409);
    assert.equal(r.json.success, false);
    assert.equal(r.json.message, `El pedido #${id} está cancelado y no se puede cobrar`);

    const p = await leerPedido(id);
    assert.equal(p.estado_pago, 'pendiente');
    assert.equal(p.metodo_pago, 'stripe');
  });

  test('/cobro rechaza un pedido ya pagado y no cambia su metodo_pago', async () => {
    const id = await crearPedido();
    await pool.query(`UPDATE pedidos SET estado_pago = 'pagado' WHERE id = $1`, [id]);

    const r = await cobrar(id, { metodo_pago: 'efectivo_entrega' });
    assert.equal(r.estado, 409);
    assert.equal(r.json.success, false);
    assert.equal(r.json.message, `El pedido #${id} ya fue pagado anteriormente`);
    assert.equal(control.llamadas.length, 0);

    const p = await leerPedido(id);
    assert.equal(p.estado_pago, 'pagado');
    assert.equal(p.metodo_pago, 'stripe');
  });

  test('/cobro en efectivo o datáfono expira la sesión de Stripe abierta del pedido', async () => {
    const id = await crearPedido();
    const sesion = await crearSesion({ pedido_id: id });
    assert.equal(sesion.estado, 200);

    const r = await cobrar(id, { metodo_pago: 'tarjeta_entrega' });
    assert.equal(r.estado, 200);
    assert.equal(r.json.data.metodo_pago, 'tarjeta_entrega');

    assert.deepEqual(control.llamadasA('checkout.sessions.expire').map((l) => l.id), [sesion.json.sessionId]);
    assert.equal(control.sesiones.get(sesion.json.sessionId).status, 'expired');
    assert.equal((await leerPedido(id)).estado_pago, 'pagado');
  });

  test('si no puede expirar la sesión de Stripe, lo registra y registra el cobro igualmente', async (t) => {
    const id = await crearPedido();
    await crearSesion({ pedido_id: id });
    control.expirar = () => {
      throw new Error('Fallo simulado de Stripe');
    };
    const avisos = t.mock.method(console, 'warn', () => {});

    const r = await cobrar(id, { metodo_pago: 'efectivo_entrega' });
    assert.equal(r.estado, 200);
    assert.equal((await leerPedido(id)).estado_pago, 'pagado');
    assert.ok(avisos.mock.calls.some((c) => String(c.arguments[0]).includes('No se pudo expirar')));
  });

  test('el apunte manual con metodo_pago stripe no expira la sesión', async () => {
    const id = await crearPedido();
    await crearSesion({ pedido_id: id });

    const r = await cobrar(id, { metodo_pago: 'stripe' });
    assert.equal(r.estado, 200);
    assert.equal(control.llamadasA('checkout.sessions.expire').length, 0);
  });
});

describe('POST /api/pagos/webhook', () => {
  test('sin secreto configurado acepta el evento sin verificar, registra un aviso y marca el pedido como pagado', async (t) => {
    const id = await crearPedido();
    const avisos = t.mock.method(console, 'warn', () => {});

    const r = await enviarWebhook(eventoCompletado(id));
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json, { received: true });
    assert.ok(avisos.mock.calls.some((c) => String(c.arguments[0]).includes('STRIPE_WEBHOOK_SECRET no está definido')));

    const p = await leerPedido(id);
    assert.equal(p.estado_pago, 'pagado');
    assert.equal(p.stripe_session_id, 'cs_test_webhook');
    assert.equal(p.estado, 'pendiente', 'el webhook no cambia el estado del pedido');
  });

  test('no marca el pedido como pagado si payment_status no es "paid"', async () => {
    const id = await crearPedido();

    const r = await enviarWebhook(eventoCompletado(id, 'cs_en_proceso', 'unpaid'));
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json, { received: true });

    const p = await leerPedido(id);
    assert.equal(p.estado_pago, 'pendiente');
    assert.equal(p.stripe_session_id, null);
  });

  test('con secreto y firma válida marca el pedido como pagado', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
    const id = await crearPedido();
    const payload = eventoCompletado(id);

    const r = await enviarWebhook(payload, { 'stripe-signature': generarFirma(payload, SECRETO) });
    assert.equal(r.estado, 200);
    assert.equal((await leerPedido(id)).estado_pago, 'pagado');
  });

  test('con secreto y firma incorrecta responde 400 en texto plano y no marca el pago', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
    const id = await crearPedido();
    const payload = eventoCompletado(id);

    const r = await enviarWebhook(payload, { 'stripe-signature': generarFirma(payload, 'whsec_otro_secreto') });
    assert.equal(r.estado, 400);
    assert.equal(r.json, null);
    assert.match(r.texto, /^Webhook Error: /);
    assert.equal((await leerPedido(id)).estado_pago, 'pendiente');
  });

  test('con secreto y sin cabecera stripe-signature responde 400 en texto plano y no marca el pago', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
    const id = await crearPedido();

    const r = await enviarWebhook(eventoCompletado(id));
    assert.equal(r.estado, 400);
    assert.equal(r.json, null);
    assert.equal(r.texto, 'Webhook Error: falta la cabecera stripe-signature');
    assert.equal((await leerPedido(id)).estado_pago, 'pendiente');
  });

  test('un evento duplicado se acepta dos veces (200) sin error y el pedido sigue pagado', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
    const id = await crearPedido();
    const payload = eventoCompletado(id);

    const r1 = await enviarWebhook(payload, { 'stripe-signature': generarFirma(payload, SECRETO) });
    const r2 = await enviarWebhook(payload, { 'stripe-signature': generarFirma(payload, SECRETO) });
    assert.equal(r1.estado, 200);
    assert.equal(r2.estado, 200);
    assert.deepEqual(r2.json, { received: true });

    const p = await leerPedido(id);
    assert.equal(p.estado_pago, 'pagado');
    assert.equal(p.stripe_session_id, 'cs_test_webhook');
  });

  test('un segundo pago de Stripe del mismo pedido queda registrado y se detecta', async (t) => {
    const id = await crearPedido();
    await enviarWebhook(eventoCompletado(id, 'cs_primer_pago'));
    const avisos = t.mock.method(console, 'warn', () => {});

    const r = await enviarWebhook(eventoCompletado(id, 'cs_segundo_pago'));
    assert.equal(r.estado, 200);

    const p = await leerPedido(id);
    assert.equal(p.estado_pago, 'pagado');
    assert.equal(p.stripe_session_id, 'cs_primer_pago', 'no se sustituye la sesión del primer pago');

    const aviso = avisos.mock.calls.map((c) => String(c.arguments[0])).find((m) => m.includes('cobro doble'));
    assert.ok(aviso, 'se registra un aviso de cobro doble');
    assert.ok(aviso.includes(`#${id}`) && aviso.includes('cs_primer_pago') && aviso.includes('cs_segundo_pago'));
  });

  test('un pago de Stripe de un pedido ya cobrado en caja se registra como posible cobro doble', async (t) => {
    const id = await crearPedido();
    const sesion = await crearSesion({ pedido_id: id });
    control.expirar = () => {
      throw new Error('Fallo simulado de Stripe');
    };
    const avisos = t.mock.method(console, 'warn', () => {});
    await cobrar(id, { metodo_pago: 'efectivo_entrega' });

    const r = await enviarWebhook(eventoCompletado(id, sesion.json.sessionId));
    assert.equal(r.estado, 200);
    assert.equal((await leerPedido(id)).metodo_pago, 'efectivo_entrega');
    assert.ok(avisos.mock.calls.some((c) => String(c.arguments[0]).includes('cobro doble')));
  });

  test('ignora (200) los eventos de otro tipo', async () => {
    const id = await crearPedido();
    const payload = JSON.stringify({ id: 'evt_otro', type: 'payment_intent.created', data: { object: { client_reference_id: String(id) } } });

    const r = await enviarWebhook(payload);
    assert.equal(r.estado, 200);
    assert.equal((await leerPedido(id)).estado_pago, 'pendiente');
  });

  test('responde 200 aunque el pedido del evento no exista', async () => {
    const r = await enviarWebhook(eventoCompletado(999999));
    assert.equal(r.estado, 200);
  });

  test('el alias /api/webhooks/stripe se comporta igual', async () => {
    const id = await crearPedido();
    const r = await enviarWebhook(eventoCompletado(id), {}, '/api/webhooks/stripe');
    assert.equal(r.estado, 200);
    assert.equal((await leerPedido(id)).estado_pago, 'pagado');
  });
});

describe('POST /api/pagos/confirmar-sesion', () => {
  const confirmar = (cuerpo) => pedir(api.url, 'POST', '/api/pagos/confirmar-sesion', cuerpo);

  test('responde 400 sin session_id ni pedido_id', async () => {
    const r = await confirmar({});
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, 'Falta session_id o pedido_id');
  });

  test('marca el pedido como pagado si la sesión está pagada y es del pedido (como el retorno de Stripe)', async () => {
    const id = await crearPedido();
    const s = await crearSesion({ pedido_id: id });
    control.pagar(s.json.sessionId);

    // La web envía pedido_id como texto (lo lee de la URL de retorno)
    const r = await confirmar({ pedido_id: String(id), session_id: s.json.sessionId });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json, { success: true, estado_pago: 'pagado', pedido_id: String(id) });
    assert.equal((await leerPedido(id)).estado_pago, 'pagado');
  });

  test('con solo pedido_id consulta la sesión guardada del pedido', async () => {
    const id = await crearPedido();
    const s = await crearSesion({ pedido_id: id });
    control.pagar(s.json.sessionId);

    const r = await confirmar({ pedido_id: id });
    assert.equal(r.estado, 200);
    assert.equal(r.json.estado_pago, 'pagado');
    assert.equal(control.llamadasA('checkout.sessions.retrieve').at(-1).id, s.json.sessionId);
    assert.equal((await leerPedido(id)).estado_pago, 'pagado');
  });

  test('si la sesión no está pagada devuelve su estado y no cambia nada', async () => {
    const id = await crearPedido();
    const s = await crearSesion({ pedido_id: id });

    const r = await confirmar({ pedido_id: id, session_id: s.json.sessionId });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json, { success: true, estado_pago: 'unpaid', message: 'Estado actual en Stripe: unpaid' });
    assert.equal((await leerPedido(id)).estado_pago, 'pendiente');
  });

  test('responde 409 y no cambia nada si la sesión pagada es de otro pedido', async (t) => {
    const id = await crearPedido();
    const otro = await crearPedido();
    const s = await crearSesion({ pedido_id: otro });
    control.pagar(s.json.sessionId);
    t.mock.method(console, 'warn', () => {});

    const r = await confirmar({ pedido_id: id, session_id: s.json.sessionId });
    assert.equal(r.estado, 409);
    assert.equal(r.json.success, false);
    assert.equal(r.json.message, `La sesión de pago no pertenece al pedido #${id}`);

    assert.equal((await leerPedido(id)).estado_pago, 'pendiente');
    assert.equal((await leerPedido(id)).stripe_session_id, null);
    assert.equal((await leerPedido(otro)).estado_pago, 'pendiente');
  });

  test('acepta la sesión si solo metadata.pedido_id coincide con el pedido', async () => {
    const id = await crearPedido();
    control.fijarSesion('cs_solo_metadata', {
      status: 'complete',
      payment_status: 'paid',
      client_reference_id: null,
      metadata: { pedido_id: String(id) },
    });

    const r = await confirmar({ pedido_id: id, session_id: 'cs_solo_metadata' });
    assert.equal(r.estado, 200);
    assert.equal(r.json.estado_pago, 'pagado');
    assert.equal((await leerPedido(id)).stripe_session_id, 'cs_solo_metadata');
  });
});
