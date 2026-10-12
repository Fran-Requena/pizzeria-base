package es.fpmola.pizzeria.pedidos

import es.fpmola.pizzeria.red.ErrorRed
import kotlin.coroutines.cancellation.CancellationException

/**
 * true si ya no hace falta seguir el pedido: está en un estado final y, si se
 * paga con tarjeta, no queda un pago por esperar. Es el mismo criterio con el
 * que el sondeo de la pantalla de seguimiento termina. Un pedido cancelado no
 * espera ningún pago.
 */
val Pedido.seguimientoTerminado: Boolean
    get() = esFinal && !pagoConTarjetaPendiente

/** Qué hace la app al arrancar respecto al pedido guardado. */
sealed interface DecisionArranque {

    /** No hay nada que retomar: la app arranca como siempre. */
    object ArranqueNormal : DecisionArranque

    /**
     * Hay un pedido que seguir: se abre la pantalla de seguimiento.
     *
     * @property pedido el pedido consultado, o null si no se pudo consultar
     * (sin red o fallo temporal del servidor); la pantalla seguirá intentándolo.
     */
    data class SeguirPedido(val pedidoId: Int, val pedido: Pedido?) : DecisionArranque
}

/**
 * Decide qué hacer al arrancar con el pedido guardado en [almacen]:
 * - Sin id guardado: arranque normal, sin consultar nada.
 * - Pedido vivo: seguirlo.
 * - Pedido terminado (ver [seguimientoTerminado]), inexistente (404) o error
 *   permanente del servidor (4xx): se olvida el id y arranque normal.
 * - Error de red o fallo temporal (5xx, 408, 429, respuesta ilegible): el id
 *   se conserva y se sigue el pedido; la pantalla reintenta. Borrarlo aquí
 *   haría perder un pedido pagado solo por no tener cobertura al abrir la app.
 * - Sin servidor configurado: arranque normal y el id se conserva.
 */
suspend fun decidirArranque(
    almacen: PedidoEnCurso,
    repositorio: RepositorioPedidos,
): DecisionArranque {
    val id = almacen.obtenerId() ?: return DecisionArranque.ArranqueNormal

    val pedido = try {
        repositorio.obtenerPedido(id)
    } catch (e: CancellationException) {
        throw e
    } catch (e: ErrorRed.SinServidorConfigurado) {
        return DecisionArranque.ArranqueNormal
    } catch (e: ErrorRed.Servidor) {
        if (esErrorPermanente(e.codigo)) {
            almacen.olvidar()
            return DecisionArranque.ArranqueNormal
        }
        return DecisionArranque.SeguirPedido(id, pedido = null)
    } catch (e: Exception) {
        // Sin conexión, respuesta ilegible o cualquier imprevisto: no se pierde el pedido.
        return DecisionArranque.SeguirPedido(id, pedido = null)
    }

    if (pedido.seguimientoTerminado) {
        almacen.olvidar()
        return DecisionArranque.ArranqueNormal
    }
    return DecisionArranque.SeguirPedido(id, pedido)
}

/** Un 4xx es permanente (no existe, id no válido...), salvo 408 y 429, que se pueden reintentar. */
private fun esErrorPermanente(codigo: Int): Boolean =
    codigo in 400..499 && codigo != 408 && codigo != 429
