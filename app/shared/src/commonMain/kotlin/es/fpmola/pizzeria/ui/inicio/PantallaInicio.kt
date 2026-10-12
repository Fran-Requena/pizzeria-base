package es.fpmola.pizzeria.ui.inicio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import es.fpmola.pizzeria.ui.componentes.BotonContorno
import es.fpmola.pizzeria.ui.componentes.BotonTexto

/**
 * Pantalla de inicio. Se abre directamente si ya hay un servidor guardado, y
 * desde aquí se abre la carta. La conexión con el servidor se comprueba en
 * segundo plano: no bloquea la pantalla y, si falla, se puede reintentar.
 */
@Composable
fun PantallaInicio(
    estado: EstadoInicio,
    alVerCarta: () -> Unit,
    alReintentar: () -> Unit,
    alCambiarServidor: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(text = "🍕", style = MaterialTheme.typography.displaySmall)
            Column {
                Text(
                    text = "Pizzería Bella Napoli",
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = "Pizzería artesanal",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        EstadoConexion(estado, alReintentar)
        Button(
            onClick = alVerCarta,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("🍕 Ver la carta")
        }
        BotonTexto(onClick = alCambiarServidor) {
            Text("Cambiar servidor")
        }
    }
}

/** Línea de estado de la conexión: comprobando, conectado o error con "Reintentar". */
@Composable
private fun EstadoConexion(estado: EstadoInicio, alReintentar: () -> Unit) {
    val servidor = estado.urlServidor.orEmpty()
    when (val conexion = estado.conexion) {
        ConexionServidor.Comprobando -> Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            Text(
                text = "Comprobando la conexión con $servidor…",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        ConexionServidor.Correcta -> Text(
            text = "Conectado a $servidor",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        is ConexionServidor.Fallida -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "No hay conexión con $servidor. ${conexion.mensaje}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
            BotonContorno(onClick = alReintentar) {
                Text("Reintentar")
            }
        }
    }
}
