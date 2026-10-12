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

/**
 * Si al abrir la app hay que comprobar el pedido guardado en el servidor.
 *
 * Solo se omite cuando se cumplen las DOS condiciones siguientes, que es lo que pasa
 * al girar la pantalla (la actividad se recrea con su estado y el proceso sigue vivo):
 * - [resueltoEnActividad]: el estado guardado de la actividad dice que ya se comprobó.
 * - [comprobadoEnProceso]: este proceso ya hizo la comprobación.
 *
 * Si falla alguna, se comprueba. Quitar la app de "recientes" descarta el estado de la
 * actividad pero puede dejar vivo el proceso (la primera condición falla); y si Android
 * cierra el proceso mientras el cliente paga en el navegador, el proceso nuevo no ha
 * comprobado nada (falla la segunda).
 */
fun debeComprobarPedidoGuardado(
    hayPedidoGuardado: Boolean,
    resueltoEnActividad: Boolean,
    comprobadoEnProceso: Boolean,
): Boolean = hayPedidoGuardado && !(resueltoEnActividad && comprobadoEnProceso)

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
): DecisionArranque = evaluarArranque(almacen, repositorio).decision

/** Por qué [decidirArranque] decidió lo que decidió (para la pantalla de diagnóstico). */
enum class CausaArranque(val etiqueta: String) {
    SinPedidoGuardado("No había ningún pedido guardado."),
    PedidoVivo("El pedido sigue vivo: se abre su seguimiento."),
    PedidoTerminado("El pedido ya había terminado: se olvida el id."),
    PedidoNoExiste("El servidor dice que el pedido no existe (404): se olvida el id."),
    ErrorPermanente("El servidor rechazó la consulta (error permanente): se olvida el id."),
    ErrorTemporal("Fallo temporal del servidor: se conserva el id y se sigue el pedido."),
    SinConexion("Sin conexión con el servidor: se conserva el id y se sigue el pedido."),
    RespuestaIlegible("Respuesta ilegible del servidor: se conserva el id y se sigue el pedido."),
    SinServidor("No hay servidor configurado: se conserva el id."),
}

/**
 * Resultado detallado de la comprobación al arrancar.
 *
 * @property pedidoId id del pedido guardado que se consultó, o null si no había.
 * @property detalle datos útiles sin información personal (estado y pago del pedido,
 * o el código HTTP del error).
 * @property idOlvidado true si la comprobación ha borrado el id guardado.
 */
data class InformeArranque(
    val decision: DecisionArranque,
    val causa: CausaArranque,
    val pedidoId: Int?,
    val detalle: String?,
    val idOlvidado: Boolean,
) {
    /** Texto en español para el diagnóstico, por ejemplo "Pedido n.º 104: El pedido sigue vivo… (estado pendiente, pago pagado)". */
    val resumen: String
        get() = buildString {
            if (pedidoId != null) append("Pedido n.º $pedidoId: ")
            append(causa.etiqueta)
            if (detalle != null) append(" ($detalle)")
        }
}

/** Igual que [decidirArranque], pero devuelve también la causa y si se olvidó el id. */
suspend fun evaluarArranque(
    almacen: PedidoEnCurso,
    repositorio: RepositorioPedidos,
): InformeArranque {
    val id = almacen.obtenerId()
        ?: return InformeArranque(DecisionArranque.ArranqueNormal, CausaArranque.SinPedidoGuardado, null, null, false)

    fun conservar(causa: CausaArranque, detalle: String? = null) =
        InformeArranque(DecisionArranque.SeguirPedido(id, pedido = null), causa, id, detalle, idOlvidado = false)

    fun olvidar(causa: CausaArranque, detalle: String? = null): InformeArranque {
        almacen.olvidar()
        return InformeArranque(DecisionArranque.ArranqueNormal, causa, id, detalle, idOlvidado = true)
    }

    val pedido = try {
        repositorio.obtenerPedido(id)
    } catch (e: CancellationException) {
        throw e
    } catch (e: ErrorRed.SinServidorConfigurado) {
        return InformeArranque(DecisionArranque.ArranqueNormal, CausaArranque.SinServidor, id, null, false)
    } catch (e: ErrorRed.Servidor) {
        val detalle = "código ${e.codigo}"
        return when {
            e.codigo == 404 -> olvidar(CausaArranque.PedidoNoExiste)
            esErrorPermanente(e.codigo) -> olvidar(CausaArranque.ErrorPermanente, detalle)
            else -> conservar(CausaArranque.ErrorTemporal, detalle)
        }
    } catch (e: ErrorRed.SinConexion) {
        return conservar(CausaArranque.SinConexion)
    } catch (e: ErrorRed.RespuestaInvalida) {
        return conservar(CausaArranque.RespuestaIlegible)
    } catch (e: Exception) {
        // Cualquier imprevisto: no se pierde el pedido.
        return conservar(CausaArranque.RespuestaIlegible, "error inesperado")
    }

    val detalle = "estado ${pedido.estado}, pago ${pedido.estadoPago ?: "desconocido"}"
    if (pedido.seguimientoTerminado) {
        return olvidar(CausaArranque.PedidoTerminado, detalle)
    }
    return InformeArranque(DecisionArranque.SeguirPedido(id, pedido), CausaArranque.PedidoVivo, id, detalle, false)
}

/** Un 4xx es permanente (no existe, id no válido...), salvo 408 y 429, que se pueden reintentar. */
private fun esErrorPermanente(codigo: Int): Boolean =
    codigo in 400..499 && codigo != 408 && codigo != 429
