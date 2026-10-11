/**
 * Caracterización (comportamiento ACTUAL) de los pagos SIN Stripe configurado.
 * Va en un archivo aparte porque pagosController.js lee STRIPE_SECRET_KEY una sola vez,
 * al cargarse; el ejecutor de tests usa un proceso distinto por archivo.
 * No necesita la base de datos: los endpoints responden 503 antes de consultarla.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { arrancarApp, pedir, pool } from './soporte/entorno.js';
import { control } from './soporte/stripe-doble.js';

// Debe fijarse antes de importar la app (arrancarApp). Una cadena vacía impide además
// que dotenv cargue una clave del .env.
process.env.STRIPE_SECRET_KEY = '';

let api;

before(async () => {
  api = await arrancarApp();
});

after(async () => {
  await api.cerrar();
  await pool.end();
});

describe('Pagos con la pasarela desactivada (sin STRIPE_SECRET_KEY)', () => {
  test('el doble de Stripe no llega a crearse', () => {
    assert.equal(control.claves.length, 0);
  });

  test('crear-sesion responde 503 con un mensaje para usar efectivo o datáfono', async () => {
    const r = await pedir(api.url, 'POST', '/api/pagos/crear-sesion', { pedido_id: 101 });
    assert.equal(r.estado, 503);
    assert.equal(r.json.success, false);
    assert.match(r.json.message, /no está configurada/);
  });

  test('crear-sesion responde 503 incluso sin pedido_id (la comprobación de Stripe va primero)', async () => {
    const r = await pedir(api.url, 'POST', '/api/pagos/crear-sesion', {});
    assert.equal(r.estado, 503);
  });

  test('el webhook responde 503 en texto plano', async () => {
    const r = await pedir(api.url, 'POST', '/api/pagos/webhook', { type: 'checkout.session.completed' });
    assert.equal(r.estado, 503);
    assert.equal(r.texto, 'Stripe no configurado');
  });

  test('confirmar-sesion responde 503', async () => {
    const r = await pedir(api.url, 'POST', '/api/pagos/confirmar-sesion', { pedido_id: 101 });
    assert.equal(r.estado, 503);
    assert.equal(r.json.message, 'Stripe no configurado');
  });

  test('reconciliar responde 503', async () => {
    const r = await pedir(api.url, 'POST', '/api/pagos/reconciliar');
    assert.equal(r.estado, 503);
    assert.equal(r.json.success, false);
    assert.equal(r.json.message, 'Stripe no configurado');
  });

  test('la reconciliación periódica no se arranca', async () => {
    const { iniciarReconciliacionPeriodica, reconciliacionPeriodicaActiva } = await import('../src/controllers/pagosController.js');
    assert.equal(iniciarReconciliacionPeriodica(), null);
    assert.equal(reconciliacionPeriodicaActiva(), false);
  });

  test('GET /api/pagos/config indica que Stripe no está configurado', async () => {
    const r = await pedir(api.url, 'GET', '/api/pagos/config');
    assert.equal(r.estado, 200);
    assert.equal(r.json.stripe_configured, false);
    assert.equal(r.json.webhook_configured, false);
  });
});
