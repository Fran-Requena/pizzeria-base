package es.fpmola.pizzeria.ui.diagnostico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import es.fpmola.pizzeria.diagnostico.Diagnostico
import es.fpmola.pizzeria.diagnostico.EventoDiagnostico
import es.fpmola.pizzeria.ui.componentes.BotonContorno
import es.fpmola.pizzeria.ui.componentes.BotonTexto

/**
 * Pantalla de diagnóstico: versión del APK, servidor activo y su origen, pedido
 * guardado, resultado de la última comprobación al arrancar y los últimos sucesos.
 * No muestra datos personales. Sirve para entender qué hace la app sin
 * herramientas de desarrollo.
 */
@Composable
fun PantallaDiagnostico(
    diagnostico: Diagnostico,
    alActualizar: () -> Unit,
    alBorrarHistorial: () -> Unit,
    alVolver: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "Diagnóstico",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = "Información técnica para ayudar a localizar fallos. No incluye datos personales.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Dato("Versión de la app", "${diagnostico.version} (commit ${diagnostico.commit})")
        Dato("Servidor activo", diagnostico.urlActiva ?: "ninguno")
        Dato("Origen del servidor", diagnostico.origenUrl.etiqueta)
        if (diagnostico.urlGuardada != null && diagnostico.urlCompilacion != null &&
            diagnostico.urlGuardada != diagnostico.urlCompilacion
        ) {
            Dato("Servidor fijado al compilar", "${diagnostico.urlCompilacion} (no se usa: hay otro guardado)")
        }
        Dato(
            "Pedido guardado",
            diagnostico.pedidoGuardado?.let { "n.º $it" } ?: "ninguno",
        )
        Dato(
            "Última comprobación al arrancar",
            diagnostico.ultimoArranque?.let { "${it.momento}: ${it.texto}" }
                ?: "todavía no se ha hecho ninguna",
        )

        HorizontalDivider()
        Text(
            text = "Últimos sucesos (el más reciente, primero)",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onBackground,
        )
        if (diagnostico.eventos.isEmpty()) {
            Text(
                text = "Sin sucesos registrados.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        for (evento in diagnostico.eventos) {
            Suceso(evento)
        }

        HorizontalDivider()
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            BotonContorno(onClick = alActualizar) { Text("Actualizar") }
            BotonContorno(onClick = alBorrarHistorial) { Text("Borrar sucesos") }
        }
        BotonTexto(onClick = alVolver, modifier = Modifier.fillMaxWidth()) {
            Text("Volver")
        }
    }
}

@Composable
private fun Dato(titulo: String, valor: String) {
    Column {
        Text(
            text = titulo,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = valor,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun Suceso(evento: EventoDiagnostico) {
    Text(
        text = "${evento.momento} · ${evento.categoria} · ${evento.texto}",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurface,
    )
}
