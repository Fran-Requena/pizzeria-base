/**
 * Pruebas del propio doble de Stripe (tests/soporte/stripe-doble.js).
 * No usan la base de datos ni la app: comprueban que el doble imita a Stripe en lo
 * que usa el backend (crear, consultar y expirar sesiones, y sus errores).
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import StripeDoble, { control } from './soporte/stripe-doble.js';

const stripe = new StripeDoble('sk_test_doble_de_pruebas');

const PARAMS = {
  mode: 'payment',
  client_reference_id: '7',
  metadata: { pedido_id: '7' },
  line_items: [
    { price_data: { currency: 'eur', product_data: { name: 'A' }, unit_amount: 950 }, quantity: 2 },
    { price_data: { currency: 'eur', product_data: { name: 'B' }, unit_amount: 1350 }, quantity: 1 },
  ],
};

beforeEach(() => control.reiniciar());

describe('Doble de Stripe: sesiones de Checkout', () => {
  test('crea sesiones abiertas y sin pagar, con el importe y la referencia del pedido', async () => {
    const s = await stripe.checkout.sessions.create(PARAMS);
    assert.equal(s.id, 'cs_test_doble_1');
    assert.equal(s.url, 'https://checkout.stripe.test/pay/cs_test_doble_1');
    assert.equal(s.status, 'open');
    assert.equal(s.payment_status, 'unpaid');
    assert.equal(s.amount_total, 3250);
    assert.equal(s.client_reference_id, '7');
    assert.equal(s.metadata.pedido_id, '7');
  });

  test('retrieve devuelve el estado actual de la sesión (pagada o caducada)', async () => {
    const a = await stripe.checkout.sessions.create(PARAMS);
    const b = await stripe.checkout.sessions.create(PARAMS);
    control.pagar(a.id);
    control.caducar(b.id);

    const ra = await stripe.checkout.sessions.retrieve(a.id);
    assert.equal(ra.status, 'complete');
    assert.equal(ra.payment_status, 'paid');
    const rb = await stripe.checkout.sessions.retrieve(b.id);
    assert.equal(rb.status, 'expired');
    assert.equal(rb.payment_status, 'unpaid');
  });

  test('retrieve y expire de una sesión que no existe fallan con resource_missing (404)', async () => {
    for (const metodo of ['retrieve', 'expire']) {
      await assert.rejects(stripe.checkout.sessions[metodo]('cs_no_existe'), (err) => {
        assert.equal(err.code, 'resource_missing');
        assert.equal(err.statusCode, 404);
        return true;
      });
    }
  });

  test('expire caduca una sesión abierta y falla si ya no está abierta', async () => {
    const s = await stripe.checkout.sessions.create(PARAMS);
    const expirada = await stripe.checkout.sessions.expire(s.id);
    assert.equal(expirada.status, 'expired');

    await assert.rejects(stripe.checkout.sessions.expire(s.id), (err) => {
      assert.equal(err.statusCode, 400);
      assert.notEqual(err.code, 'resource_missing');
      return true;
    });
  });

  test('fijarSesion crea sesiones a medida y llamadasA filtra el registro de llamadas', async () => {
    control.fijarSesion('cs_externa', { client_reference_id: '9', payment_status: 'paid', status: 'complete' });
    const s = await stripe.checkout.sessions.retrieve('cs_externa');
    assert.equal(s.client_reference_id, '9');
    assert.equal(s.payment_status, 'paid');
    assert.equal(control.llamadasA('checkout.sessions.retrieve').length, 1);
    assert.equal(control.llamadasA('checkout.sessions.expire').length, 0);
  });

  test('reiniciar vacía el almacén y restaura el contador', async () => {
    await stripe.checkout.sessions.create(PARAMS);
    control.reiniciar();
    assert.equal(control.sesiones.size, 0);
    assert.equal((await stripe.checkout.sessions.create(PARAMS)).id, 'cs_test_doble_1');
  });
});
