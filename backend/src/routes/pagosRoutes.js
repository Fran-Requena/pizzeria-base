import { Router } from 'express';
import { 
  crearSesionCheckout, 
  handleWebhook, 
  getConfigStatus,
  confirmarSesion
} from '../controllers/pagosController.js';

const router = Router();

// Rutas para la pasarela de pagos (/api/pagos)
router.get('/config', getConfigStatus);
router.post('/crear-sesion', crearSesionCheckout);
router.post('/confirmar-sesion', confirmarSesion);
router.post('/webhook', handleWebhook);

export default router;
