/**
 * Se carga con `node --import` antes de cada archivo de test (ver "test" en package.json).
 *
 * - Protege la base de datos: los tests BORRAN y recrean las tablas, así que se niegan
 *   a ejecutarse contra un servidor que no sea local salvo con TEST_ALLOW_REMOTE=1.
 * - Fija el entorno de pruebas: clave de Stripe ficticia y URL de retorno conocida.
 * - Registra el gancho que sustituye 'stripe' por el doble de pruebas.
 */
import { register } from 'node:module';
import dotenv from 'dotenv';

// Mismo .env que cargará src/config/db.js, para que las variables coincidan
dotenv.config();

// ─── Protección de la base de datos ─────────────────────────────────────────
// Mismo valor por defecto que db.js. 'db' (el servicio de Docker Compose) NO cuenta
// como local: en la EC2 es la base de datos de producción.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', '::1'];
const host = process.env.DB_HOST || 'localhost';
const baseDatos = process.env.DB_NAME || 'pizzeria_db';
const esLocal = HOSTS_LOCALES.includes(host);
const remotoPermitido = process.env.TEST_ALLOW_REMOTE === '1';

// El ejecutor de tests lanza un proceso por archivo y este código se ejecuta en cada uno
if (!esLocal && !remotoPermitido) {
  console.error(
    `\n❌ Tests cancelados: la base de datos "${baseDatos}" está en "${host}", que no es local.\n` +
      '   Los tests BORRAN y vuelven a crear todas las tablas (database/init.sql).\n' +
      '   Si de verdad quieres ejecutarlos contra ese servidor, usa TEST_ALLOW_REMOTE=1.\n'
  );
  process.exit(1);
}

// Datos para el aviso que muestra reiniciarEsquema() (tests/soporte/entorno.js)
process.env.TEST_DESTINO_BD = `"${baseDatos}" en "${host}"${esLocal ? '' : ' (REMOTO, permitido con TEST_ALLOW_REMOTE=1)'}`;

// Marca que comprueban los tests: sin ella no se han aplicado ni la protección ni el doble
globalThis.__entornoTestsBackend = true;

// Nunca se usa una clave real de Stripe en los tests (el doble no llama a la red)
process.env.STRIPE_SECRET_KEY = 'sk_test_doble_de_pruebas';
delete process.env.STRIPE_WEBHOOK_SECRET;
process.env.FRONTEND_URL = 'http://pizzeria.test';

register('./ganchos-stripe.js', import.meta.url);
