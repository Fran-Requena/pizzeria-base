/**
 * Gancho de resolución de módulos (module.register): sustituye el paquete 'stripe'
 * por el doble de pruebas en todo el código, salvo dentro del propio doble, que
 * necesita la librería real para verificar firmas de webhook.
 */
const DOBLE = new URL('./stripe-doble.js', import.meta.url).href;

export async function resolve(especificador, contexto, siguiente) {
  if (especificador === 'stripe' && contexto.parentURL !== DOBLE) {
    return { url: DOBLE, shortCircuit: true };
  }
  return siguiente(especificador, contexto);
}
