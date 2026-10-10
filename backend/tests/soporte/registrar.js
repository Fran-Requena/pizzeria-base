/**
 * Se carga con `node --import` antes de cada archivo de test (ver "test" en package.json).
 *
 * - Fija el entorno de pruebas: clave de Stripe ficticia y URL de retorno conocida.
 * - Registra el gancho que sustituye 'stripe' por el doble de pruebas.
 */
import { register } from 'node:module';
import dotenv from 'dotenv';

// Mismo .env que cargará src/config/db.js, para que las variables coincidan
dotenv.config();

// Nunca se usa una clave real de Stripe en los tests (el doble no llama a la red)
process.env.STRIPE_SECRET_KEY = 'sk_test_doble_de_pruebas';
delete process.env.STRIPE_WEBHOOK_SECRET;
process.env.FRONTEND_URL = 'http://pizzeria.test';

register('./ganchos-stripe.js', import.meta.url);
