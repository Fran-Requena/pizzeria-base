package es.fpmola.pizzeria.diagnostico

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Implementación de [RegistroDiagnostico] con SharedPreferences: un solo texto
 * con un apunte por línea ("momento|categoria|texto"). Se queda con los últimos
 * [MAXIMO_EVENTOS] apuntes. Todo se protege con try/catch: el diagnóstico nunca
 * debe romper la app.
 */
class RegistroDiagnosticoAndroid(contexto: Context) : RegistroDiagnostico {

    private val preferencias = contexto.applicationContext
        .getSharedPreferences(NOMBRE_PREFERENCIAS, Context.MODE_PRIVATE)

    @Synchronized
    override fun anotar(categoria: String, texto: String) {
        try {
            val momento = SimpleDateFormat(FORMATO_MOMENTO, Locale.getDefault()).format(Date())
            val linea = listOf(momento, limpiar(categoria), limpiar(texto)).joinToString(SEPARADOR)
            val lineas = (leerLineas() + linea).takeLast(MAXIMO_EVENTOS)
            preferencias.edit().putString(CLAVE_EVENTOS, lineas.joinToString("\n")).apply()
        } catch (e: Exception) {
            // El diagnóstico no puede romper la app.
        }
    }

    @Synchronized
    override fun eventos(): List<EventoDiagnostico> =
        try {
            leerLineas().mapNotNull { linea ->
                val partes = linea.split(SEPARADOR, limit = 3)
                if (partes.size == 3) EventoDiagnostico(partes[0], partes[1], partes[2]) else null
            }
        } catch (e: Exception) {
            emptyList()
        }

    @Synchronized
    override fun borrar() {
        preferencias.edit().remove(CLAVE_EVENTOS).apply()
    }

    private fun leerLineas(): List<String> =
        preferencias.getString(CLAVE_EVENTOS, null)
            ?.split("\n")
            ?.filter { it.isNotBlank() }
            .orEmpty()

    /** Quita los saltos de línea y el separador para no romper el formato. */
    private fun limpiar(texto: String): String =
        texto.replace('\n', ' ').replace('\r', ' ').replace(SEPARADOR, "/").take(MAXIMO_TEXTO)

    private companion object {
        const val NOMBRE_PREFERENCIAS = "diagnostico"
        const val CLAVE_EVENTOS = "eventos"
        const val SEPARADOR = "|"
        const val FORMATO_MOMENTO = "dd/MM HH:mm:ss"
        const val MAXIMO_EVENTOS = 80
        const val MAXIMO_TEXTO = 200
    }
}
