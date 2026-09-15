/**
 * ==============================================================================
 * JAVASCRIPT PRINCIPAL: WEBAPP MÓVIL CLIENTE QR (MÓDULO DAM)
 * ==============================================================================
 */

// Base URL de la API REST (Enrutada automáticamente por el Reverse Proxy de Nginx)
const API_BASE_URL = '/api';

// Estado local de la aplicación móvil
const state = {
  isMesa: false,
  mesaNumero: null,
  tipoEntrega: 'domicilio',
  pizzas: [],
  cart: {}, // Formato: { [pizzaId]: { pizza, cantidad } }
  activeCategory: 'all',
  activeOrderId: localStorage.getItem('pizzeria_active_order_id') || null,
  trackingInterval: null
};

// ─── INICIALIZACIÓN ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  
  // Detectar si el cliente ha escaneado un código QR físico de su mesa (?mesa=4)
  const urlParams = new URLSearchParams(window.location.search);
  const mesaParam = urlParams.get('mesa');
  
  if (mesaParam) {
    state.isMesa = true;
    state.mesaNumero = parseInt(mesaParam, 10);
    state.tipoEntrega = 'mesa';
    
    // Configurar interfaz para comanda en mesa
    const boxMesaHeader = document.getElementById('box-mesa-header');
    const mesaHeaderText = document.getElementById('mesa-header-text');
    const boxTipoSelector = document.getElementById('box-tipo-selector');
    const boxDir = document.getElementById('box-direccion');
    const boxTel = document.getElementById('box-telefono');
    const inputNombre = document.getElementById('cliente-nombre');

    if (boxMesaHeader) boxMesaHeader.style.display = 'block';
    if (mesaHeaderText) mesaHeaderText.textContent = `Comanda para Mesa ${state.mesaNumero}`;
    if (boxTipoSelector) boxTipoSelector.style.display = 'none';
    if (boxDir) boxDir.style.display = 'none';
    if (boxTel) boxTel.style.display = 'none';
    if (inputNombre) inputNombre.placeholder = 'Nombre del comensal (Opcional)';
  } else {
    state.isMesa = false;
    state.mesaNumero = null;
    setupTipoEntregaListeners();
    selectTipoBtn('domicilio');
  }

  await loadPizzas();

  // Si hay un pedido activo guardado en la sesión, reanudar el seguimiento
  if (state.activeOrderId) {
    startOrderTracking(state.activeOrderId);
  }
});

function setupTipoEntregaListeners() {
  document.querySelectorAll('.tipo-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tipo = e.currentTarget.dataset.tipo;
      selectTipoBtn(tipo);
    });
  });
}

function selectTipoBtn(tipo) {
  if (state.isMesa) return; // Si está en mesa por QR, no se cambian tipos de pedido online

  state.tipoEntrega = tipo;
  document.querySelectorAll('.tipo-btn').forEach(b => {
    if (b.dataset.tipo === tipo) {
      b.style.background = '#dc2626';
      b.style.borderColor = '#dc2626';
      b.style.color = '#ffffff';
    } else {
      b.style.background = '#1e293b';
      b.style.borderColor = '#334155';
      b.style.color = '#cbd5e1';
    }
  });

  const boxDir = document.getElementById('box-direccion');
  const boxTel = document.getElementById('box-telefono');
  const inputNombre = document.getElementById('cliente-nombre');

  if (tipo === 'recoger') {
    if (boxDir) boxDir.style.display = 'none';
    if (boxTel) boxTel.style.display = 'block';
    if (inputNombre) inputNombre.placeholder = 'Tu Nombre y Apellidos (Obligatorio)';
  } else if (tipo === 'domicilio') {
    if (boxDir) boxDir.style.display = 'block';
    if (boxTel) boxTel.style.display = 'block';
    if (inputNombre) inputNombre.placeholder = 'Tu Nombre y Apellidos (Obligatorio)';
  }
}

// ─── EVENT LISTENERS ────────────────────────────────────────────────────────
function setupEventListeners() {
  // Filtros de categoría
  document.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeCategory = btn.getAttribute('data-cat');
      renderPizzas();
    });
  });

  // Abrir Drawer de Checkout
  document.getElementById('btn-checkout').addEventListener('click', openCheckoutDrawer);
  document.getElementById('btn-open-cart').addEventListener('click', openCheckoutDrawer);

  // Cerrar Drawer
  document.getElementById('btn-close-drawer').addEventListener('click', closeCheckoutDrawer);
  document.getElementById('drawer-overlay').addEventListener('click', closeCheckoutDrawer);

  // Enviar Pedido
  document.getElementById('btn-send-order').addEventListener('click', submitOrder);
}

