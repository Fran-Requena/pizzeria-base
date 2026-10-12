package es.fpmola.pizzeria.diagnostico

import es.fpmola.pizzeria.ajustes.AjustesServidor
import es.fpmola.pizzeria.pedidos.PedidoEnCurso

/** De dónde sale la URL del servidor que usa la app. */
enum class OrigenUrl(val etiqueta: String) {
    GuardadaEnElTelefono("guardada en el teléfono"),
    FijadaAlCompilar("fijada al compilar el APK"),
    Ninguna("ninguna: se pedirá en la configuración"),
}

/**
 * Foto del estado de la app para la pantalla de diagnóstico. No lleva datos
 * personales: solo versión, direcciones, ids y apuntes del registro.
 *
 * @property urlGuardada la guardada en el teléfono, aunque no sea la activa.
 * @property urlCompilacion la fijada al compilar, aunque no sea la activa.
 * @property pedidoGuardado id del pedido que la app sigue, o null si no hay.
 * @property ultimoArranque último apunte de la comprobación al arrancar, o null si
 * todavía no hay ninguno.
 * @property eventos todos los apuntes, del más reciente al más antiguo.
 */
data class Diagnostico(
    val version: String,
    val commit: String,
    val urlActiva: String?,
    val origenUrl: OrigenUrl,
    val urlGuardada: String?,
    val urlCompilacion: String?,
    val pedidoGuardado: Int?,
    val ultimoArranque: EventoDiagnostico?,
    val eventos: List<EventoDiagnostico>,
)

/** Reúne el estado actual de la app en un [Diagnostico]. */
fun construirDiagnostico(
    info: InfoCompilacion,
    ajustes: AjustesServidor,
    pedidoEnCurso: PedidoEnCurso,
    registro: RegistroDiagnostico,
): Diagnostico {
    val guardada = ajustes.obtenerUrlGuardada()
    val compilacion = ajustes.obtenerUrlDeCompilacion()
    val eventos = registro.eventos().asReversed()
    return Diagnostico(
        version = info.version,
        commit = info.commit,
        urlActiva = ajustes.obtenerUrlBase(),
        origenUrl = when {
            guardada != null -> OrigenUrl.GuardadaEnElTelefono
            compilacion != null -> OrigenUrl.FijadaAlCompilar
            else -> OrigenUrl.Ninguna
        },
        urlGuardada = guardada,
        urlCompilacion = compilacion,
        pedidoGuardado = pedidoEnCurso.obtenerId(),
        ultimoArranque = eventos.firstOrNull { it.categoria == CategoriaDiagnostico.ARRANQUE },
        eventos = eventos,
    )
}
