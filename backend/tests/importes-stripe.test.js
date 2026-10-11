/**
 * Importes de Stripe (src/utils/importesStripe.js). No usan la base de datos.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aCentimos, formatearEuros, lineasParaStripe } from '../src/utils/importesStripe.js';

describe('aCentimos', () => {
  test('convierte el texto NUMERIC de PostgreSQL y los números de JSON', () => {
    assert.equal(aCentimos('12.50'), 1250);
    assert.equal(aCentimos('9.5'), 950);
    assert.equal(aCentimos(12.5), 1250);
    assert.equal(aCentimos('0.00'), 0);
    assert.equal(aCentimos('7'), 700);
    assert.equal(aCentimos('19.99'), 1999);
  });

  test('redondea a la mitad hacia arriba sin errores de coma flotante', () => {
    assert.equal(aCentimos('1.005'), 101); // Math.round(1.005 * 100) daría 100
    assert.equal(aCentimos('8.115'), 812);
    assert.equal(aCentimos('0.294'), 29);
  });

  test('rechaza importes que no son un número positivo en euros', () => {
    for (const valor of ['', 'abc', '-1.00', '1,50', null, undefined]) {
      assert.throws(() => aCentimos(valor), /Importe no válido/);
    }
  });
});

describe('formatearEuros', () => {
  test('muestra los céntimos con dos decimales', () => {
    assert.equal(formatearEuros(30), '0.30');
    assert.equal(formatearEuros(1250), '12.50');
    assert.equal(formatearEuros(5), '0.05');
  });
});

describe('lineasParaStripe', () => {
  const LINEAS = [
    { nombre: 'Margherita Clásica', cantidad: 2, precio_unitario: '9.50', notas: null },
    { nombre: 'Cuatro Quesos Cremosa', cantidad: 1, precio_unitario: '13.50', notas: 'Poco hecha' },
  ];

  test('si el total coincide con la suma de las líneas, una línea por producto', () => {
    const items = lineasParaStripe({ id: 7, total: '32.50' }, LINEAS);
    assert.equal(items.length, 2);
    assert.equal(items[0].price_data.unit_amount, 950);
    assert.equal(items[0].quantity, 2);
    assert.equal(items[0].price_data.product_data.description, undefined);
    assert.equal(items[1].price_data.unit_amount, 1350);
    assert.equal(items[1].price_data.product_data.description, 'Nota: Poco hecha');
  });

  test('con descuento, una sola línea "Pedido #N" por el total guardado', () => {
    const items = lineasParaStripe({ id: 7, total: '29.25' }, LINEAS);
    assert.equal(items.length, 1);
    assert.equal(items[0].price_data.product_data.name, 'Pedido #7');
    assert.equal(items[0].price_data.unit_amount, 2925);
    assert.equal(items[0].price_data.currency, 'eur');
    assert.equal(items[0].quantity, 1);
  });

  test('con un ajuste al alza también cobra el total guardado', () => {
    const items = lineasParaStripe({ id: 8, total: '35.00' }, LINEAS);
    assert.equal(items.length, 1);
    assert.equal(items[0].price_data.unit_amount, 3500);
  });
});
