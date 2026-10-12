package es.fpmola.pizzeria.prueba

import es.fpmola.pizzeria.ajustes.AjustesServidor
import es.fpmola.pizzeria.diagnostico.EventoDiagnostico
import es.fpmola.pizzeria.diagnostico.RegistroDiagnostico
import es.fpmola.pizzeria.pagos.AbridorUrl
import es.fpmola.pizzeria.pagos.MENSAJE_URL_NO_SEGURA
import es.fpmola.pizzeria.pagos.ResultadoAbrirUrl
import es.fpmola.pizzeria.pagos.esUrlSegura
import es.fpmola.pizzeria.pedidos.PedidoEnCurso
import es.fpmola.pizzeria.red.ClienteApi
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpResponseData
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf

/** URL base usada en los tests (nunca se contacta: el motor es simulado). */
const val URL_PRUEBA = "https://servidor.prueba"

/** AjustesServidor en memoria para los tests. */
class AjustesEnMemoria(var url: String? = URL_PRUEBA) : AjustesServidor {
    override fun obtenerUrlBase(): String? = url
    override fun guardarUrlBase(url: String) {
        this.url = url
    }
}

/** RegistroDiagnostico en memoria para los tests: la hora de cada apunte es su número de orden. */
class RegistroEnMemoria : RegistroDiagnostico {
    private val lista = mutableListOf<EventoDiagnostico>()

    override fun anotar(categoria: String, texto: String) {
        lista += EventoDiagnostico(momento = "t${lista.size + 1}", categoria = categoria, texto = texto)
    }

    override fun eventos(): List<EventoDiagnostico> = lista.toList()

    override fun borrar() {
        lista.clear()
    }
}

/** PedidoEnCurso en memoria para los tests. */
class PedidoEnCursoEnMemoria(var id: Int? = null) : PedidoEnCurso {
    override fun obtenerId(): Int? = id
    override fun guardarId(id: Int) {
        this.id = id
    }
    override fun olvidar() {
        id = null
    }
}

/**
 * Abridor de URL de prueba: aplica la misma comprobación que el real y guarda
 * en [abiertas] las URLs que "abriría".
 */
class AbridorFalso : AbridorUrl {
    val abiertas = mutableListOf<String>()

    override fun abrir(url: String): ResultadoAbrirUrl {
        if (!esUrlSegura(url)) return ResultadoAbrirUrl.Fallida(MENSAJE_URL_NO_SEGURA)
        abiertas += url
        return ResultadoAbrirUrl.Abierta
    }
}

/** Responde con un cuerpo JSON y el código indicado. */
fun MockRequestHandleScope.responderJson(
    cuerpo: String,
    estado: HttpStatusCode = HttpStatusCode.OK,
): HttpResponseData = respond(
    content = cuerpo,
    status = estado,
    headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
)

/** Crea un ClienteApi que usa el motor simulado de Ktor en lugar de la red. */
fun crearClientePrueba(
    ajustes: AjustesServidor = AjustesEnMemoria(),
    motor: MockEngine,
): ClienteApi = ClienteApi(ajustes, motor)
