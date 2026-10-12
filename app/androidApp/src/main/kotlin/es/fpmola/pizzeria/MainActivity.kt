package es.fpmola.pizzeria

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import es.fpmola.pizzeria.diagnostico.CategoriaDiagnostico
import es.fpmola.pizzeria.diagnostico.anotarEnDiagnostico

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        anotarEnDiagnostico(
            CategoriaDiagnostico.ACTIVIDAD,
            "Actividad creada (con estado guardado: ${if (savedInstanceState != null) "sí" else "no"}).",
        )

        setContent {
            // El botón atrás del sistema se intercepta aquí, en Android, con
            // BackHandler de androidx.activity (estable); la navegación común
            // solo recibe "habilitado" y "qué hacer".
            App(
                manejadorAtras = { habilitado, alAtras ->
                    BackHandler(enabled = habilitado, onBack = alAtras)
                },
            )
        }
    }

    override fun onStart() {
        super.onStart()
        anotarEnDiagnostico(CategoriaDiagnostico.ACTIVIDAD, "Actividad visible.")
    }

    override fun onStop() {
        super.onStop()
        anotarEnDiagnostico(CategoriaDiagnostico.ACTIVIDAD, "Actividad en segundo plano.")
    }

    override fun onDestroy() {
        super.onDestroy()
        val motivo = if (isChangingConfigurations) "cambio de configuración" else "cierre o recreación"
        anotarEnDiagnostico(CategoriaDiagnostico.ACTIVIDAD, "Actividad destruida ($motivo).")
    }
}
