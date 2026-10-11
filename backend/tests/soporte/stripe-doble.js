/**
 * Doble de pruebas del SDK de Stripe.
 *
 * El gancho de ganchos-stripe.js hace que `import Stripe from 'stripe'` en el código
 * de src/ cargue este archivo. Así los tests nunca llaman a la API real de Stripe.
 *
 * - checkout.sessions.create / retrieve / expire: se simulan con un almacén de sesiones
 *   en memoria (`control.sesiones`) y se registran en `control.llamadas`.
 * - Los tests cambian el estado de una sesión con control.pagar, control.caducar o
 *   control.fijarSesion, o sustituyen control.crear / recuperar / expirar para simular fallos.
 * - webhooks: se usa el de la librería real (verificación de firma HMAC, cálculo local sin red).
 * - Cualquier otro recurso no existe en el doble: si el código lo usa, el test falla.
 */
import StripeReal from 'stripe';

let contadorSesiones = 0;

// Sesiones creadas por el doble, por id
const sesiones = new Map();

/** Error con la misma forma que los de la librería real (code, statusCode, type). */
export function errorStripe(mensaje, { code, statusCode = 400 } = {}) {
  return new StripeReal.errors.StripeInvalidRequestError({ message: mensaje, code, statusCode });
}

/** El error que devuelve Stripe al consultar o expirar una sesión que no existe. */
export const errorNoExiste = (id) =>
  errorStripe(`No such checkout.session: '${id}'`, { code: 'resource_missing', statusCode: 404 });

const crearPorDefecto = (params) => {
  contadorSesiones++;
  const id = `cs_test_doble_${contadorSesiones}`;
  const importe = (params.line_items || []).reduce(
    (suma, l) => suma + l.price_data.unit_amount * l.quantity,
    0
  );
  const sesion = {
    id,
    url: `https://checkout.stripe.test/pay/${id}`,
    status: 'open',
    payment_status: 'unpaid',
    amount_total: importe,
    client_reference_id: params.client_reference_id ?? null,
    metadata: { ...(params.metadata || {}) },
  };
  sesiones.set(id, sesion);
  return { ...sesion };
};

const recuperarPorDefecto = (id) => {
  const sesion = sesiones.get(id);
  if (!sesion) throw errorNoExiste(id);
  return { ...sesion };
};

const expirarPorDefecto = (id) => {
  const sesion = sesiones.get(id);
  if (!sesion) throw errorNoExiste(id);
  if (sesion.status !== 'open') {
    throw errorStripe(`Only Checkout Sessions with a status of 'open' can be expired. This session has a status of '${sesion.status}'.`);
  }
  sesion.status = 'expired';
  return { ...sesion };
};

// Estado compartido con los tests: qué se ha llamado y qué debe responder el doble
export const control = {
  llamadas: [],
  claves: [],
  sesiones,
  crear: crearPorDefecto,
  recuperar: recuperarPorDefecto,
  expirar: expirarPorDefecto,
  reiniciar() {
    contadorSesiones = 0;
    sesiones.clear();
    this.llamadas.length = 0;
    this.crear = crearPorDefecto;
    this.recuperar = recuperarPorDefecto;
    this.expirar = expirarPorDefecto;
  },
  /** Añade o modifica una sesión del almacén (la crea si no existe). */
  fijarSesion(id, campos = {}) {
    const actual = sesiones.get(id) || {
      id,
      url: `https://checkout.stripe.test/pay/${id}`,
      status: 'open',
      payment_status: 'unpaid',
      client_reference_id: null,
      metadata: {},
    };
    sesiones.set(id, { ...actual, ...campos });
    return sesiones.get(id);
  },
  /** El cliente paga la sesión: status 'complete' y payment_status 'paid'. */
  pagar(id) {
    return this.fijarSesion(id, { status: 'complete', payment_status: 'paid' });
  },
  /** La sesión caduca sin pago: status 'expired'. */
  caducar(id) {
    return this.fijarSesion(id, { status: 'expired' });
  },
  /** Llamadas registradas a un método (por ejemplo 'checkout.sessions.expire'). */
  llamadasA(metodo) {
    return this.llamadas.filter((l) => l.metodo === metodo);
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
        expire: async (id) => {
          control.llamadas.push({ metodo: 'checkout.sessions.expire', id });
          return control.expirar(id);
        },
      },
    };
  }
}

/** Genera una cabecera stripe-signature válida para `payload` con el secreto indicado. */
export function generarFirma(payload, secreto) {
  return StripeReal.webhooks.generateTestHeaderString({ payload, secret: secreto });
}
