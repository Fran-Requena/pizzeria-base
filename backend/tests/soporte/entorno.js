/**
 * Utilidades comunes de los tests del backend.
 */
import { readFile } from 'node:fs/promises';

// Sin registrar.js no hay protección de la base de datos ni doble de Stripe: no seguir
if (!globalThis.__entornoTestsBackend) {
  throw new Error('Ejecuta los tests del backend con "npm test" (carga tests/soporte/registrar.js).');
}

const { default: pool } = await import('../../src/config/db.js');

export { pool };

const INIT_SQL = new URL('../../../database/init.sql', import.meta.url);

// Tablas que crea database/init.sql (orden indiferente gracias a CASCADE)
const TABLAS = ['lineas_pedido', 'pedidos', 'pizza_ingredientes', 'ingredientes', 'pizzas', 'categorias', 'mesas'];

/** Borra las tablas de la pizzería y las vuelve a crear con database/init.sql. */
export async function reiniciarEsquema() {
  console.warn(`⚠️  Reiniciando el esquema de ${process.env.TEST_DESTINO_BD}: se borran las tablas y se cargan de nuevo con database/init.sql.`);
  await pool.query(`DROP TABLE IF EXISTS ${TABLAS.join(', ')} CASCADE`);
  await pool.query(await readFile(INIT_SQL, 'utf8'));
}

/**
 * Importa la app (sin que abra el puerto 3000) y la arranca en un puerto libre de 127.0.0.1.
 * Antes comprueba que 'stripe' está sustituido por el doble de pruebas.
 */
export async function arrancarApp() {
  const { default: Stripe } = await import('stripe');
  if (!Stripe.esDoble) {
    throw new Error('El doble de Stripe no está activo: ejecuta los tests con "npm test".');
  }

  const { default: app } = await import('../../src/server.js');
  const servidor = await new Promise((resolver) => {
    const s = app.listen(0, '127.0.0.1', () => resolver(s));
  });
  const { port } = servidor.address();

  return {
    url: `http://127.0.0.1:${port}`,
    cerrar: () => new Promise((resolver) => servidor.close(resolver)),
  };
}

/**
 * Hace una petición HTTP y devuelve { estado, json, texto }.
 * Si `cuerpo` es un texto se envía tal cual (útil para firmar webhooks).
 */
export async function pedir(base, metodo, ruta, cuerpo, cabeceras = {}) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...cabeceras },
    body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // La respuesta no es JSON (por ejemplo, los errores del webhook son texto plano)
  }
  return { estado: res.status, json, texto };
}

/** Lee una fila de pedidos directamente de la base de datos. */
export async function leerPedido(id) {
  const res = await pool.query('SELECT * FROM pedidos WHERE id = $1', [id]);
  return res.rows[0];
}

/** Lee el estado de una mesa directamente de la base de datos. */
export async function leerEstadoMesa(numero) {
  const res = await pool.query('SELECT estado FROM mesas WHERE numero = $1', [numero]);
  return res.rows[0]?.estado;
}
