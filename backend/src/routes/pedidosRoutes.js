import { Router } from 'express';
import { 
  getAllPedidos, 
  getPedidoById, 
  createPedido, 
  updateEstadoPedido,
  registrarCobroPedido,
  updatePedidoCompleto
} from '../controllers/pedidosController.js';

const router = Router();

// Dispatcher inteligente para actualización de comanda o de sólo estado
const handleUpdatePedido = (req, res) => {
  if (
    req.body.lineas || 
    req.body.tipo_pedido || 
    req.body.cliente_nombre || 
    req.body.mesa_numero !== undefined || 
    req.body.descuento !== undefined || 
    (req.body.total !== undefined && !req.body.estado)
  ) {
    return updatePedidoCompleto(req, res);
  }
  return updateEstadoPedido(req, res);
};

// Rutas para el recurso /api/pedidos
router.get('/', getAllPedidos);
router.get('/:id', getPedidoById);
router.post('/', createPedido);
router.put('/:id/estado', updateEstadoPedido);
router.patch('/:id/estado', updateEstadoPedido);
router.put('/:id/cobro', registrarCobroPedido);
router.post('/:id/cobro', registrarCobroPedido);
router.put('/:id/comanda', updatePedidoCompleto);
router.patch('/:id/comanda', updatePedidoCompleto);
router.put('/:id', handleUpdatePedido);
router.patch('/:id', handleUpdatePedido);

export default router;


