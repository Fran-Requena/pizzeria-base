/**
 * Caracterización (comportamiento ACTUAL) de salud, carta y metadatos.
 * Si un test falla tras un cambio intencionado, actualízalo en el mismo commit.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { reiniciarEsquema, arrancarApp, pedir, pool } from './soporte/entorno.js';

let api;

before(async () => {
  await reiniciarEsquema();
  api = await arrancarApp();
});

after(async () => {
  await api.cerrar();
  await pool.end();
});

describe('GET /api/health', () => {
  test('responde 200 con su propio formato, sin el envoltorio {success, data}', async () => {
    const r = await pedir(api.url, 'GET', '/api/health');
    assert.equal(r.estado, 200);
    assert.equal(r.json.status, 'UP');
    assert.equal(r.json.service, 'pizzeria-backend');
    assert.equal(r.json.database.connected, true);
    assert.ok(r.json.database.db_time);
    assert.ok(r.json.timestamp);
    assert.equal(r.json.success, undefined);
  });
});

describe('GET /api/pizzas', () => {
  test('devuelve las 6 pizzas de init.sql ordenadas por id, con el precio como texto', async () => {
    const r = await pedir(api.url, 'GET', '/api/pizzas');
    assert.equal(r.estado, 200);
    assert.equal(r.json.success, true);
    assert.equal(r.json.count, 6);
    assert.deepEqual(r.json.data.map((p) => p.id), [1, 2, 3, 4, 5, 6]);

    const margherita = r.json.data[0];
    assert.equal(margherita.nombre, 'Margherita Clásica');
    assert.equal(margherita.precio, '9.50');
    assert.equal(margherita.disponible, true);
    assert.equal(margherita.categoria_nombre, 'Clásicas');
    assert.equal(margherita.ingredientes.length, 3);
  });

  test('una pizza sin ingredientes devuelve ingredientes = []', async () => {
    const r = await pedir(api.url, 'GET', '/api/pizzas');
    const hawaiana = r.json.data.find((p) => p.id === 6);
    assert.deepEqual(hawaiana.ingredientes, []);
  });

  test('filtra por categoria_id', async () => {
    const r = await pedir(api.url, 'GET', '/api/pizzas?categoria_id=3');
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json.data.map((p) => p.nombre), ['Tartufo & Funghi Gourmet']);
  });

  test('filtra por disponible', async () => {
    await pool.query('UPDATE pizzas SET disponible = FALSE WHERE id = $1', [2]);
    try {
      const r = await pedir(api.url, 'GET', '/api/pizzas?disponible=false');
      assert.deepEqual(r.json.data.map((p) => p.id), [2]);
      const r2 = await pedir(api.url, 'GET', '/api/pizzas?disponible=true');
      assert.equal(r2.json.count, 5);
    } finally {
      await pool.query('UPDATE pizzas SET disponible = TRUE WHERE id = $1', [2]);
    }
  });
});

describe('GET /api/pizzas/:id', () => {
  test('devuelve una pizza existente', async () => {
    const r = await pedir(api.url, 'GET', '/api/pizzas/3');
    assert.equal(r.estado, 200);
    assert.equal(r.json.data.nombre, 'Cuatro Quesos Cremosa');
  });

  test('responde 404 si no existe', async () => {
    const r = await pedir(api.url, 'GET', '/api/pizzas/999');
    assert.equal(r.estado, 404);
    assert.equal(r.json.success, false);
  });
});

describe('GET /api/pizzas/metadata', () => {
  test('devuelve las 4 categorías por id y los 16 ingredientes por nombre', async () => {
    const r = await pedir(api.url, 'GET', '/api/pizzas/metadata');
    assert.equal(r.estado, 200);
    assert.equal(r.json.success, true);
    assert.deepEqual(r.json.data.categorias.map((c) => c.id), [1, 2, 3, 4]);
    assert.equal(r.json.data.ingredientes.length, 16);
    assert.equal(r.json.data.ingredientes[0].nombre, 'Albahaca Fresca');
  });
});

describe('Rutas inexistentes', () => {
  test('responden 404 con {success: false, message}', async () => {
    const r = await pedir(api.url, 'GET', '/api/no-existe');
    assert.equal(r.estado, 404);
    assert.equal(r.json.success, false);
    assert.equal(r.json.message, 'Ruta /api/no-existe no encontrada en este servidor');
  });
});
