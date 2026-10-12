package es.fpmola.pizzeria.pedidos

import android.content.Context

/**
 * Implementación de [PedidoEnCurso] con SharedPreferences, el mismo mecanismo
 * que ya usa [es.fpmola.pizzeria.ajustes.AjustesServidorAndroid]: un solo valor
 * entero, así que no hace falta añadir DataStore ni ninguna otra dependencia.
 * Va en un archivo propio para poder borrarlo sin tocar los ajustes del servidor.
 */
class PedidoEnCursoAndroid(contexto: Context) : PedidoEnCurso {

    private val preferencias = contexto.applicationContext
        .getSharedPreferences(NOMBRE_PREFERENCIAS, Context.MODE_PRIVATE)

    override fun obtenerId(): Int? =
        if (preferencias.contains(CLAVE_ID)) preferencias.getInt(CLAVE_ID, 0) else null

    override fun guardarId(id: Int) {
        preferencias.edit().putInt(CLAVE_ID, id).apply()
    }

    override fun olvidar() {
        preferencias.edit().remove(CLAVE_ID).apply()
    }

    private companion object {
        const val NOMBRE_PREFERENCIAS = "pedido_en_curso"
        const val CLAVE_ID = "pedido_id"
    }
}
