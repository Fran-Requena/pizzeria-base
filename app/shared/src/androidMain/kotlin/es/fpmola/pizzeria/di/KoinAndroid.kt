package es.fpmola.pizzeria.di

import android.content.Context
import es.fpmola.pizzeria.ajustes.AjustesConUrlDeCompilacion
import es.fpmola.pizzeria.ajustes.AjustesServidor
import es.fpmola.pizzeria.ajustes.AjustesServidorAndroid
import es.fpmola.pizzeria.diagnostico.InfoCompilacion
import es.fpmola.pizzeria.diagnostico.RegistroDiagnostico
import es.fpmola.pizzeria.diagnostico.RegistroDiagnosticoAndroid
import es.fpmola.pizzeria.pagos.AbridorUrl
import es.fpmola.pizzeria.pagos.AbridorUrlAndroid
import es.fpmola.pizzeria.pedidos.PedidoEnCurso
import es.fpmola.pizzeria.pedidos.PedidoEnCursoAndroid
import es.fpmola.pizzeria.red.crearMotorHttp
import io.ktor.client.engine.HttpClientEngine
import org.koin.core.context.startKoin
import org.koin.core.module.Module
import org.koin.dsl.module

/** Dependencias propias de Android. */
private fun moduloAndroid(contexto: Context, urlCompilacion: String?, info: InfoCompilacion): Module = module {
    single { info }
    single<RegistroDiagnostico> { RegistroDiagnosticoAndroid(contexto) }
    single<AjustesServidor> {
        AjustesConUrlDeCompilacion(AjustesServidorAndroid(contexto), urlCompilacion)
    }
    single<HttpClientEngine> { crearMotorHttp() }
    single<AbridorUrl> { AbridorUrlAndroid(contexto) }
    single<PedidoEnCurso> { PedidoEnCursoAndroid(contexto) }
}

/**
 * Arranca Koin. Se llama una sola vez, desde Application.onCreate().
 *
 * @param urlCompilacion URL del servidor fijada al compilar el APK (vacía o null
 * si el APK es genérico). Solo se usa si el teléfono no tiene otra guardada.
 * @param info versión y commit con los que se compiló, para el diagnóstico.
 */
fun iniciarKoin(
    contexto: Context,
    urlCompilacion: String? = null,
    info: InfoCompilacion = InfoCompilacion(version = "desconocida", commit = "desconocido"),
) {
    val contextoApp = contexto.applicationContext
    startKoin {
        modules(modulosApp(moduloAndroid(contextoApp, urlCompilacion, info)))
    }
}