// ─── CARGA DE PIZZAS ────────────────────────────────────────────────────────
async function loadPizzas() {
  const container = document.getElementById('pizzas-container');
  try {
    const res = await fetch(`${API_BASE_URL}/pizzas`);
    const data = await res.json();
    if (data.success) {
      state.pizzas = data.data;
      renderPizzas();
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Error al cargar la carta:', error);
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: #f87171;">
        <p>⚠️ No se pudo conectar con la cocina.</p>
        <button class="btn btn-primary" style="margin-top: 1rem;" onclick="loadPizzas()">Reintentar</button>
      </div>
    `;
  }
}

// ─── RENDER DE LA CARTA ─────────────────────────────────────────────────────
function renderPizzas() {
  const container = document.getElementById('pizzas-container');
  let filtered = state.pizzas;

  if (state.activeCategory !== 'all') {
    filtered = filtered.filter(p => String(p.categoria_id) === String(state.activeCategory));
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#8b949e;">No hay pizzas en esta categoría.</p>';
    return;
  }

  container.innerHTML = filtered.map(pizza => {
    const inCartQty = state.cart[pizza.id] ? state.cart[pizza.id].cantidad : 0;
    
    return `
      <article class="pizza-card" data-id="${pizza.id}">
        <div class="pizza-img-wrap">
          <img class="pizza-img" src="${pizza.imagen_url}" alt="${pizza.nombre}" loading="lazy">
          <span class="pizza-price-tag">${parseFloat(pizza.precio).toFixed(2)} €</span>
        </div>
        <div class="pizza-info">
          <h3 class="pizza-title">${pizza.nombre}</h3>
          <p class="pizza-desc">${pizza.descripcion}</p>
          
          <div class="pizza-card-action">
            <span style="font-size: 0.75rem; color: #8b949e;">
              ${pizza.ingredientes && pizza.ingredientes.length ? `${pizza.ingredientes.length} ingredientes` : 'Artesanal'}
            </span>

            ${inCartQty > 0 ? `
              <div class="quantity-stepper">
                <button class="stepper-btn" onclick="updateItemQuantity(${pizza.id}, -1)">-</button>
                <span class="stepper-qty">${inCartQty}</span>
                <button class="stepper-btn" onclick="updateItemQuantity(${pizza.id}, 1)">+</button>
              </div>
            ` : `
              <button class="btn-add" onclick="addItemToCart(${pizza.id})">
                + Añadir
              </button>
            `}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// ─── GESTIÓN DEL CARRITO REACTIVO ───────────────────────────────────────────
window.addItemToCart = function(pizzaId) {
  const pizza = state.pizzas.find(p => p.id === pizzaId);
  if (!pizza) return;

  state.cart[pizzaId] = {
    pizza: pizza,
    cantidad: 1,
    notas: ''
  };

  updateCartUi();
  renderPizzas();
};

window.updateItemQuantity = function(pizzaId, delta) {
  if (!state.cart[pizzaId]) return;

  state.cart[pizzaId].cantidad += delta;

  if (state.cart[pizzaId].cantidad <= 0) {
    delete state.cart[pizzaId];
  }

  updateCartUi();
  renderPizzas();
};

window.updateItemNotes = function(pizzaId, notes) {
  if (state.cart[pizzaId]) {
    state.cart[pizzaId].notas = notes;
  }
};

function updateCartUi() {
  const floatingCart = document.getElementById('floating-cart');
  const countEl = document.getElementById('cart-item-count');
  const totalEl = document.getElementById('cart-total-price');

  const items = Object.values(state.cart);
  const totalCount = items.reduce((sum, item) => sum + item.cantidad, 0);
  const totalPrice = items.reduce((sum, item) => sum + (parseFloat(item.pizza.precio) * item.cantidad), 0);

  if (totalCount > 0) {
    countEl.textContent = totalCount;
    totalEl.textContent = `${totalPrice.toFixed(2)} €`;
    floatingCart.classList.remove('hidden');
  } else {
    floatingCart.classList.add('hidden');
    closeCheckoutDrawer();
  }

  // Si el modal de confirmación de pedido (Drawer) está abierto, actualizar su vista en tiempo real
  const modal = document.getElementById('checkout-modal');
  if (modal && !modal.classList.contains('hidden')) {
    renderCheckoutDrawer();
  }
}

// ─── CHECKOUT DRAWER (MODAL DE PEDIDO) ──────────────────────────────────────
function renderCheckoutDrawer() {
  const items = Object.values(state.cart);
  if (items.length === 0) {
    closeCheckoutDrawer();
    return;
  }

  const itemsContainer = document.getElementById('checkout-items-list');
  const totalEl = document.getElementById('checkout-total-val');

  let total = 0;
  itemsContainer.innerHTML = items.map(item => {
    const subtotal = parseFloat(item.pizza.precio) * item.cantidad;
    total += subtotal;
    return `
      <div class="checkout-item-card">
        <div class="checkout-item-row">
          <div>
            <strong>${item.cantidad}x</strong> ${item.pizza.nombre}
          </div>
          <div style="display:flex; align-items:center; gap: 0.5rem;">
            <span style="font-weight:700; color:var(--color-amber);">${subtotal.toFixed(2)} €</span>
            <div class="quantity-stepper" style="padding: 0.1rem 0.2rem;">
              <button class="stepper-btn" style="width:22px; height:22px; font-size:0.8rem;" onclick="updateItemQuantity(${item.pizza.id}, -1)">-</button>
              <span class="stepper-qty" style="font-size:0.8rem;">${item.cantidad}</span>
              <button class="stepper-btn" style="width:22px; height:22px; font-size:0.8rem;" onclick="updateItemQuantity(${item.pizza.id}, 1)">+</button>
            </div>
          </div>
        </div>
        <input 
          type="text" 
          class="item-note-input" 
          placeholder="Personalizar pizza: ej. sin cebolla, masa fina..." 
          value="${item.notas ? item.notas.replace(/"/g, '&quot;') : ''}" 
          oninput="updateItemNotes(${item.pizza.id}, this.value)"
        >
      </div>
    `;
  }).join('');

  totalEl.textContent = `${total.toFixed(2)} €`;
}

function openCheckoutDrawer() {
  const items = Object.values(state.cart);
  if (items.length === 0) return;

  renderCheckoutDrawer();
  document.getElementById('checkout-modal').classList.remove('hidden');
}

function closeCheckoutDrawer() {
  document.getElementById('checkout-modal').classList.add('hidden');
}

// ─── ENVÍO DEL PEDIDO A LA API REST ─────────────────────────────────────────
async function submitOrder() {
  const sendBtn = document.getElementById('btn-send-order');
  const rawNombre = document.getElementById('cliente-nombre').value.trim();
  const observaciones = document.getElementById('cliente-observaciones').value.trim();
  const direccion = document.getElementById('cliente-direccion')?.value.trim() || null;
  const telefono = document.getElementById('cliente-telefono')?.value.trim() || null;

  // Validaciones según el canal
  if (state.isMesa) {
    // Cliente en el restaurante por QR: No requiere datos obligatorios
  } else if (state.tipoEntrega === 'recoger') {
    if (!rawNombre) {
      alert('Por favor, indica tu nombre para la recogida.');
      return;
    }
    if (!telefono) {
      alert('Por favor, indica un teléfono de contacto.');
      return;
    }
  } else if (state.tipoEntrega === 'domicilio') {
    if (!rawNombre) {
      alert('Por favor, indica tu nombre para la entrega.');
      return;
    }
    if (!telefono) {
      alert('Por favor, indica un teléfono de contacto para el repartidor.');
      return;
    }
    if (!direccion) {
      alert('Por favor, indica tu dirección de entrega (calle, número y piso).');
      return;
    }
  }

  const clienteNombre = rawNombre || (state.isMesa ? `Cliente Mesa ${state.mesaNumero}` : 'Cliente Web');

  const lineas = Object.values(state.cart).map(item => ({
    pizza_id: item.pizza.id,
    cantidad: item.cantidad,
    notas: item.notas && item.notas.trim() ? item.notas.trim() : null
  }));

  const payload = {
    tipo_pedido: state.isMesa ? 'mesa' : state.tipoEntrega,
    mesa_numero: state.isMesa ? state.mesaNumero : null,
    cliente_nombre: clienteNombre,
    cliente_telefono: state.isMesa ? null : telefono,
    cliente_direccion: (!state.isMesa && state.tipoEntrega === 'domicilio') ? direccion : null,
    observaciones: observaciones || null,
    lineas: lineas
  };

  try {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Enviando a cocina...';

    const res = await fetch(`${API_BASE_URL}/pedidos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.success) {
      const orderId = data.data.id;
      localStorage.setItem('pizzeria_active_order_id', orderId);
      state.activeOrderId = orderId;

      // Limpiar carrito
      state.cart = {};
      updateCartUi();
      renderPizzas();
      closeCheckoutDrawer();

      // Iniciar seguimiento
      startOrderTracking(orderId);
    } else {
      alert(`Error: ${data.message}`);
    }
  } catch (error) {
    console.error('Error al tramitar pedido:', error);
    alert('Fallo de conexión al enviar el pedido.');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = '🚀 Enviar Pedido a Cocina';
  }
}

// ─── SEGUIMIENTO EN TIEMPO REAL DEL PEDIDO (POLLING) ────────────────────────
function startOrderTracking(orderId) {
  clearInterval(state.trackingInterval);
  const banner = document.getElementById('active-order-banner');
  if (banner) banner.classList.remove('hidden');

  const poll = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/pedidos/${orderId}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.success) {
        const order = data.data;
        updateTrackingUi(order);

        if (order.estado === 'servido' || order.estado === 'entregado' || order.estado === 'cancelado') {
          clearInterval(state.trackingInterval);
          localStorage.removeItem('pizzeria_active_order_id');
        }
      }
    } catch (err) {
      console.warn('Error en polling de seguimiento:', err);
    }
  };

  poll();
  state.trackingInterval = setInterval(poll, 4000);
}

function updateTrackingUi(order) {
  const title = document.getElementById('tracking-title');
  const statusText = document.getElementById('tracking-status-text');
  const progressFill = document.getElementById('progress-bar-fill');

  let tipoDesc = order.tipo_pedido === 'domicilio' ? 'A Domicilio 🛵' : 'Para Recoger 🥡';

  if (title) title.textContent = `Pedido #${order.id} (${tipoDesc})`;

  if (order.estado === 'pendiente') {
    if (statusText) statusText.textContent = 'Estado: Recibido en cocina • Esperando turno de horno';
    if (progressFill) progressFill.style.width = '25%';
  } else if (order.estado === 'en_preparacion') {
    if (statusText) statusText.textContent = 'Estado: 🔥 En el horno artesanal ahora mismo';
    if (progressFill) progressFill.style.width = '60%';
  } else if (order.estado === 'en_reparto') {
    if (statusText) statusText.textContent = 'Estado: 🛵 ¡El repartidor va de camino a tu dirección!';
    if (progressFill) progressFill.style.width = '85%';
  } else if (order.estado === 'listo') {
    if (order.tipo_pedido === 'recoger') {
      if (statusText) statusText.textContent = 'Estado: 🥡 ¡Listo para recoger en el mostrador!';
    } else {
      if (statusText) statusText.textContent = 'Estado: 🛵 ¡Listo! Empaquetado para reparto';
    }
    if (progressFill) progressFill.style.width = '90%';
  } else if (order.estado === 'servido' || order.estado === 'entregado') {
    if (statusText) statusText.textContent = 'Estado: ✅ ¡Entregado! ¡Que aproveche!';
    if (progressFill) progressFill.style.width = '100%';
  }
}

// ─── PWA: GESTIÓN DE INSTALACIÓN NATIVA ─────────────────────────────────────
let deferredPrompt = null;
const btnInstallPwa = document.getElementById('btn-install-pwa');

window.addEventListener('beforeinstallprompt', (e) => {
  // Previene el banner por defecto del navegador para controlarlo nosotros
  e.preventDefault();
  deferredPrompt = e;
  if (btnInstallPwa) {
    btnInstallPwa.classList.remove('hidden');
    btnInstallPwa.style.display = 'flex';
  }
});

if (btnInstallPwa) {
  btnInstallPwa.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('📱 Resultado de instalación PWA:', outcome);
      deferredPrompt = null;
      btnInstallPwa.style.display = 'none';
    } else {
      // Si el navegador no permite el prompt automático (ej: HTTP en IP local o iOS Safari)
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        alert('📲 Para instalar en tu iPhone:\n1. Toca el botón Compartir ⬆️ abajo.\n2. Selecciona "Añadir a pantalla de inicio".');
      } else {
        alert('📲 Para instalar en tu Android:\n1. Toca los 3 puntos (⋮) arriba a la derecha en Chrome.\n2. Pulsa "Instalar aplicación" o "Añadir a pantalla de inicio".');
      }
    }
  });
}

window.addEventListener('appinstalled', () => {
  console.log('🎉 PWA instalada con éxito en el dispositivo');
  if (btnInstallPwa) {
    btnInstallPwa.classList.add('hidden');
    btnInstallPwa.style.display = 'none';
  }
});
