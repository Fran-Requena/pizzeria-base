/**
 * Caracterización (comportamiento ACTUAL) de los pedidos: creación, consulta y /estado.
 * Los tests marcados "[actual, hallazgo N]" fijan comportamientos que MEJORAS.md
 * (sección 11) considera incorrectos; cambiarán cuando se arregle ese hallazgo.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { reiniciarEsquema, arrancarApp, pedir, pool, leerPedido, leerEstadoMesa } from './soporte/entorno.js';

let api;

before(async () => {
  await reiniciarEsquema();
  api = await arrancarApp();
});

after(async () => {
  await api.cerrar();
  await pool.end();
});

const LINEAS = [{ pizza_id: 1, cantidad: 2 }, { pizza_id: 2, cantidad: 1 }]; // 2 x 9.50 + 12.00 = 31.00

const DOMICILIO = {
  tipo_pedido: 'domicilio',
  cliente_nombre: 'Ana Prueba',
  cliente_telefono: '600111222',
  cliente_direccion: 'Calle Test 1',
  lineas: LINEAS,
};

const RECOGER = {
  tipo_pedido: 'recoger',
  cliente_nombre: 'Luis Prueba',
  cliente_telefono: '600333444',
  lineas: LINEAS,
};

const crear = (cuerpo) => pedir(api.url, 'POST', '/api/pedidos', cuerpo);
const cambiarEstado = (id, estado) => pedir(api.url, 'PUT', `/api/pedidos/${id}/estado`, { estado });

describe('POST /api/pedidos: pedido a domicilio', () => {
  test('crea el pedido (201) en estado pendiente, pendiente de pago y con el total calculado por el servidor', async () => {
    const r = await crear(DOMICILIO);
    assert.equal(r.estado, 201);
    assert.equal(r.json.success, true);
    assert.equal(r.json.message, '¡Pedido enviado a cocina con éxito!');

    const p = r.json.data;
    assert.equal(p.tipo_pedido, 'domicilio');
    assert.equal(p.estado, 'pendiente');
    assert.equal(p.estado_pago, 'pendiente');
    assert.equal(p.total, '31.00');
    assert.equal(p.metodo_pago, 'efectivo_entrega');
    assert.equal(p.mesa_numero, null);
    assert.equal(p.stripe_session_id, null);
    assert.equal(p.lineas.length, 2);
    assert.equal(p.lineas[0].nombre, 'Margherita Clásica');
    assert.equal(p.lineas[0].precio_unitario, 9.5);
  });

  test('ignora el precio_unitario enviado por el cliente al crear (usa el precio de la carta)', async () => {
    const r = await crear({ ...DOMICILIO, lineas: [{ pizza_id: 1, cantidad: 1, precio_unitario: 0.01 }] });
    assert.equal(r.estado, 201);
    assert.equal(r.json.data.total, '9.50');
  });

  test('una cantidad 0 o no numérica se guarda como 1', async () => {
    const r = await crear({ ...DOMICILIO, lineas: [{ pizza_id: 1, cantidad: 0 }, { pizza_id: 2, cantidad: 'x' }] });
    assert.equal(r.estado, 201);
    assert.deepEqual(r.json.data.lineas.map((l) => l.cantidad), [1, 1]);
    assert.equal(r.json.data.total, '21.50');
  });

  test('acepta los alias tipo_entrega, telefono y direccion_entrega', async () => {
    const r = await crear({
      tipo_entrega: 'domicilio',
      cliente_nombre: 'Alias',
      telefono: '600000000',
      direccion_entrega: 'Calle Alias 2',
      lineas: LINEAS,
    });
    assert.equal(r.estado, 201);
    assert.equal(r.json.data.cliente_telefono, '600000000');
    assert.equal(r.json.data.cliente_direccion, 'Calle Alias 2');
  });

  test('sin tipo_pedido ni mesa_numero se trata como domicilio', async () => {
    const r = await crear({ lineas: LINEAS });
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, 'El nombre del cliente es obligatorio para pedidos a domicilio');
  });

  const rechazos = [
    ['sin nombre', { cliente_nombre: undefined }, 'El nombre del cliente es obligatorio para pedidos a domicilio'],
    ['con el nombre en blanco', { cliente_nombre: '   ' }, 'El nombre del cliente es obligatorio para pedidos a domicilio'],
    ['sin teléfono', { cliente_telefono: undefined }, 'El teléfono de contacto es obligatorio para pedidos a domicilio'],
    ['sin dirección', { cliente_direccion: undefined }, 'La dirección de entrega es obligatoria para pedidos a domicilio'],
  ];
  for (const [caso, cambio, mensaje] of rechazos) {
    test(`rechaza (400) un domicilio ${caso}`, async () => {
      const r = await crear({ ...DOMICILIO, ...cambio });
      assert.equal(r.estado, 400);
      assert.equal(r.json.success, false);
      assert.equal(r.json.message, mensaje);
    });
  }
});

describe('POST /api/pedidos: pedido para recoger', () => {
  test('crea el pedido (201) sin dirección', async () => {
    const r = await crear(RECOGER);
    assert.equal(r.estado, 201);
    assert.equal(r.json.data.tipo_pedido, 'recoger');
    assert.equal(r.json.data.cliente_direccion, null);
  });

  test('rechaza (400) un pedido para recoger sin nombre', async () => {
    const r = await crear({ ...RECOGER, cliente_nombre: '' });
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, 'El nombre del cliente es obligatorio para pedidos a recoger');
  });

  test('rechaza (400) un pedido para recoger sin teléfono', async () => {
    const r = await crear({ ...RECOGER, cliente_telefono: undefined });
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, 'El teléfono de contacto es obligatorio para pedidos a recoger');
  });
});

describe('POST /api/pedidos: pedido en mesa', () => {
  test('crea el pedido (201), pone un nombre por defecto y marca la mesa como ocupada', async () => {
    assert.equal(await leerEstadoMesa(4), 'libre');
    const r = await crear({ tipo_pedido: 'mesa', mesa_numero: 4, lineas: LINEAS });
    assert.equal(r.estado, 201);
    assert.equal(r.json.data.mesa_numero, 4);
    assert.equal(r.json.data.cliente_nombre, 'Cliente Mesa 4');
    assert.equal(await leerEstadoMesa(4), 'ocupada');
  });

  test('con mesa_numero y sin tipo_pedido se trata como pedido en mesa', async () => {
    const r = await crear({ mesa_numero: 6, lineas: LINEAS });
    assert.equal(r.estado, 201);
    assert.equal(r.json.data.tipo_pedido, 'mesa');
  });

  test('rechaza (400) un pedido en mesa sin mesa_numero', async () => {
    const r = await crear({ tipo_pedido: 'mesa', lineas: LINEAS });
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, 'Debes indicar el número de mesa para pedidos en el local');
  });

  test('[actual] acepta una mesa que no existe en la sala', async () => {
    const r = await crear({ tipo_pedido: 'mesa', mesa_numero: 99, lineas: LINEAS });
    assert.equal(r.estado, 201);
    assert.equal(r.json.data.mesa_numero, 99);
  });
});

describe('POST /api/pedidos: rechazos comunes', () => {
  test('rechaza (400) un pedido sin líneas, con líneas vacías o que no son una lista', async () => {
    for (const lineas of [undefined, [], 'x']) {
      const r = await crear({ ...DOMICILIO, lineas });
      assert.equal(r.estado, 400);
      assert.equal(r.json.message, 'Debes incluir al menos una pizza en el pedido');
    }
  });

  test('rechaza (400) un tipo de pedido desconocido', async () => {
    const r = await crear({ ...DOMICILIO, tipo_pedido: 'dron' });
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, 'Tipo de pedido no válido (opciones: mesa, recoger, domicilio)');
  });

  test('rechaza (400) una pizza que no existe y no crea nada', async () => {
    const antes = await pool.query('SELECT COUNT(*)::int AS n FROM pedidos');
    const r = await crear({ ...DOMICILIO, lineas: [{ pizza_id: 1, cantidad: 1 }, { pizza_id: 9999, cantidad: 1 }] });
    assert.equal(r.estado, 400);
    assert.equal(r.json.message, 'La pizza con ID 9999 no existe.');
    const despues = await pool.query('SELECT COUNT(*)::int AS n FROM pedidos');
    assert.equal(despues.rows[0].n, antes.rows[0].n);
  });

  test('rechaza (400) una pizza no disponible', async () => {
    await pool.query('UPDATE pizzas SET disponible = FALSE WHERE id = $1', [6]);
    try {
      const r = await crear({ ...DOMICILIO, lineas: [{ pizza_id: 6, cantidad: 1 }] });
      assert.equal(r.estado, 400);
      assert.equal(r.json.message, 'La pizza "Hawaiana Especial" no está disponible temporalmente.');
    } finally {
      await pool.query('UPDATE pizzas SET disponible = TRUE WHERE id = $1', [6]);
    }
  });
});

describe('GET /api/pedidos/:id', () => {
  test('devuelve el pedido 101 de init.sql con sus líneas; el total es texto y las líneas, números', async () => {
    const r = await pedir(api.url, 'GET', '/api/pedidos/101');
    assert.equal(r.estado, 200);
    assert.equal(r.json.success, true);

    const p = r.json.data;
    assert.equal(p.id, 101);
    assert.equal(p.tipo_pedido, 'mesa');
    assert.equal(p.mesa_numero, 2);
    assert.equal(p.estado, 'en_preparacion');
    assert.equal(p.estado_pago, 'pendiente');
    assert.equal(p.metodo_pago, 'pago_mesa');
    assert.equal(p.total, '25.50');
    assert.ok(p.fecha);
    assert.equal(p.lineas.length, 2);

    const diavolo = p.lineas.find((l) => l.pizza_id === 2);
    assert.equal(diavolo.nombre, 'Diávolo Pepperoni');
    assert.equal(diavolo.cantidad, 1);
    assert.equal(diavolo.precio_unitario, 12);
    assert.equal(diavolo.subtotal, 12);
    assert.equal(diavolo.notas, 'Bien crujiente');
  });

  test('responde 404 si el pedido no existe', async () => {
    const r = await pedir(api.url, 'GET', '/api/pedidos/999999');
    assert.equal(r.estado, 404);
    assert.equal(r.json.message, 'Pedido #999999 no encontrado');
  });

  test('[actual] un id no numérico responde 500', async () => {
    const r = await pedir(api.url, 'GET', '/api/pedidos/abc');
    assert.equal(r.estado, 500);
    assert.equal(r.json.success, false);
  });
});

describe('PUT/PATCH /api/pedidos/:id/estado', () => {
  test('cambia el estado y devuelve el pedido actualizado', async () => {
    const { json } = await crear(RECOGER);
    const r = await cambiarEstado(json.data.id, 'en_preparacion');
    assert.equal(r.estado, 200);
    assert.equal(r.json.message, `Pedido #${json.data.id} actualizado al estado 'en_preparacion'`);
    assert.equal(r.json.data.estado, 'en_preparacion');
  });

  test('PATCH se comporta igual que PUT', async () => {
    const { json } = await crear(RECOGER);
    const r = await pedir(api.url, 'PATCH', `/api/pedidos/${json.data.id}/estado`, { estado: 'listo' });
    assert.equal(r.estado, 200);
    assert.equal((await leerPedido(json.data.id)).estado, 'listo');
  });

  test('rechaza (400) un estado que no está en la lista o que falta', async () => {
    const { json } = await crear(RECOGER);
    for (const estado of ['pendiente_pago', undefined]) {
      const r = await cambiarEstado(json.data.id, estado);
      assert.equal(r.estado, 400);
      assert.match(r.json.message, /^Estado no válido/);
    }
  });

  test('responde 404 si el pedido no existe', async () => {
    const r = await cambiarEstado(999999, 'listo');
    assert.equal(r.estado, 404);
  });

  test('no toca estado_pago', async () => {
    const { json } = await crear(RECOGER);
    await cambiarEstado(json.data.id, 'entregado');
    assert.equal((await leerPedido(json.data.id)).estado_pago, 'pendiente');
  });

  test('[actual, hallazgo 10] acepta cualquier transición: de entregado a pendiente y de cancelado a en_preparacion', async () => {
    const { json } = await crear(RECOGER);
    const id = json.data.id;
    assert.equal((await cambiarEstado(id, 'entregado')).estado, 200);
    assert.equal((await cambiarEstado(id, 'pendiente')).estado, 200);
    assert.equal((await cambiarEstado(id, 'cancelado')).estado, 200);
    assert.equal((await cambiarEstado(id, 'en_preparacion')).estado, 200);
    assert.equal((await leerPedido(id)).estado, 'en_preparacion');
  });

  test('[actual, hallazgo 12] servir el último pedido de una mesa la libera aunque no esté pagado', async () => {
    const { json } = await crear({ tipo_pedido: 'mesa', mesa_numero: 5, lineas: LINEAS });
    assert.equal(await leerEstadoMesa(5), 'ocupada');

    await cambiarEstado(json.data.id, 'servido');

    assert.equal(await leerEstadoMesa(5), 'libre');
    assert.equal((await leerPedido(json.data.id)).estado_pago, 'pendiente');
  });

  test('la mesa sigue ocupada si le queda otro pedido activo', async () => {
    const a = await crear({ tipo_pedido: 'mesa', mesa_numero: 7, lineas: LINEAS });
    await crear({ tipo_pedido: 'mesa', mesa_numero: 7, lineas: LINEAS });

    await cambiarEstado(a.json.data.id, 'servido');

    assert.equal(await leerEstadoMesa(7), 'ocupada');
  });

  test('cancelar el último pedido de una mesa la libera', async () => {
    const { json } = await crear({ tipo_pedido: 'mesa', mesa_numero: 8, lineas: LINEAS });
    await cambiarEstado(json.data.id, 'cancelado');
    assert.equal(await leerEstadoMesa(8), 'libre');
  });
});
