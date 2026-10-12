package es.fpmola.pizzeria.diagnostico

import es.fpmola.pizzeria.di.Dependencias

/**
 * Añade un apunte al registro de diagnóstico desde fuera del módulo compartido
 * (por ejemplo, desde la actividad de Android). Nunca lanza excepciones.
 */
fun anotarEnDiagnostico(categoria: String, texto: String) {
    try {
        Dependencias.registroDiagnostico().anotar(categoria, texto)
    } catch (e: Exception) {
        // El diagnóstico no puede romper la app.
    }
}
