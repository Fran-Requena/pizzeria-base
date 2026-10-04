import { query } from '../config/db.js';

/**
 * Obtener el listado de todas las mesas con sus pedidos activos si los tuvieran
 */
export const getAllMesas = async (req, res) => {
  try {
    const sql = `
      SELECT 
        m.id,
        m.numero,
        m.capacidad,
        m.estado,
        COUNT(p.id) FILTER (WHERE p.estado IN ('pendiente', 'en_preparacion', 'listo')) AS pedidos_activos_count
      FROM mesas m
      LEFT JOIN pedidos p ON m.numero = p.mesa_numero
      GROUP BY m.id
      ORDER BY m.numero ASC
    `;

    const result = await query(sql);
    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error al consultar mesas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al consultar las mesas de la pizzería',
      error: error.message,
    });
  }
};

/**
 * Obtener información de una mesa específica por su número (para la app QR)
 */
export const getMesaByNumero = async (req, res) => {
  try {
    const { numero } = req.params;

    const sql = `
      SELECT id, numero, capacidad, estado
      FROM mesas
      WHERE numero = $1
    `;

    const result = await query(sql, [parseInt(numero, 10)]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: `Mesa número ${numero} no existe en la sala`,
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error(`Error al consultar mesa #${req.params.numero}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al consultar la mesa',
      error: error.message,
    });
  }
};

/**
 * Actualizar el estado de una mesa ('libre', 'ocupada', 'reservada')
 */
export const updateEstadoMesa = async (req, res) => {
  try {
    const { numero } = req.params;
    const { estado } = req.body;

    const estadosValidos = ['libre', 'ocupada', 'cuenta_pedida', 'reservada'];
    if (!estado || !estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: `Estado no válido. Opciones permitidas: ${estadosValidos.join(', ')}`,
      });
    }

    const sql = `
      UPDATE mesas
      SET estado = $1
      WHERE numero = $2
      RETURNING *
    `;

    const result = await query(sql, [estado, parseInt(numero, 10)]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: `Mesa número ${numero} no encontrada`,
      });
    }

    res.json({
      success: true,
      message: `Mesa #${numero} actualizada a '${estado}'`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error(`Error al actualizar estado de la mesa #${req.params.numero}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error interno al actualizar estado de la mesa',
      error: error.message,
    });
  }
};

/**
 * Crear una nueva mesa física en la sala (Solo Admin)
 */
export const createMesa = async (req, res) => {
  try {
    const { numero, capacidad, estado } = req.body;

    const num = parseInt(numero, 10);
    if (!num || num <= 0) {
      return res.status(400).json({ success: false, message: 'El número de mesa debe ser un entero positivo' });
    }

    // Comprobar si ya existe
    const existe = await query('SELECT id FROM mesas WHERE numero = $1', [num]);
    if (existe.rowCount > 0) {
      return res.status(400).json({ success: false, message: `La Mesa #${num} ya existe en el restaurante` });
    }

    const cap = parseInt(capacidad, 10) || 4;
    const est = estado || 'libre';

    const sql = `
      INSERT INTO mesas (numero, capacidad, estado)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const result = await query(sql, [num, cap, est]);

    res.status(201).json({
      success: true,
      message: `Mesa #${num} creada correctamente`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error al crear mesa:', error);
    res.status(500).json({ success: false, message: 'Error interno al crear mesa', error: error.message });
  }
};

/**
 * Modificar datos de una mesa (número, capacidad, estado) (Solo Admin)
 */
export const updateMesa = async (req, res) => {
  try {
    const { numero: paramNumero } = req.params;
    const { numero, capacidad, estado } = req.body;

    const numOriginal = parseInt(paramNumero, 10);
    const nuevoNumero = numero !== undefined ? parseInt(numero, 10) : numOriginal;
    const nuevaCapacidad = capacidad !== undefined ? parseInt(capacidad, 10) : undefined;

    // Verificar si la mesa existe
    const mesaPrev = await query('SELECT * FROM mesas WHERE numero = $1', [numOriginal]);
    if (mesaPrev.rowCount === 0) {
      return res.status(404).json({ success: false, message: `Mesa #${numOriginal} no encontrada` });
    }

    // Si cambia de número, comprobar que no esté duplicado
    if (nuevoNumero !== numOriginal) {
      const existeNuevo = await query('SELECT id FROM mesas WHERE numero = $1', [nuevoNumero]);
      if (existeNuevo.rowCount > 0) {
        return res.status(400).json({ success: false, message: `Ya existe otra mesa con el número ${nuevoNumero}` });
      }
    }

    const capFinal = nuevaCapacidad !== undefined ? nuevaCapacidad : mesaPrev.rows[0].capacidad;
    const estFinal = estado || mesaPrev.rows[0].estado;

    const sql = `
      UPDATE mesas
      SET numero = $1, capacidad = $2, estado = $3
      WHERE numero = $4
      RETURNING *
    `;

    const result = await query(sql, [nuevoNumero, capFinal, estFinal, numOriginal]);

    // Si cambió el número de mesa, actualizar pedidos en curso con el número anterior para coherencia
    if (nuevoNumero !== numOriginal) {
      await query(`UPDATE pedidos SET mesa_numero = $1 WHERE mesa_numero = $2 AND estado IN ('pendiente', 'en_preparacion', 'listo')`, [nuevoNumero, numOriginal]);
    }

    res.json({
      success: true,
      message: `Mesa #${nuevoNumero} modificada con éxito`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error(`Error al modificar mesa #${req.params.numero}:`, error);
    res.status(500).json({ success: false, message: 'Error interno al modificar mesa', error: error.message });
  }
};

/**
 * Eliminar una mesa (Solo Admin)
 */
export const deleteMesa = async (req, res) => {
  try {
    const { numero } = req.params;
    const num = parseInt(numero, 10);

    // Verificar si la mesa existe
    const mesaRes = await query('SELECT * FROM mesas WHERE numero = $1', [num]);
    if (mesaRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: `Mesa #${num} no encontrada` });
    }

    // Comprobar si tiene pedidos activos en cocina o sala
    const pedidosActivos = await query(
      `SELECT id FROM pedidos WHERE mesa_numero = $1 AND estado IN ('pendiente', 'en_preparacion', 'listo')`,
      [num]
    );

    if (pedidosActivos.rowCount > 0) {
      return res.status(400).json({
        success: false,
        message: `No se puede eliminar la Mesa #${num} porque tiene comandas activas pendientes o en preparación.`
      });
    }

    await query('DELETE FROM mesas WHERE numero = $1', [num]);

    res.json({
      success: true,
      message: `Mesa #${num} eliminada del plano de sala`,
    });
  } catch (error) {
    console.error(`Error al eliminar mesa #${req.params.numero}:`, error);
    res.status(500).json({ success: false, message: 'Error interno al eliminar mesa', error: error.message });
  }
};

