package es.fpmola.pizzeria.pedidos

import es.fpmola.pizzeria.prueba.AjustesEnMemoria
import es.fpmola.pizzeria.prueba.PedidoEnCursoEnMemoria
import es.fpmola.pizzeria.prueba.crearClientePrueba
import es.fpmola.pizzeria.prueba.jsonPedido
import es.fpmola.pizzeria.prueba.responderJson
import io.ktor.client.engine.mock.MockEngine
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class ArranquePedidoTest {

    private class Escenario(
        motor: MockEngine,
        idGuardado: Int? = 104,
        urlServidor: String? = "https://servidor.prueba",
    ) {
        val almacen = PedidoEnCursoEnMemoria(idGuardado)
        val repositorio = RepositorioPedidos(crearClientePrueba(AjustesEnMemoria(urlServidor), motor))

        suspend fun decidir() = decidirArranque(almacen, repositorio)
    }

    private fun servidorDevuelve(cuerpo: String, estado: HttpStatusCode = HttpStatusCode.OK) =
        MockEngine { responderJson(cuerpo, estado) }

    // --- Sin id guardado -----------------------------------------------------

    @Test
    fun sinIdGuardadoArrancaNormalYNoConsultaAlServidor() = runTest {
        var peticiones = 0
        val motor = MockEngine {
            peticiones++
            responderJson("{}")
        }
        val escenario = Escenario(motor, idGuardado = null)

        assertIs<DecisionArranque.ArranqueNormal>(escenario.decidir())

        assertEquals(0, peticiones)
        assertNull(escenario.almacen.obtenerId())
    }

    // --- Pedido vivo ---------------------------------------------------------

    @Test
    fun conUnPedidoVivoSeSigueYSeConservaElId() = runTest {
        for (estado in listOf("pendiente", "en_preparacion", "en_reparto", "listo")) {
            val escenario = Escenario(servidorDevuelve(jsonPedido(estado = estado)))

            val decision = escenario.decidir()

            assertIs<DecisionArranque.SeguirPedido>(decision, estado)
            assertEquals(104, decision.pedidoId)
            assertEquals(estado, decision.pedido?.estado)
            assertEquals(104, escenario.almacen.obtenerId(), estado)
        }
    }

    @Test
    fun consultaElPedidoGuardado() = runTest {
        var ruta: String? = null
        val motor = MockEngine { solicitud ->
            ruta = solicitud.url.encodedPath
            responderJson(jsonPedido(estado = "pendiente"))
        }
        val escenario = Escenario(motor)

        escenario.decidir()

        assertEquals("/api/pedidos/104", ruta)
    }

    @Test
    fun unPedidoConTarjetaPagadoQueSigueEnPreparacionSeSigue() = runTest {
        val escenario = Escenario(
            servidorDevuelve(jsonPedido(estado = "en_preparacion", estadoPago = "pagado", metodoPago = "stripe")),
        )

        assertIs<DecisionArranque.SeguirPedido>(escenario.decidir())
        assertEquals(104, escenario.almacen.obtenerId())
    }

    @Test
    fun unPedidoConTarjetaSinPagarSeSigueAunqueSuEstadoSeaFinal() = runTest {
        // Mismo criterio que el sondeo: mientras falte el pago, se sigue.
        val escenario = Escenario(
            servidorDevuelve(jsonPedido(estado = "entregado", estadoPago = "pendiente", metodoPago = "stripe")),
        )

        val decision = escenario.decidir()

        assertIs<DecisionArranque.SeguirPedido>(decision)
        assertFalse(decision.pedido!!.seguimientoTerminado)
        assertEquals(104, escenario.almacen.obtenerId())
    }

    // --- Pedido terminado ----------------------------------------------------

    @Test
    fun conUnPedidoTerminadoSeOlvidaElIdYArrancaNormal() = runTest {
        for (estado in listOf("servido", "entregado", "cancelado")) {
            val escenario = Escenario(servidorDevuelve(jsonPedido(estado = estado)))

            assertIs<DecisionArranque.ArranqueNormal>(escenario.decidir(), estado)

            assertNull(escenario.almacen.obtenerId(), estado)
        }
    }

    @Test
    fun unPedidoCanceladoConTarjetaSinPagarSeOlvida() = runTest {
        // Cancelado: ya no se cobrará, así que no hay pago que esperar.
        val escenario = Escenario(
            servidorDevuelve(jsonPedido(estado = "cancelado", estadoPago = "pendiente", metodoPago = "stripe")),
        )

        assertIs<DecisionArranque.ArranqueNormal>(escenario.decidir())

        assertNull(escenario.almacen.obtenerId())
    }

    @Test
    fun unPedidoEntregadoYPagadoConTarjetaSeOlvida() = runTest {
        val escenario = Escenario(
            servidorDevuelve(jsonPedido(estado = "entregado", estadoPago = "pagado", metodoPago = "stripe")),
        )

        assertIs<DecisionArranque.ArranqueNormal>(escenario.decidir())

        assertNull(escenario.almacen.obtenerId())
    }

    // --- El pedido no existe o el error es permanente ------------------------

    @Test
    fun siElPedidoNoExisteSeOlvidaElIdYArrancaNormal() = runTest {
        val escenario = Escenario(
            servidorDevuelve("""{"success":false,"message":"Pedido #104 no encontrado"}""", HttpStatusCode.NotFound),
        )

        assertIs<DecisionArranque.ArranqueNormal>(escenario.decidir())

        assertNull(escenario.almacen.obtenerId())
    }

    @Test
    fun unErrorPermanenteDelServidorOlvidaElId() = runTest {
        for (codigo in listOf(HttpStatusCode.BadRequest, HttpStatusCode.Forbidden, HttpStatusCode.Gone)) {
            val escenario = Escenario(servidorDevuelve("{}", codigo))

            assertIs<DecisionArranque.ArranqueNormal>(escenario.decidir(), "$codigo")

            assertNull(escenario.almacen.obtenerId(), "$codigo")
        }
    }

    // --- Fallos temporales: no se pierde el pedido ---------------------------

    @Test
    fun siFallaLaRedSeConservaElIdYSeSigueElPedido() = runTest {
        val escenario = Escenario(MockEngine { throw RuntimeException("sin cobertura") })

        val decision = escenario.decidir()

        assertIs<DecisionArranque.SeguirPedido>(decision)
        assertEquals(104, decision.pedidoId)
        assertNull(decision.pedido)
        assertEquals(104, escenario.almacen.obtenerId())
    }

    @Test
    fun unFalloTemporalDelServidorConservaElId() = runTest {
        val temporales = listOf(
            HttpStatusCode.InternalServerError,
            HttpStatusCode.BadGateway,
            HttpStatusCode.ServiceUnavailable,
            HttpStatusCode.RequestTimeout,
            HttpStatusCode.TooManyRequests,
        )
        for (codigo in temporales) {
            val escenario = Escenario(servidorDevuelve("{}", codigo))

            val decision = escenario.decidir()

            assertIs<DecisionArranque.SeguirPedido>(decision, "$codigo")
            assertNull(decision.pedido, "$codigo")
            assertEquals(104, escenario.almacen.obtenerId(), "$codigo")
        }
    }

    @Test
    fun unaRespuestaIlegibleConservaElId() = runTest {
        val escenario = Escenario(servidorDevuelve("<html>Bad gateway</html>"))

        assertIs<DecisionArranque.SeguirPedido>(escenario.decidir())

        assertEquals(104, escenario.almacen.obtenerId())
    }

    @Test
    fun sinServidorConfiguradoArrancaNormalYConservaElId() = runTest {
        val escenario = Escenario(servidorDevuelve("{}"), urlServidor = null)

        assertIs<DecisionArranque.ArranqueNormal>(escenario.decidir())

        assertEquals(104, escenario.almacen.obtenerId())
    }

    // --- Cuándo se comprueba el pedido guardado ------------------------------

    @Test
    fun sinPedidoGuardadoNuncaSeComprueba() {
        for (enActividad in listOf(false, true)) {
            for (enProceso in listOf(false, true)) {
                assertFalse(debeComprobarPedidoGuardado(false, enActividad, enProceso))
            }
        }
    }

    @Test
    fun alAbrirDeCeroSeComprueba() {
        // Arranque en frío: ni la actividad ni el proceso lo han comprobado.
        assertTrue(debeComprobarPedidoGuardado(true, resueltoEnActividad = false, comprobadoEnProceso = false))
    }

    @Test
    fun trasQuitarLaAppDeRecientesConElProcesoVivoSeComprueba() {
        // El fallo observado: el proceso ya comprobó (ya no había pedido), pero la
        // actividad empieza de cero y ahora sí hay un pedido guardado.
        assertTrue(debeComprobarPedidoGuardado(true, resueltoEnActividad = false, comprobadoEnProceso = true))
    }

    @Test
    fun siAndroidCierraElProcesoYRestauraLaActividadSeComprueba() {
        // La actividad se restaura con su estado, pero el proceso nuevo no ha comprobado nada.
        assertTrue(debeComprobarPedidoGuardado(true, resueltoEnActividad = true, comprobadoEnProceso = false))
    }

    @Test
    fun alGirarLaPantallaNoSeVuelveAComprobar() {
        assertFalse(debeComprobarPedidoGuardado(true, resueltoEnActividad = true, comprobadoEnProceso = true))
    }

    // --- Criterio de pedido terminado ----------------------------------------

    @Test
    fun seguimientoTerminadoCoincideConElCriterioDelSondeo() = runTest {
        suspend fun terminado(estado: String, estadoPago: String, metodoPago: String): Boolean {
            val cliente = crearClientePrueba(
                AjustesEnMemoria(),
                servidorDevuelve(jsonPedido(estado, estadoPago, metodoPago)),
            )
            return RepositorioPedidos(cliente).obtenerPedido(104).seguimientoTerminado
        }

        assertFalse(terminado("pendiente", "pendiente", "efectivo_entrega"))
        assertTrue(terminado("entregado", "pendiente", "efectivo_entrega"))
        assertFalse(terminado("entregado", "pendiente", "stripe"))
        assertTrue(terminado("entregado", "pagado", "stripe"))
        assertTrue(terminado("cancelado", "pendiente", "stripe"))
    }
}
