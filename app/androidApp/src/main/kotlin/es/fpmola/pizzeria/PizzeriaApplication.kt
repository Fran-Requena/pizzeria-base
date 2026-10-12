package es.fpmola.pizzeria

import android.app.Application
import es.fpmola.pizzeria.di.iniciarKoin
import es.fpmola.pizzeria.diagnostico.CategoriaDiagnostico
import es.fpmola.pizzeria.diagnostico.InfoCompilacion
import es.fpmola.pizzeria.diagnostico.anotarEnDiagnostico

/**
 * Punto de entrada del proceso: prepara la inyección de dependencias.
 */
class PizzeriaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // BuildConfig.URL_SERVIDOR lleva la URL fijada al compilar (vacía en el APK genérico).
        iniciarKoin(
            contexto = this,
            urlCompilacion = BuildConfig.URL_SERVIDOR,
            info = InfoCompilacion(version = BuildConfig.VERSION_NAME, commit = BuildConfig.COMMIT),
        )
        anotarEnDiagnostico(CategoriaDiagnostico.PROCESO, "Proceso iniciado.")
    }
}
