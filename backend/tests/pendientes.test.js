/**
 * Comportamiento CORRECTO que aún no cumple el backend (MEJORAS.md, sección 11).
 *
 * Son test.todo: aparecen en el informe como pendientes y no ponen el CI en rojo.
 * Al arreglar un hallazgo, convierte su todo en un test real y actualiza o borra el
 * test "[actual, hallazgo N]" correspondiente en el mismo commit.
 */
import { describe, test } from 'node:test';

describe('Hallazgo 1 (M-06): pagado en Stripe con el webhook caído', () => {
  test.todo('un pedido pagado en Stripe queda marcado como pagado aunque el webhook no llegue (reconciliación desde el servidor)');
  test.todo('la reconciliación encuentra la sesión pagada aunque stripe_session_id apunte a una sesión posterior');
});

describe('Hallazgo 3 (M-26): varias sesiones de Stripe vivas', () => {
  test.todo('crear-sesion reutiliza la sesión abierta del pedido o expira la anterior: nunca hay dos sesiones cobrables a la vez');
  test.todo('un segundo pago de Stripe del mismo pedido queda registrado y se detecta');
});

describe('Hallazgo 5 (M-26): descuento no cobrado en Stripe', () => {
  test.todo('crear-sesion cobra en Stripe el total del pedido con su descuento, no la suma de las líneas a precio completo');
});

describe('Hallazgo 10 (M-27): transiciones de estado libres', () => {
  test.todo('/estado rechaza las transiciones no permitidas (de entregado a pendiente, de cancelado a en_preparacion)');
  test.todo('/comanda rechaza las mismas transiciones no permitidas que /estado');
});

describe('Hallazgo 12 (M-27): mesa liberada sin cobrar', () => {
  test.todo('la mesa solo se libera cuando su último pedido está servido o entregado y pagado');
  test.todo('servir un pedido de mesa sin pagar deja la mesa ocupada');
});
