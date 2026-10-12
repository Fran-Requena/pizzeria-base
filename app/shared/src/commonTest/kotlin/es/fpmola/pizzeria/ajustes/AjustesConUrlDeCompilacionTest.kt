package es.fpmola.pizzeria.ajustes

import es.fpmola.pizzeria.prueba.AjustesEnMemoria
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AjustesConUrlDeCompilacionTest {

    private val urlCompilacion = "https://dam-01.guillermofoix.org"
    private val urlGuardada = "https://otro.servidor.org"

    @Test
    fun laUrlGuardadaEnElTelefonoTienePrioridad() {
        val ajustes = AjustesConUrlDeCompilacion(AjustesEnMemoria(urlGuardada), urlCompilacion)

        assertEquals(urlGuardada, ajustes.obtenerUrlBase())
    }

    @Test
    fun sinUrlGuardadaSeUsaLaDeLaCompilacion() {
        val ajustes = AjustesConUrlDeCompilacion(AjustesEnMemoria(url = null), urlCompilacion)

        assertEquals(urlCompilacion, ajustes.obtenerUrlBase())
        assertEquals(urlCompilacion, ajustes.obtenerUrlDeCompilacion())
    }

    @Test
    fun sinNingunaUrlNoHayServidorYSePideEnLaConfiguracion() {
        for (compilacion in listOf(null, "", "   ")) {
            val ajustes = AjustesConUrlDeCompilacion(AjustesEnMemoria(url = null), compilacion)

            assertNull(ajustes.obtenerUrlBase(), "compilación: '$compilacion'")
            assertNull(ajustes.obtenerUrlDeCompilacion(), "compilación: '$compilacion'")
        }
    }

    @Test
    fun unaUrlDeCompilacionNoValidaSeIgnora() {
        val invalidas = listOf(
            "http://dam-01.guillermofoix.org",
            "dam-01.guillermofoix.org",
            "https://",
            "https://dam 01.org",
            "https://dam-01.org/?x=1",
        )
        for (compilacion in invalidas) {
            val ajustes = AjustesConUrlDeCompilacion(AjustesEnMemoria(url = null), compilacion)

            assertNull(ajustes.obtenerUrlBase(), compilacion)
            assertNull(ajustes.obtenerUrlDeCompilacion(), compilacion)
        }
    }

    @Test
    fun laUrlDeCompilacionSeNormalizaComoLaDelUsuario() {
        val ajustes = AjustesConUrlDeCompilacion(AjustesEnMemoria(url = null), "  https://dam-01.guillermofoix.org/  ")

        assertEquals(urlCompilacion, ajustes.obtenerUrlBase())
    }

    @Test
    fun guardarUnaUrlLaDejaPorEncimaDeLaDeLaCompilacion() {
        val guardados = AjustesEnMemoria(url = null)
        val ajustes = AjustesConUrlDeCompilacion(guardados, urlCompilacion)

        ajustes.guardarUrlBase(urlGuardada)

        assertEquals(urlGuardada, guardados.url)
        assertEquals(urlGuardada, ajustes.obtenerUrlBase())
        // La de la compilación sigue disponible, por ejemplo para saber que el APK la trae.
        assertEquals(urlCompilacion, ajustes.obtenerUrlDeCompilacion())
    }

    @Test
    fun unApkGenericoNoTieneUrlDeCompilacion() {
        assertNull(AjustesEnMemoria(urlGuardada).obtenerUrlDeCompilacion())
    }
}
