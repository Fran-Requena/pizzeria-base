package es.fpmola.pizzeria.ui.inicio

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import es.fpmola.pizzeria.ajustes.AjustesServidor
import es.fpmola.pizzeria.salud.RepositorioSalud
import es.fpmola.pizzeria.salud.ResultadoSalud

/** Estado de la conexión con el servidor que se muestra en el inicio. */
sealed interface ConexionServidor {

    /** La comprobación está en curso (la pantalla no se bloquea). */
    object Comprobando : ConexionServidor

    /** El servidor y su base de datos responden. */
    object Correcta : ConexionServidor

    /** No se pudo comprobar; [mensaje] explica el motivo. */
    data class Fallida(val mensaje: String) : ConexionServidor
}

/**
 * Estado del inicio.
 *
 * @property urlServidor servidor al que apunta la app, o null si no hay ninguno.
 * @property servidorFijadoEnCompilacion true si el APK trae el servidor fijado al
 * compilar: entonces cambiarlo no es parte del flujo normal.
 */
data class EstadoInicio(
    val urlServidor: String?,
    val servidorFijadoEnCompilacion: Boolean = false,
    val conexion: ConexionServidor = ConexionServidor.Comprobando,
)

/**
 * Lógica del inicio: comprueba en segundo plano que el servidor responde
 * (GET /api/health). La pantalla se muestra ya, sin esperar el resultado; si
 * falla, ofrece reintentar. Nunca propone cambiar de servidor por su cuenta.
 */
class InicioViewModel(
    private val ajustes: AjustesServidor,
    private val repositorioSalud: RepositorioSalud,
) : ViewModel() {

    var estado by mutableStateOf(estadoInicial())
        private set

    private fun estadoInicial() = EstadoInicio(
        urlServidor = ajustes.obtenerUrlBase(),
        servidorFijadoEnCompilacion = ajustes.obtenerUrlDeCompilacion() != null,
    )

    /** Comprueba la conexión con el servidor actual y actualiza el estado. */
    suspend fun comprobar() {
        estado = estadoInicial()
        val conexion = when (val resultado = repositorioSalud.comprobar()) {
            is ResultadoSalud.Correcta -> ConexionServidor.Correcta
            is ResultadoSalud.Fallida -> ConexionServidor.Fallida(resultado.mensaje)
        }
        estado = estado.copy(conexion = conexion)
    }
}
