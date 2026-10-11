/**
 * Doble de pruebas del SDK de Stripe.
 *
 * El gancho de ganchos-stripe.js hace que `import Stripe from 'stripe'` en el código
 * de src/ cargue este archivo. Así los tests nunca llaman a la API real de Stripe.
 *
 * - checkout.sessions.create / retrieve: se simulan y se registran en `control.llamadas`.
 * - webhooks: se usa el de la librería real (verificación de firma HMAC, cálculo local sin red).
 * - Cualquier otro recurso no existe en el doble: si el código lo usa, el test falla.
 */
import StripeReal from 'stripe';

let contadorSesiones = 0;

const crearPorDefecto = () => {
  contadorSesiones++;
  const id = `cs_test_doble_${contadorSesiones}`;
  return { id, url: `https://checkout.stripe.test/pay/${id}`, payment_status: 'unpaid' };
};

const recuperarPorDefecto = (id) => ({ id, payment_status: 'unpaid' });

// Estado compartido con los tests: qué se ha llamado y qué debe responder el doble
export const control = {
  llamadas: [],
  claves: [],
  crear: crearPorDefecto,
  recuperar: recuperarPorDefecto,
  reiniciar() {
    contadorSesiones = 0;
    this.llamadas.length = 0;
    this.crear = crearPorDefecto;
    this.recuperar = recuperarPorDefecto;
  },
};

export default class StripeDoble {
  static esDoble = true;
  static webhooks = StripeReal.webhooks;

  constructor(clave) {
    control.claves.push(clave);
    this.webhooks = StripeReal.webhooks;
    this.checkout = {
      sessions: {
        create: async (params) => {
          control.llamadas.push({ metodo: 'checkout.sessions.create', params });
          return control.crear(params);
        },
        retrieve: async (id) => {
          control.llamadas.push({ metodo: 'checkout.sessions.retrieve', id });
          return control.recuperar(id);
        },
      },
    };
  }
}

/** Genera una cabecera stripe-signature válida para `payload` con el secreto indicado. */
export function generarFirma(payload, secreto) {
  return StripeReal.webhooks.generateTestHeaderString({ payload, secret: secreto });
}
