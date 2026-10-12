package es.fpmola.pizzeria.ajustes

/**
 * Añade a unos [AjustesServidor] la URL del servidor fijada al compilar el APK
 * (variable `URL_SERVIDOR` del CI; ver app/README.md).
 *
 * Orden de resolución de la URL del servidor:
 * 1. la guardada en el teléfono (la que el usuario eligió en la configuración);
 * 2. la de la compilación;
 * 3. ninguna: la app la pide en la pantalla de configuración.
 *
 * Una URL de compilación que no sea una URL https válida se ignora, como si no
 * existiera: el APK sería genérico. Guardar una URL siempre se delega en [guardados].
 *
 * @param urlCompilacion valor de la compilación; null o vacío si el APK es genérico.
 */
class AjustesConUrlDeCompilacion(
    private val guardados: AjustesServidor,
    urlCompilacion: String?,
) : AjustesServidor {

    private val urlDeCompilacion: String? =
        (urlCompilacion?.let { validarUrlServidor(it) } as? ValidacionUrl.Valida)?.url

    override fun obtenerUrlBase(): String? = guardados.obtenerUrlBase() ?: urlDeCompilacion

    override fun guardarUrlBase(url: String) {
        guardados.guardarUrlBase(url)
    }

    override fun obtenerUrlDeCompilacion(): String? = urlDeCompilacion

    override fun obtenerUrlGuardada(): String? = guardados.obtenerUrlBase()
}
