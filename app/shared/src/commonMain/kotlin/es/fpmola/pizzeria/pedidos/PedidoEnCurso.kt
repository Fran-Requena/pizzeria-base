package es.fpmola.pizzeria.pedidos

/**
 * Pedido que la app sigue, guardado en el dispositivo.
 *
 * Solo se guarda el id del pedido: ni nombre, ni teléfono, ni dirección. Sirve
 * para volver a la pantalla de seguimiento si la app se recrea o el proceso se
 * cierra mientras el cliente paga en el navegador. Todo lo demás se vuelve a
 * pedir al servidor con GET /api/pedidos/{id}.
 */
interface PedidoEnCurso {

    /** Id del pedido que se sigue, o null si no hay ninguno. */
    fun obtenerId(): Int?

    /** Guarda el id del pedido que se sigue (sustituye al anterior, si lo hay). */
    fun guardarId(id: Int)

    /** Deja de seguir el pedido: borra el id guardado. */
    fun olvidar()
}
