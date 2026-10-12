package es.fpmola.pizzeria.diagnostico

import es.fpmola.pizzeria.ajustes.AjustesConUrlDeCompilacion
import es.fpmola.pizzeria.prueba.AjustesEnMemoria
import es.fpmola.pizzeria.prueba.PedidoEnCursoEnMemoria
import es.fpmola.pizzeria.prueba.RegistroEnMemoria
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DiagnosticoTest {

    private val info = InfoCompilacion(version = "1.0", commit = "a1b2c3d")
    private val urlCompilacion = "https://dam-01.guillermofoix.org"
    private val urlGuardada = "https://otro.servidor.org"

    private fun construir(
        guardada: String?,
        compilacion: String?,
        pedido: Int? = null,
        registro: RegistroEnMemoria = RegistroEnMemoria(),
    ) = construirDiagnostico(
        info = info,
        ajustes = AjustesConUrlDeCompilacion(AjustesEnMemoria(url = guardada), compilacion),
        pedidoEnCurso = PedidoEnCursoEnMemoria(pedido),
        registro = registro,
    )

    @Test
    fun muestraLaVersionYElCommit() {
        val d = construir(guardada = null, compilacion = null)

        assertEquals("1.0", d.version)
        assertEquals("a1b2c3d", d.commit)
    }

    @Test
    fun laUrlGuardadaEnElTelefonoEsLaActivaYSuOrigen() {
        val d = construir(guardada = urlGuardada, compilacion = urlCompilacion)

        assertEquals(urlGuardada, d.urlActiva)
        assertEquals(OrigenUrl.GuardadaEnElTelefono, d.origenUrl)
        // Se ve también la de la compilación, aunque no se use.
        assertEquals(urlCompilacion, d.urlCompilacion)
        assertEquals(urlGuardada, d.urlGuardada)
    }

    @Test
    fun sinUrlGuardadaLaActivaEsLaDeLaCompilacion() {
        val d = construir(guardada = null, compilacion = urlCompilacion)

        assertEquals(urlCompilacion, d.urlActiva)
        assertEquals(OrigenUrl.FijadaAlCompilar, d.origenUrl)
        assertNull(d.urlGuardada)
    }

    @Test
    fun sinNingunaUrlElOrigenEsNinguna() {
        val d = construir(guardada = null, compilacion = null)

        assertNull(d.urlActiva)
        assertEquals(OrigenUrl.Ninguna, d.origenUrl)
    }

    @Test
    fun muestraElPedidoGuardadoOLoDejaVacio() {
        assertEquals(104, construir(null, null, pedido = 104).pedidoGuardado)
        assertNull(construir(null, null, pedido = null).pedidoGuardado)
    }

    @Test
    fun losSucesosVanDelMasRecienteAlMasAntiguoYElUltimoArranqueEsElMasReciente() {
        val registro = RegistroEnMemoria()
        registro.anotar(CategoriaDiagnostico.PROCESO, "Proceso iniciado.")
        registro.anotar(CategoriaDiagnostico.ARRANQUE, "primera comprobación")
        registro.anotar(CategoriaDiagnostico.PEDIDO, "otro suceso")
        registro.anotar(CategoriaDiagnostico.ARRANQUE, "segunda comprobación")
        registro.anotar(CategoriaDiagnostico.ACTIVIDAD, "Actividad visible.")

        val d = construir(null, null, registro = registro)

        assertEquals(
            listOf("Actividad visible.", "segunda comprobación", "otro suceso", "primera comprobación", "Proceso iniciado."),
            d.eventos.map { it.texto },
        )
        assertEquals("segunda comprobación", d.ultimoArranque?.texto)
    }

    @Test
    fun sinComprobacionesAlArrancarNoHayUltimoArranque() {
        val registro = RegistroEnMemoria()
        registro.anotar(CategoriaDiagnostico.PROCESO, "Proceso iniciado.")

        assertNull(construir(null, null, registro = registro).ultimoArranque)
    }

    @Test
    fun borrarElRegistroVaciaLosSucesos() {
        val registro = RegistroEnMemoria()
        registro.anotar(CategoriaDiagnostico.PEDIDO, "algo")

        registro.borrar()

        assertTrue(construir(null, null, registro = registro).eventos.isEmpty())
    }
}
