package es.fpmola.pizzeria

import android.app.Application
import es.fpmola.pizzeria.di.iniciarKoin

/**
 * Punto de entrada del proceso: prepara la inyección de dependencias.
 */
class PizzeriaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // BuildConfig.URL_SERVIDOR lleva la URL fijada al compilar (vacía en el APK genérico).
        iniciarKoin(this, BuildConfig.URL_SERVIDOR)
    }
}
