import { Router } from 'express';
import { 
  getAllMesas, 
  getMesaByNumero, 
  updateEstadoMesa,
  createMesa,
  updateMesa,
  deleteMesa
} from '../controllers/mesasController.js';

const router = Router();

// Rutas para el recurso /api/mesas
router.get('/', getAllMesas);
router.post('/', createMesa);
router.get('/:numero', getMesaByNumero);
router.put('/:numero', updateMesa);
router.patch('/:numero', updateMesa);
router.delete('/:numero', deleteMesa);
router.patch('/:numero/estado', updateEstadoMesa);

export default router;

