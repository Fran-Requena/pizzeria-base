package es.fpmola.pizzeria.diagnostico

/**
 * Versión y commit con los que se compiló el APK (los pone el CI; en una compilación
 * local el commit es "local").
 */
data class InfoCompilacion(val version: String, val commit: String)

/**
 * Un apunte del registro de diagnóstico.
 *
 * @property momento fecha y hora ya formateadas para mostrarlas.
 * @property categoria tipo de suceso (ver [CategoriaDiagnostico]).
 * @property texto qué ocurrió. Nunca lleva datos personales: solo ids, estados y códigos.
 */
data class EventoDiagnostico(val momento: String, val categoria: String, val texto: String)

/** Categorías de los apuntes del registro. */
object CategoriaDiagnostico {
    const val PROCESO = "proceso"
    const val ACTIVIDAD = "actividad"
    const val ARRANQUE = "arranque"
    const val PEDIDO = "pedido"
    const val PAGO = "pago"
    const val NAVEGACION = "navegacion"
}

/**
 * Registro corto de lo que le pasa a la app, guardado en el teléfono para que
 * sobreviva al cierre del proceso. Sirve para entender, sin herramientas de
 * desarrollo, qué hizo la app al pagar y al volver (ver pantalla de diagnóstico).
 *
 * Guarda solo los últimos apuntes. No debe recibir datos personales.
 */
interface RegistroDiagnostico {

    /** Añade un apunte con la hora actual. Nunca lanza excepciones. */
    fun anotar(categoria: String, texto: String)

    /** Los apuntes guardados, del más antiguo al más reciente. */
    fun eventos(): List<EventoDiagnostico>

    /** Borra todos los apuntes. */
    fun borrar()
}
