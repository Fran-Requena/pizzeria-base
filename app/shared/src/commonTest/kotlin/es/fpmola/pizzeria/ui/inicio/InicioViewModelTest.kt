package es.fpmola.pizzeria.ui.inicio

import es.fpmola.pizzeria.prueba.AjustesEnMemoria
import es.fpmola.pizzeria.prueba.URL_PRUEBA
import es.fpmola.pizzeria.prueba.crearClientePrueba
import es.fpmola.pizzeria.prueba.responderJson
import es.fpmola.pizzeria.salud.RepositorioSalud
import io.ktor.client.engine.mock.MockEngine
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class InicioViewModelTest {

    private val saludCorrecta = """
        {"status":"UP","service":"pizzeria-backend","timestamp":"2026-10-10T10:15:00.000Z",
         "database":{"connected":true,"db_time":"2026-10-10T10:15:00.012Z"}}
    """.trimIndent()

    private fun crearViewModel(motor: MockEngine, ajustes: AjustesEnMemoria = AjustesEnMemoria()): InicioViewModel =
        InicioViewModel(ajustes, RepositorioSalud(crearClientePrueba(ajustes, motor)))

    @Test
    fun alCrearseMuestraElServidorYEstaComprobando() {
        val modelo = crearViewModel(MockEngine { responderJson(saludCorrecta) })

        assertEquals(URL_PRUEBA, modelo.estado.urlServidor)
        assertEquals(ConexionServidor.Comprobando, modelo.estado.conexion)
    }

    @Test
    fun siElServidorRespondeLaConexionEsCorrecta() = runTest {
        var ruta: String? = null
        val modelo = crearViewModel(
            MockEngine { solicitud ->
                ruta = solicitud.url.encodedPath
                responderJson(saludCorrecta)
            },
        )

        modelo.comprobar()

        assertEquals(ConexionServidor.Correcta, modelo.estado.conexion)
        assertEquals("/api/health", ruta)
    }

    @Test
    fun siFallaLaRedHayUnMensajeClaroYNoSeTocaElServidor() = runTest {
        val ajustes = AjustesEnMemoria()
        val modelo = crearViewModel(MockEngine { throw RuntimeException("sin cobertura") }, ajustes)

        modelo.comprobar()

        val fallida = assertIs<ConexionServidor.Fallida>(modelo.estado.conexion)
        assertTrue(fallida.mensaje.contains("No se ha podido conectar con el servidor"), fallida.mensaje)
        // La app no cambia de servidor por su cuenta.
        assertEquals(URL_PRUEBA, ajustes.obtenerUrlBase())
        assertEquals(URL_PRUEBA, modelo.estado.urlServidor)
    }

    @Test
    fun siLaBaseDeDatosEstaCaidaSeAvisa() = runTest {
        val modelo = crearViewModel(
            MockEngine {
                responderJson(
                    """{"status":"DEGRADED","database":{"connected":false}}""",
                    HttpStatusCode.InternalServerError,
                )
            },
        )

        modelo.comprobar()

        assertEquals(
            ConexionServidor.Fallida("El servidor responde, pero la base de datos no"),
            modelo.estado.conexion,
        )
    }

    @Test
    fun reintentarVuelveAComprobarYSePuedeRecuperar() = runTest {
        var peticiones = 0
        val modelo = crearViewModel(
            MockEngine {
                peticiones++
                if (peticiones == 1) throw RuntimeException("sin cobertura") else responderJson(saludCorrecta)
            },
        )

        modelo.comprobar()
        assertIs<ConexionServidor.Fallida>(modelo.estado.conexion)

        modelo.comprobar()

        assertEquals(ConexionServidor.Correcta, modelo.estado.conexion)
        assertEquals(2, peticiones)
    }

    @Test
    fun sinServidorGuardadoElEstadoNoTieneUrlYFalla() = runTest {
        val modelo = crearViewModel(MockEngine { responderJson(saludCorrecta) }, AjustesEnMemoria(url = null))

        modelo.comprobar()

        assertEquals(null, modelo.estado.urlServidor)
        assertIs<ConexionServidor.Fallida>(modelo.estado.conexion)
    }
}
