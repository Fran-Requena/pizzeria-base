import pool, { query } from '../config/db.js';

/**
 * Obtener todos los pedidos con sus líneas y detalles para el panel de mostrador y cocina
 */
export const getAllPedidos = async (req, res) => {
  try {
    const { estado, mesa, tipo } = req.query;

    let sql = `
      SELECT 
        p.id,
        p.tipo_pedido,
        p.mesa_numero,
        p.fecha,
        p.estado,
        p.total,
        p.cliente_nombre,
        p.cliente_telefono,
        p.cliente_direccion,
        p.metodo_pago,
        p.estado_pago,
        p.stripe_session_id,
        p.observaciones,
        COALESCE(
          json_agg(
            json_build_object(
              'linea_id', lp.id,
              'pizza_id', pz.id,
              'nombre', pz.nombre,
              'imagen_url', pz.imagen_url,
              'cantidad', lp.cantidad,
              'precio_unitario', lp.precio_unitario,
              'subtotal', (lp.cantidad * lp.precio_unitario),
              'notas', lp.notas
            )
          ) FILTER (WHERE lp.id IS NOT NULL), '[]'
        ) AS lineas
      FROM pedidos p
      LEFT JOIN lineas_pedido lp ON p.id = lp.pedido_id
      LEFT JOIN pizzas pz ON lp.pizza_id = pz.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (estado) {
      sql += ` AND p.estado = $${paramIndex}`;
      params.push(estado);
      paramIndex++;
    }

    if (mesa) {
      sql += ` AND p.mesa_numero = $${paramIndex}`;
      params.push(parseInt(mesa, 10));
      paramIndex++;
    }

    if (tipo) {
      sql += ` AND p.tipo_pedido = $${paramIndex}`;
      params.push(tipo);
      paramIndex++;
    }

    sql += `
      GROUP BY p.id
      ORDER BY 
        CASE 
          WHEN p.estado = 'pendiente' THEN 1
          WHEN p.estado = 'en_preparacion' THEN 2
          WHEN p.estado = 'en_reparto' THEN 3
          WHEN p.estado = 'listo' THEN 4
          ELSE 5
        END,
        p.fecha ASC
    `;

    const result = await query(sql, params);
    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error al obtener pedidos:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno al consultar pedidos',
      error: error.message,
    });
  }
};

/**
 * Obtener un pedido por ID con su detalle
 */
export const getPedidoById = async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `
      SELECT 
        p.id,
        p.tipo_pedido,
        p.mesa_numero,
        p.fecha,
        p.estado,
        p.total,
        p.cliente_nombre,
        p.cliente_telefono,
        p.cliente_direccion,
        p.metodo_pago,
        p.estado_pago,
        p.stripe_session_id,
        p.observaciones,
        COALESCE(
          json_agg(
            json_build_object(
              'linea_id', lp.id,
              'pizza_id', pz.id,
              'nombre', pz.nombre,
              'imagen_url', pz.imagen_url,
              'cantidad', lp.cantidad,
              'precio_unitario', lp.precio_unitario,
              'subtotal', (lp.cantidad * lp.precio_unitario),
              'notas', lp.notas
            )
          ) FILTER (WHERE lp.id IS NOT NULL), '[]'
        ) AS lineas
      FROM pedidos p
      LEFT JOIN lineas_pedido lp ON p.id = lp.pedido_id
      LEFT JOIN pizzas pz ON lp.pizza_id = pz.id
      WHERE p.id = $1
      GROUP BY p.id
    `;

    const result = await query(sql, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: `Pedido #${id} no encontrado`,
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error(`Error al obtener pedido #${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al consultar el pedido',
      error: error.message,
    });
  }
};

/**
 * Crear un nuevo pedido con transacción atómica (Mesa / QR, Domicilio o Para Recoger)
 */
export const createPedido = async (req, res) => {
  const client = await pool.connect();

  try {
    const tipo_pedido = req.body.tipo_pedido || req.body.tipo_entrega || (req.body.mesa_numero ? 'mesa' : 'domicilio');
    const mesa_numero = req.body.mesa_numero;
    const cliente_nombre = req.body.cliente_nombre;
    const cliente_telefono = req.body.cliente_telefono || req.body.telefono;
    const cliente_direccion = req.body.cliente_direccion || req.body.direccion_entrega;
    const metodo_pago = req.body.metodo_pago || 'efectivo_entrega';
    const observaciones = req.body.observaciones;
    const lineas = req.body.lineas;

    if (!lineas || !Array.isArray(lineas) || lineas.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debes incluir al menos una pizza en el pedido',
      });
    }

    // Validaciones de negocio según el tipo de pedido
    let parsedMesa = null;
    if (tipo_pedido === 'mesa') {
      if (!mesa_numero) {
        return res.status(400).json({
          success: false,
          message: 'Debes indicar el número de mesa para pedidos en el local',
        });
      }
      parsedMesa = parseInt(mesa_numero, 10);
    } else if (tipo_pedido === 'recoger') {
      if (!cliente_nombre || !cliente_nombre.trim()) {
        return res.status(400).json({
          success: false,
          message: 'El nombre del cliente es obligatorio para pedidos a recoger',
        });
      }
      if (!cliente_telefono || !cliente_telefono.trim()) {
        return res.status(400).json({
          success: false,
          message: 'El teléfono de contacto es obligatorio para pedidos a recoger',
        });
      }
    } else if (tipo_pedido === 'domicilio') {
      if (!cliente_nombre || !cliente_nombre.trim()) {
        return res.status(400).json({
          success: false,
          message: 'El nombre del cliente es obligatorio para pedidos a domicilio',
        });
      }
      if (!cliente_telefono || !cliente_telefono.trim()) {
        return res.status(400).json({
          success: false,
          message: 'El teléfono de contacto es obligatorio para pedidos a domicilio',
        });
      }
      if (!cliente_direccion || !cliente_direccion.trim()) {
        return res.status(400).json({
          success: false,
          message: 'La dirección de entrega es obligatoria para pedidos a domicilio',
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Tipo de pedido no válido (opciones: mesa, recoger, domicilio)',
      });
    }

    // Iniciar transacción
    await client.query('BEGIN');

    // 1. Calcular total y validar pizzas desde la BD
    let totalCalculado = 0;
    const lineasProcesadas = [];

    for (const item of lineas) {
      const pizzaRes = await client.query('SELECT id, nombre, precio, disponible FROM pizzas WHERE id = $1', [item.pizza_id]);
      
      if (pizzaRes.rowCount === 0) {
        throw new Error(`La pizza con ID ${item.pizza_id} no existe.`);
      }

      const pizza = pizzaRes.rows[0];
      if (!pizza.disponible) {
        throw new Error(`La pizza "${pizza.nombre}" no está disponible temporalmente.`);
      }

      const cantidad = parseInt(item.cantidad, 10) || 1;
      const precioUnitario = parseFloat(pizza.precio);
      totalCalculado += precioUnitario * cantidad;

      lineasProcesadas.push({
        pizza_id: pizza.id,
        nombre: pizza.nombre,
        cantidad,
        precio_unitario: precioUnitario,
        notas: item.notas || null,
      });
    }

    // 2. Insertar cabecera del pedido
    const insertPedidoSql = `
      INSERT INTO pedidos (tipo_pedido, mesa_numero, estado, total, cliente_nombre, cliente_telefono, cliente_direccion, metodo_pago, observaciones)
      VALUES ($1, $2, 'pendiente', $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const defaultNombre = tipo_pedido === 'mesa' ? `Cliente Mesa ${parsedMesa}` : 'Cliente Web';
    const pedidoRes = await client.query(insertPedidoSql, [
      tipo_pedido,
      parsedMesa,
      totalCalculado,
      cliente_nombre || defaultNombre,
      cliente_telefono || null,
      cliente_direccion || null,
      metodo_pago,
      observaciones || null,
    ]);

    const nuevoPedido = pedidoRes.rows[0];

    // 3. Insertar líneas del pedido
    for (const lp of lineasProcesadas) {
      await client.query(
        `INSERT INTO lineas_pedido (pedido_id, pizza_id, cantidad, precio_unitario, notas)
         VALUES ($1, $2, $3, $4, $5)`,
        [nuevoPedido.id, lp.pizza_id, lp.cantidad, lp.precio_unitario, lp.notas]
      );
    }

    // 4. Si es en mesa, actualizar el estado de la mesa a 'ocupada'
    if (parsedMesa) {
      await client.query(
        `UPDATE mesas SET estado = 'ocupada' WHERE numero = $1`,
        [parsedMesa]
      );
    }

    // Confirmar transacción
    await client.query('COMMIT');

    console.log(`🍕 [Nuevo Pedido #${nuevoPedido.id}] Tipo: ${tipo_pedido.toUpperCase()} - Total: ${totalCalculado}€`);

    res.status(201).json({
      success: true,
      message: '¡Pedido enviado a cocina con éxito!',
      data: {
        ...nuevoPedido,
        lineas: lineasProcesadas,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al tramitar pedido:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error al tramitar el pedido',
    });
  } finally {
    client.release();
  }
};

/**
 * Actualizar el estado de un pedido (ej: 'pendiente', 'en_preparacion', 'en_reparto', 'listo', 'servido', 'entregado', 'cancelado')
 */
export const updateEstadoPedido = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const estadosValidos = ['pendiente', 'en_preparacion', 'en_reparto', 'listo', 'servido', 'entregado', 'cancelado'];

    if (!estado || !estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: `Estado no válido. Opciones permitidas: ${estadosValidos.join(', ')}`,
      });
    }

    const sql = `
      UPDATE pedidos 
      SET estado = $1 
      WHERE id = $2 
      RETURNING *
    `;

    const result = await query(sql, [estado, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: `Pedido #${id} no encontrado`,
      });
    }

    const pedidoActualizado = result.rows[0];

    // Si el pedido es en mesa y se marca como 'servido' o 'cancelado', verificar si la mesa queda libre
    if (pedidoActualizado.mesa_numero && (estado === 'servido' || estado === 'entregado' || estado === 'cancelado')) {
      const pedidosActivosMesa = await query(
        `SELECT id FROM pedidos WHERE mesa_numero = $1 AND estado IN ('pendiente', 'en_preparacion', 'listo')`,
        [pedidoActualizado.mesa_numero]
      );
      if (pedidosActivosMesa.rowCount === 0) {
        await query(`UPDATE mesas SET estado = 'libre' WHERE numero = $1`, [pedidoActualizado.mesa_numero]);
      }
    }

    res.json({
      success: true,
      message: `Pedido #${id} actualizado al estado '${estado}'`,
      data: pedidoActualizado,
    });
  } catch (error) {
    console.error(`Error al actualizar estado del pedido #${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error interno al actualizar estado del pedido',
      error: error.message,
    });
  }
};

/**
 * Registrar cobro presencial de un pedido en caja o reparto (Efectivo, Datáfono o Stripe)
 */
export const registrarCobroPedido = async (req, res) => {
  try {
    const { id } = req.params;
    const { metodo_pago, importe_entregado, cambio } = req.body;

    const sql = `
      UPDATE pedidos 
      SET estado_pago = 'pagado',
          metodo_pago = COALESCE($1, metodo_pago)
      WHERE id = $2 
      RETURNING *
    `;

    const result = await query(sql, [metodo_pago || null, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: `Pedido #${id} no encontrado` });
    }

    const pedido = result.rows[0];

    // Obtener líneas para poder emitir el ticket completo
    const lineasRes = await query(`
      SELECT lp.id, lp.cantidad, lp.precio_unitario, lp.notas, pz.nombre
      FROM lineas_pedido lp
      JOIN pizzas pz ON lp.pizza_id = pz.id
      WHERE lp.pedido_id = $1
    `, [id]);

    res.json({
      success: true,
      message: `Cobro del pedido #${id} registrado con éxito`,
      data: {
        ...pedido,
        lineas: lineasRes.rows,
      },
      detalles_cobro: {
        metodo_pago: pedido.metodo_pago,
        total: pedido.total,
        importe_entregado: importe_entregado || pedido.total,
        cambio: cambio || 0,
        fecha_cobro: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error(`Error al registrar cobro del pedido #${req.params.id}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Modificar comanda de pedido completo (líneas, comensales, mesa, tipo de entrega, observaciones, ajuste de precio)
 */
export const updatePedidoCompleto = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      tipo_pedido,
      mesa_numero,
      cliente_nombre,
      cliente_telefono,
      cliente_direccion,
      observaciones,
      estado,
      lineas,
      descuento,
      total
    } = req.body;

    // Verificar si el pedido existe
    const pedPrevRes = await client.query('SELECT * FROM pedidos WHERE id = $1', [id]);
    if (pedPrevRes.rowCount === 0) {
      client.release();
      return res.status(404).json({ success: false, message: `Pedido #${id} no encontrado` });
    }
    const pedidoPrevio = pedPrevRes.rows[0];

    await client.query('BEGIN');

    // 1. Procesar líneas si se enviaron
    let totalCalculado = 0;
    const lineasProcesadas = [];

    if (Array.isArray(lineas) && lineas.length > 0) {
      // Eliminar líneas previas
      await client.query('DELETE FROM lineas_pedido WHERE pedido_id = $1', [id]);

      for (const item of lineas) {
        const pzRes = await client.query('SELECT id, nombre, precio FROM pizzas WHERE id = $1', [item.pizza_id]);
        if (pzRes.rowCount === 0) {
          throw new Error(`La pizza con ID ${item.pizza_id} no existe.`);
        }
        const pz = pzRes.rows[0];
        const cantidad = Math.max(1, parseInt(item.cantidad, 10) || 1);
        const precioUnitario = item.precio_unitario !== undefined ? parseFloat(item.precio_unitario) : parseFloat(pz.precio);
        const notas = item.notas || null;

        totalCalculado += cantidad * precioUnitario;

        const insertLineaRes = await client.query(
          `INSERT INTO lineas_pedido (pedido_id, pizza_id, cantidad, precio_unitario, notas)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, pedido_id, pizza_id, cantidad, precio_unitario, notas`,
          [id, pz.id, cantidad, precioUnitario, notas]
        );

        lineasProcesadas.push({
          ...insertLineaRes.rows[0],
          nombre: pz.nombre,
          subtotal: cantidad * precioUnitario
        });
      }
    } else {
      // Si no se pasaron líneas, mantener el total previo
      totalCalculado = parseFloat(pedidoPrevio.total);
    }

    // Calcular total final con descuento o ajuste si aplica
    let totalFinal = totalCalculado;
    if (total !== undefined && !isNaN(parseFloat(total))) {
      totalFinal = Math.max(0, parseFloat(total));
    } else if (descuento !== undefined && !isNaN(parseFloat(descuento))) {
      totalFinal = Math.max(0, totalCalculado - parseFloat(descuento));
    }

    // 2. Resolver campos de cabecera
    const nuevoTipo = tipo_pedido || pedidoPrevio.tipo_pedido;
    let nuevaMesa = pedidoPrevio.mesa_numero;
    if (nuevoTipo === 'mesa') {
      nuevaMesa = mesa_numero !== undefined ? (mesa_numero ? parseInt(mesa_numero, 10) : null) : pedidoPrevio.mesa_numero;
    } else {
      nuevaMesa = null; // Si es recoger o domicilio, no tiene mesa asignada
    }

    const nuevoNombre = cliente_nombre !== undefined ? cliente_nombre : pedidoPrevio.cliente_nombre;
    const nuevoTelefono = cliente_telefono !== undefined ? cliente_telefono : pedidoPrevio.cliente_telefono;
    const nuevaDireccion = cliente_direccion !== undefined ? cliente_direccion : pedidoPrevio.cliente_direccion;
    const nuevasObs = observaciones !== undefined ? observaciones : pedidoPrevio.observaciones;
    const nuevoEstado = estado || pedidoPrevio.estado;

    const updateSql = `
      UPDATE pedidos
      SET tipo_pedido = $1,
          mesa_numero = $2,
          cliente_nombre = $3,
          cliente_telefono = $4,
          cliente_direccion = $5,
          observaciones = $6,
          estado = $7,
          total = $8
      WHERE id = $9
      RETURNING *
    `;

    const updateRes = await client.query(updateSql, [
      nuevoTipo,
      nuevaMesa,
      nuevoNombre,
      nuevoTelefono,
      nuevaDireccion,
      nuevasObs,
      nuevoEstado,
      totalFinal,
      id
    ]);

    const pedidoActualizado = updateRes.rows[0];

    // 3. Gestionar estado de mesas si cambió
    const mesaAnterior = pedidoPrevio.mesa_numero;
    if (mesaAnterior && mesaAnterior !== nuevaMesa) {
      const activasAnterior = await client.query(
        `SELECT id FROM pedidos WHERE mesa_numero = $1 AND id != $2 AND estado IN ('pendiente', 'en_preparacion', 'listo')`,
        [mesaAnterior, id]
      );
      if (activasAnterior.rowCount === 0) {
        await client.query(`UPDATE mesas SET estado = 'libre' WHERE numero = $1`, [mesaAnterior]);
      }
    }

    if (nuevaMesa) {
      await client.query(`UPDATE mesas SET estado = 'ocupada' WHERE numero = $1`, [nuevaMesa]);
    }

    await client.query('COMMIT');

    // Obtener líneas definitivas para la respuesta
    const lineasFinalesRes = await pool.query(`
      SELECT lp.id as linea_id, lp.pizza_id, pz.nombre, pz.imagen_url, lp.cantidad, lp.precio_unitario,
             (lp.cantidad * lp.precio_unitario) as subtotal, lp.notas
      FROM lineas_pedido lp
      JOIN pizzas pz ON lp.pizza_id = pz.id
      WHERE lp.pedido_id = $1
    `, [id]);

    res.json({
      success: true,
      message: `Comanda #${id} modificada y actualizada con éxito`,
      data: {
        ...pedidoActualizado,
        lineas: lineasFinalesRes.rows
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error al modificar pedido #${req.params.id}:`, error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error al modificar el pedido',
    });
  } finally {
    client.release();
  }
};

