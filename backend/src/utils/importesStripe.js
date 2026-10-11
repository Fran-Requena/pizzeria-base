/**
 * Importes para Stripe: conversión exacta de euros a céntimos y líneas de Checkout.
 *
 * PostgreSQL devuelve los NUMERIC como texto ("12.50"). Se convierten a céntimos
 * operando con las cifras del texto, sin multiplicar números de coma flotante
 * (Math.round(1.005 * 100) da 100, no 101).
 */

// Importe mínimo que Stripe admite en un cobro en euros (0,50 €)
export const MINIMO_STRIPE_CENTIMOS = 50;

/** Convierte un importe en euros ("12.50", "9.5" o 12.5) a céntimos enteros, redondeando a la mitad hacia arriba. */
export function aCentimos(valor) {
  const texto = String(valor ?? '').trim();
  const partes = /^(\d+)(?:\.(\d*))?$/.exec(texto);
  if (!partes) {
    throw new Error(`Importe no válido: "${texto}"`);
  }
  const [, enteros, decimales = ''] = partes;
  const tresCifras = (decimales + '000').slice(0, 3);
  let centimos = Number(enteros) * 100 + Number(tresCifras.slice(0, 2));
  if (Number(tresCifras[2]) >= 5) centimos += 1;
  return centimos;
}

/** Formatea céntimos como texto en euros con dos decimales ("0.30"). */
export function formatearEuros(centimos) {
  return `${Math.floor(centimos / 100)}.${String(centimos % 100).padStart(2, '0')}`;
}

/**
 * Construye las line_items de Checkout para que Stripe cobre exactamente el total
 * guardado del pedido (hallazgo 5).
 * - Si el total coincide con la suma de las líneas: una línea por producto.
 * - Si no (descuento o ajuste de precio): una sola línea "Pedido #N" con el total.
 */
export function lineasParaStripe(pedido, lineas) {
  const totalCentimos = aCentimos(pedido.total);
  const porProducto = lineas.map((linea) => ({
    price_data: {
      currency: 'eur',
      product_data: {
        name: linea.nombre,
        description: linea.notas ? `Nota: ${linea.notas}` : undefined,
      },
      unit_amount: aCentimos(linea.precio_unitario),
    },
    quantity: linea.cantidad,
  }));

  const sumaCentimos = porProducto.reduce((suma, l) => suma + l.price_data.unit_amount * l.quantity, 0);
  if (sumaCentimos === totalCentimos) {
    return porProducto;
  }

  return [
    {
      price_data: {
        currency: 'eur',
        product_data: {
          name: `Pedido #${pedido.id}`,
          description: 'Total del pedido con descuentos o ajustes aplicados',
        },
        unit_amount: totalCentimos,
      },
      quantity: 1,
    },
  ];
}
