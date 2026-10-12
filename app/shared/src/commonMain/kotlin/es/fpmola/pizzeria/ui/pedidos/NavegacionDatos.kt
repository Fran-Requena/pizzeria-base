package es.fpmola.pizzeria.ui.pedidos

/**
 * true si la pantalla de datos debe volver al carrito porque no hay nada que enviar.
 *
 * Con el carrito vacío solo se vuelve si NO se está enviando y no hay pedido creado.
 * Al crear un pedido el carrito se vacía en seguida, pero el envío sigue en marcha
 * (con tarjeta, todavía hay que crear la sesión de pago y abrir el navegador) y el
 * pedido creado se publica al final. Si en medio se volviera al carrito, la pantalla
 * de datos saldría de la composición y la app nunca pasaría a la confirmación: al
 * volver del pago el cliente vería el carrito vacío en lugar del seguimiento.
 */
fun debeVolverAlCarritoVacio(carritoVacio: Boolean, estado: EstadoDatosPedido): Boolean =
    carritoVacio && !estado.enviando && estado.pedidoCreado == null
