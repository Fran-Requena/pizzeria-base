/**
 * ==============================================================================
 * PIZZERÍA BELLA NAPOLI - MAIN JAVASCRIPT
 * Arquitectura Full-Stack + Tailwind CSS (Utility-First) + Dark Mode
 * ==============================================================================
 */

// CONFIGURACIÓN DE ENDPOINTS
const API_BASE = '/api';

// ESTADO GLOBAL DE LA APLICACIÓN
const state = {
  userMode: 'cliente',        // 'cliente' | 'cocinero' | 'admin'
  currentClientView: 'landing', // 'landing' | 'menu' | 'tracking'
  activePersonalTab: 'cocina',  // 'cocina' | 'mostrador' | 'carta' | 'mesas'
  
  // Datos
  pizzas: [],
  pedidos: [],
  mesas: [],
  
  // Carrito de compras
  cart: [],
  orderType: 'domicilio',     // 'domicilio' | 'recoger' | 'mesa'
  selectedMesa: 3,
  
  // Seguimiento de pedido
  activeTrackingId: localStorage.getItem('last_pedido_id') || null,
  trackingInterval: null,
  
  // KDS auto-refresco y opciones
  kdsInterval: null,
  kdsFilter: 'all',
  kdsOcultarCobrados: true,
  
  // PIN Auth
  currentPin: '',

  // Cobros & Cuentas TPV
  posSubTab: 'nuevo',           // 'nuevo' | 'pendientes'
  cobrosFilter: 'all',          // 'all' | 'mesa' | 'domicilio' | 'recoger'
  cobroModalOrder: null,

  // Histórico & Mantenimiento por Fechas
  historicoRango: 'hoy',        // 'hoy' | 'ayer' | 'semana' | 'todos' | 'custom'
  historicoFecha: new Date().toISOString().split('T')[0],
};


// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initEventListeners();
  checkUrlParamsForTable();
  checkPaymentRedirectParams();
  await checkApiHealth();
  await loadPizzas();
  await loadMesas();

  // Si hay un pedido activo previo, activar el badge
  if (state.activeTrackingId) {
    document.getElementById('badge-tracking')?.classList.remove('hidden');
    startTrackingPolling();
  }
});

// Comprobar retorno de pasarela de pagos Stripe
function checkPaymentRedirectParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const pagoStatus = urlParams.get('pago');
  const pedidoId = urlParams.get('pedido_id');
  const sessionId = urlParams.get('session_id');

  if (pagoStatus === 'exito') {
    if (pedidoId) {
      state.activeTrackingId = pedidoId;
      localStorage.setItem('last_pedido_id', pedidoId);
      document.getElementById('badge-tracking')?.classList.remove('hidden');
      switchClientView('tracking');

      // Reconciliación inmediata síncrona
      fetch(`${API_BASE}/pagos/confirmar-sesion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedido_id: pedidoId, session_id: sessionId })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.estado_pago === 'pagado') {
          showToast('🎉 ¡Pago verificado con Stripe! Tu comanda ha entrado en cocina.', 'success');
          fetchTrackingData(pedidoId);
        }
      })
      .catch(console.error);

      startTrackingPolling();
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (pagoStatus === 'cancelado') {
    if (pedidoId) {
      state.activeTrackingId = pedidoId;
      document.getElementById('badge-tracking')?.classList.remove('hidden');
      switchClientView('tracking');
      startTrackingPolling();
    }
    showToast('ℹ️ Proceso de pago en Stripe cancelado. El pedido se mantiene pendiente de pago.', 'info');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// ==============================================================================
// GESTIÓN DE TEMA (DARK / LIGHT MODE CON TAILWIND)
// ==============================================================================
function initTheme() {
  const savedTheme = localStorage.getItem('pizzeria_theme') || 'dark';
  applyTheme(savedTheme);

  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    const nextTheme = isDark ? 'light' : 'dark';
    applyTheme(nextTheme);
    localStorage.setItem('pizzeria_theme', nextTheme);
    showToast(nextTheme === 'dark' ? '🌙 Modo Oscuro activado' : '☀️ Modo Claro activado', 'info');
  });
}

function applyTheme(theme) {
  const root = document.documentElement;
  const icon = document.getElementById('theme-icon');
  const btn = document.getElementById('btn-theme-toggle');

  if (theme === 'dark') {
    root.classList.add('dark');
    if (icon) icon.textContent = '☀️';
    if (btn) btn.title = 'Cambiar a Modo Claro';
  } else {
    root.classList.remove('dark');
    if (icon) icon.textContent = '🌙';
    if (btn) btn.title = 'Cambiar a Modo Oscuro';
  }
}

// ==============================================================================
// DETECCIÓN DE CÓDIGO QR EN LA URL (?mesa=X)
// ==============================================================================
function checkUrlParamsForTable() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('mesa')) {
    const mesaNum = parseInt(params.get('mesa'), 10) || 1;
    state.selectedMesa = mesaNum;
    state.orderType = 'mesa';

    const radioMesaLabel = document.getElementById('radio-label-mesa');
    const radioMesa = document.querySelector('input[name="order-type"][value="mesa"]');
    const txtLabelMesa = document.getElementById('txt-label-mesa');
    
    if (radioMesaLabel) radioMesaLabel.classList.remove('hidden');
    if (txtLabelMesa) txtLabelMesa.textContent = `📍 En Mesa ${mesaNum}`;
    if (radioMesa) radioMesa.checked = true;

    // Ocultar Domicilio y Recoger para el cliente en sala
    document.querySelector('input[name="order-type"][value="domicilio"]')?.parentElement.classList.add('hidden');
    document.querySelector('input[name="order-type"][value="recoger"]')?.parentElement.classList.add('hidden');

    switchClientView('menu');
    updateOrderModeUI();

    showToast(`🍽️ ¡Bienvenido! Estás pidiendo desde la Mesa ${mesaNum}.`, 'info');
  } else {
    document.getElementById('radio-label-mesa')?.classList.add('hidden');
    document.querySelector('input[name="order-type"][value="domicilio"]')?.parentElement.classList.remove('hidden');
    document.querySelector('input[name="order-type"][value="recoger"]')?.parentElement.classList.remove('hidden');
  }
}

// ==============================================================================
// COMPROBAR CONEXIÓN API
// ==============================================================================
async function checkApiHealth() {
  const statusEl = document.getElementById('api-status');
  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
    if (res.ok) {
      statusEl.querySelector('.status-dot').className = 'w-2 h-2 rounded-full bg-emerald-500 status-dot';
      statusEl.querySelector('.status-text').textContent = 'API Conectada';
    } else {
      throw new Error('API no OK');
    }
  } catch (err) {
    statusEl.querySelector('.status-dot').className = 'w-2 h-2 rounded-full bg-amber-500 status-dot';
    statusEl.querySelector('.status-text').textContent = 'Modo Local';
  }
}

// ==============================================================================
// GESTIÓN DE VISTAS Y NAVEGACIÓN
// ==============================================================================
function switchClientView(viewName) {
  state.currentClientView = viewName;
  
  // Ocultar vistas de cliente y el contenedor personal
  document.querySelectorAll('.client-view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${viewName}`)?.classList.remove('hidden');
  document.getElementById('view-personal-container')?.classList.add('hidden');

  // Si el usuario es empleado pero está visitando la web pública, mostrar banner en tracking
  const returnBanner = document.getElementById('tracking-staff-return-banner');
  if (returnBanner) {
    returnBanner.classList.toggle('hidden', state.userMode === 'cliente');
  }

  // Actualizar botones de navegación cliente
  document.querySelectorAll('#nav-cliente .nav-tab').forEach(tab => {
    const isActive = tab.dataset.view === viewName;
    if (isActive) {
      tab.className = 'nav-tab active px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-brand-500 shadow-sm flex items-center gap-1.5 transition-all';
    } else {
      tab.className = 'nav-tab px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700/50 flex items-center gap-1.5 transition-all';
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (viewName === 'tracking') {
    if (state.activeTrackingId) {
      fetchTrackingData(state.activeTrackingId);
    }
  }
}

function returnToStaffPanel(targetTab = 'cocina') {
  if (state.userMode === 'cliente') {
    openStaffModal();
    return;
  }
  document.querySelectorAll('.client-view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-personal-container')?.classList.remove('hidden');
  document.getElementById('main-commercial-footer')?.classList.add('hidden');
  
  const navCliente = document.getElementById('nav-cliente');
  const navPersonal = document.getElementById('nav-personal');
  if (navCliente) navCliente.className = 'hidden items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60';
  if (navPersonal) navPersonal.className = 'hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60';

  switchPersonalTab(targetTab);
}

function switchPersonalTab(tabName) {
  state.activePersonalTab = tabName;

  // Asegurar que el contenedor de personal está visible, vistas cliente ocultas y pie comercial oculto
  document.querySelectorAll('.client-view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-personal-container')?.classList.remove('hidden');
  document.getElementById('main-commercial-footer')?.classList.add('hidden');

  // Actualizar tabs en nav-personal
  document.querySelectorAll('#nav-personal .nav-tab').forEach(tab => {
    const isActive = tab.dataset.tab === tabName;
    if (isActive) {
      tab.className = `nav-tab active px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-brand-500 shadow-sm flex items-center gap-1.5 transition-all ${tab.classList.contains('admin-only') && state.userMode !== 'admin' ? 'hidden' : ''}`;
    } else {
      tab.className = `nav-tab px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700/50 flex items-center gap-1.5 transition-all ${tab.classList.contains('admin-only') && state.userMode !== 'admin' ? 'hidden' : ''}`;
    }
  });

  // Mostrar sección activa
  document.querySelectorAll('#view-personal-container .tab-content').forEach(section => {
    section.classList.toggle('hidden', section.id !== `tab-${tabName}`);
  });

  if (tabName === 'cocina') {
    loadPedidosKDS();
  } else if (tabName === 'cobros') {
    loadPedidosKDS();
    renderCobrosCrudTable();
  } else if (tabName === 'historico') {
    loadPedidosKDS();
    renderHistoricoTable();
  } else if (tabName === 'carta') {
    renderAdminPizzas();
  } else if (tabName === 'mesas') {
    loadMesas();
  } else if (tabName === 'mostrador') {
    renderPosCatalog();
    loadPedidosKDS();
  }
}


// ==============================================================================
// AUTENTICACIÓN PERSONAL (PIN 1111 / 9999)
// ==============================================================================
function openStaffModal() {
  state.currentPin = '';
  document.getElementById('staff-pin-input').value = '';
  document.getElementById('staff-modal').classList.remove('hidden');
}

function closeStaffModal() {
  document.getElementById('staff-modal').classList.add('hidden');
  state.currentPin = '';
}

function handlePinInput(digit) {
  if (state.currentPin.length < 4) {
    state.currentPin += digit;
    document.getElementById('staff-pin-input').value = state.currentPin;
    
    if (state.currentPin.length === 4) {
      verifyStaffPin(state.currentPin);
    }
  }
}

function verifyStaffPin(pin) {
  if (pin === '1111') {
    loginStaff('cocinero');
  } else if (pin === '9999') {
    loginStaff('admin');
  } else {
    showToast('❌ PIN incorrecto (Prueba 1111 para Cocina o 9999 para Admin)', 'error');
    state.currentPin = '';
    document.getElementById('staff-pin-input').value = '';
  }
}

function loginStaff(role) {
  state.userMode = role;
  closeStaffModal();

  // Ocultar vistas de cliente y mostrar intranet
  document.querySelectorAll('.client-view').forEach(v => v.classList.add('hidden'));
  
  const navCliente = document.getElementById('nav-cliente');
  const navPersonal = document.getElementById('nav-personal');

  if (navCliente) navCliente.className = 'hidden items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60';
  if (navPersonal) navPersonal.className = 'hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60';

  document.getElementById('btn-header-cart')?.classList.add('hidden');
  document.getElementById('view-personal-container')?.classList.remove('hidden');
  document.getElementById('staff-active-bar')?.classList.remove('hidden');
  document.getElementById('main-commercial-footer')?.classList.add('hidden');

  // Menú móvil
  document.getElementById('mobile-nav-cliente')?.classList.add('hidden');
  document.getElementById('mobile-nav-personal')?.classList.remove('hidden');

  const roleNameEl = document.getElementById('staff-role-name');
  const roleBadgeEl = document.getElementById('staff-role-badge');
  const avatarEl = document.getElementById('staff-avatar');
  const appSubtitle = document.getElementById('app-subtitle');

  if (role === 'cocinero') {
    roleNameEl.textContent = 'Cocinero (Turno Activo)';
    roleBadgeEl.textContent = 'KDS Cocina';
    roleBadgeEl.className = 'px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase';
    avatarEl.textContent = '👨‍🍳';
    appSubtitle.textContent = 'Sistema KDS de Cocina en Vivo';

    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    switchPersonalTab('cocina');
  } else {
    roleNameEl.textContent = 'Administrador General';
    roleBadgeEl.textContent = 'Acceso Total';
    roleBadgeEl.className = 'px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/40 uppercase';
    avatarEl.textContent = '👑';
    appSubtitle.textContent = 'Panel de Administración & Control';

    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    switchPersonalTab('cocina');
  }

  startKdsPolling();
  showToast(`✅ Sesión iniciada como ${role.toUpperCase()}`, 'success');
}

function logoutStaff() {
  state.userMode = 'cliente';
  clearInterval(state.kdsInterval);

  const navCliente = document.getElementById('nav-cliente');
  const navPersonal = document.getElementById('nav-personal');

  if (navPersonal) navPersonal.className = 'hidden items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60';
  if (navCliente) navCliente.className = 'hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60';

  document.getElementById('view-personal-container')?.classList.add('hidden');
  document.getElementById('staff-active-bar')?.classList.add('hidden');
  document.getElementById('main-commercial-footer')?.classList.remove('hidden');
  document.getElementById('btn-header-cart')?.classList.remove('hidden');
  document.getElementById('app-subtitle').textContent = 'Auténtica Pizza Napolitana';

  // Menú móvil
  document.getElementById('mobile-nav-cliente')?.classList.remove('hidden');
  document.getElementById('mobile-nav-personal')?.classList.add('hidden');

  switchClientView('landing');
  showToast('👋 Has vuelto al modo público de cliente', 'info');
}

// ==============================================================================
// CARGA Y RENDERIZADO DE PIZZAS (CON CLASES TAILWIND)
// ==============================================================================
async function loadPizzas() {
  try {
    const res = await fetch(`${API_BASE}/pizzas`);
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      state.pizzas = data.data;
      renderClientPizzas();
      renderFeaturedLandingPizzas();
    }
  } catch (err) {
    console.error('Error al cargar pizzas:', err);
  }
}

function renderFeaturedLandingPizzas() {
  const container = document.getElementById('landing-featured-pizzas');
  if (!container) return;

  const topPizzas = state.pizzas.slice(0, 3);
  container.innerHTML = topPizzas.map(pizza => `
    <div class="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col group">
      <div class="h-52 overflow-hidden relative bg-slate-100 dark:bg-slate-800">
        <img src="${pizza.imagen_url || 'https://images.unsplash.com/photo-1513104890138-7c749659a591'}" alt="${pizza.nombre}" class="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" loading="lazy">
        <span class="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-extrabold bg-black/60 backdrop-blur-md text-white border border-white/20">
          ⭐ Destacada
        </span>
      </div>
      <div class="p-6 flex-1 flex flex-col justify-between space-y-4">
        <div>
          <h3 class="font-display font-bold text-xl text-slate-900 dark:text-white">${pizza.nombre}</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mt-1">${pizza.descripcion}</p>
        </div>
        <div class="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
          <span class="font-display font-extrabold text-2xl text-slate-900 dark:text-white">${parseFloat(pizza.precio).toFixed(2)} €</span>
          <button onclick="addToCart(${pizza.id})" class="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm shadow-md hover:scale-105 transition-all cursor-pointer">
            🛒 Pedir
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderClientPizzas(filterCat = 'all', searchTerm = '') {
  const grid = document.getElementById('client-pizzas-grid');
  if (!grid) return;

  let filtered = state.pizzas.filter(p => p.disponible !== false);

  if (filterCat !== 'all') {
    filtered = filtered.filter(p => p.categoria_id == filterCat);
  }

  if (searchTerm.trim()) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(p => 
      p.nombre.toLowerCase().includes(term) || 
      p.descripcion.toLowerCase().includes(term)
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-center py-12 text-slate-500">No se encontraron pizzas disponibles con ese criterio.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(pizza => `
    <div class="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col group">
      <div class="h-48 overflow-hidden relative bg-slate-100 dark:bg-slate-800">
        <img src="${pizza.imagen_url || 'https://images.unsplash.com/photo-1513104890138-7c749659a591'}" alt="${pizza.nombre}" class="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" loading="lazy">
        <span class="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-extrabold bg-black/60 backdrop-blur-md text-white border border-white/20">
          ${getCategoryName(pizza.categoria_id)}
        </span>
      </div>
      <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
        <div>
          <h3 class="font-display font-bold text-lg text-slate-900 dark:text-white">${pizza.nombre}</h3>
          <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mt-1 leading-relaxed">${pizza.descripcion}</p>
        </div>
        <div class="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
          <span class="font-display font-black text-xl text-slate-900 dark:text-white">${parseFloat(pizza.precio).toFixed(2)} €</span>
          <button onclick="addToCart(${pizza.id})" class="px-3.5 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs sm:text-sm shadow-md hover:scale-105 transition-all cursor-pointer flex items-center gap-1.5">
            <span>➕</span> <span>Añadir</span>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function getCategoryName(catId) {
  if (catId == 1) return '🍕 Clásica';
  if (catId == 2) return '⭐ Especial';
  if (catId == 3) return '👑 Gourmet';
  return '🍕 Pizza';
}

// ==============================================================================
// GESTIÓN DEL CARRITO & MODALIDADES DE PEDIDO
// ==============================================================================
window.addToCart = function(pizzaId) {
  const pizza = state.pizzas.find(p => p.id === pizzaId);
  if (!pizza) return;

  const existing = state.cart.find(item => item.pizza_id === pizzaId);
  if (existing) {
    existing.cantidad += 1;
  } else {
    state.cart.push({
      pizza_id: pizza.id,
      nombre: pizza.nombre,
      precio: parseFloat(pizza.precio),
      cantidad: 1,
      notas: '',
    });
  }

  updateCartBadge();
  renderCartDrawer();
  showToast(`🛒 "${pizza.nombre}" añadida a la cesta`, 'success');
};

function updateCartQty(pizzaId, change) {
  const item = state.cart.find(i => i.pizza_id === pizzaId);
  if (!item) return;

  item.cantidad += change;
  if (item.cantidad <= 0) {
    state.cart = state.cart.filter(i => i.pizza_id !== pizzaId);
  }

  updateCartBadge();
  renderCartDrawer();
}

function updateCartBadge() {
  const totalCount = state.cart.reduce((sum, i) => sum + i.cantidad, 0);
  const badgeHeader = document.getElementById('header-cart-count');
  if (badgeHeader) badgeHeader.textContent = totalCount;
}

function renderCartDrawer() {
  const container = document.getElementById('cart-items-container');
  const totalEl = document.getElementById('cart-total-amount');
  const btnSubmit = document.getElementById('btn-submit-order');

  if (!container) return;

  if (state.cart.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-500 dark:text-slate-400 text-center py-6">Tu cesta está vacía. ¡Añade pizzas desde la carta!</p>`;
    totalEl.textContent = '0.00 €';
    btnSubmit.disabled = true;
    return;
  }

  let total = 0;
  container.innerHTML = state.cart.map(item => {
    const subtotal = item.precio * item.cantidad;
    total += subtotal;
    return `
      <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-3 text-xs sm:text-sm">
        <div class="flex-1">
          <h5 class="font-bold text-slate-900 dark:text-white">${item.nombre}</h5>
          <p class="text-xs text-slate-500">${item.precio.toFixed(2)} € x ${item.cantidad} = <strong class="text-slate-800 dark:text-slate-200">${subtotal.toFixed(2)} €</strong></p>
        </div>
        <div class="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-1 rounded-xl">
          <button class="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center cursor-pointer" onclick="updateCartQty(${item.pizza_id}, -1)">-</button>
          <span class="font-bold text-xs min-w-[16px] text-center">${item.cantidad}</span>
          <button class="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center cursor-pointer" onclick="updateCartQty(${item.pizza_id}, 1)">+</button>
        </div>
      </div>
    `;
  }).join('');

  totalEl.textContent = `${total.toFixed(2)} €`;
  btnSubmit.disabled = false;
}

function updateOrderModeUI() {
  const radio = document.querySelector('input[name="order-type"]:checked');
  if (!radio) return;

  state.orderType = radio.value;

  const banner = document.getElementById('order-mode-info-banner');
  const bannerIcon = document.getElementById('mode-info-icon');
  const bannerText = document.getElementById('mode-info-text');

  const cartIcon = document.getElementById('cart-mode-icon');
  const cartDetails = document.getElementById('cart-mode-details');

  const telGroup = document.getElementById('checkout-tel-group');
  const dirGroup = document.getElementById('checkout-dir-group');
  const mesaGroup = document.getElementById('checkout-mesa-group');
  const mesaDisplay = document.getElementById('checkout-mesa-display');

  if (state.orderType === 'domicilio') {
    telGroup?.classList.remove('hidden');
    dirGroup?.classList.remove('hidden');
    mesaGroup?.classList.add('hidden');

    banner.className = 'p-4 rounded-2xl bg-brand-500/10 border border-brand-500/30 text-brand-600 dark:text-brand-400 text-sm flex items-center gap-3';
    bannerIcon.textContent = '🛵';
    bannerText.innerHTML = '<strong>Pedido a Domicilio:</strong> Te lo llevamos caliente a casa en 30-40 min. Pago al repartidor en efectivo o datáfono.';

    cartIcon.textContent = '🛵';
    cartDetails.innerHTML = '<strong class="block text-sm text-slate-900 dark:text-white">Modalidad: A Domicilio</strong><small class="text-slate-500 dark:text-slate-400">Entrega en 30-40 min</small>';

  } else if (state.orderType === 'recoger') {
    telGroup?.classList.remove('hidden');
    dirGroup?.classList.add('hidden');
    mesaGroup?.classList.add('hidden');

    banner.className = 'p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm flex items-center gap-3';
    bannerIcon.textContent = '🥡';
    bannerText.innerHTML = '<strong>Para Recoger en Local:</strong> Pasa a buscarlo sin colas. Te avisamos en cuanto esté recién salido del horno.';

    cartIcon.textContent = '🥡';
    cartDetails.innerHTML = '<strong class="block text-sm text-slate-900 dark:text-white">Modalidad: Para Recoger</strong><small class="text-slate-500 dark:text-slate-400">Recogida en mostrador</small>';

  } else if (state.orderType === 'mesa') {
    telGroup?.classList.add('hidden');
    dirGroup?.classList.add('hidden');
    mesaGroup?.classList.remove('hidden');

    if (mesaDisplay) mesaDisplay.value = `Mesa ${state.selectedMesa}`;

    banner.className = 'p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-sm flex items-center gap-3';
    bannerIcon.textContent = '🍽️';
    bannerText.innerHTML = `<strong>En Mesa (${state.selectedMesa}):</strong> Enviamos tu comanda directamente al horno sin esperas.`;

    cartIcon.textContent = '🍽️';
    cartDetails.innerHTML = `<strong class="block text-sm text-slate-900 dark:text-white">Modalidad: En Mesa ${state.selectedMesa}</strong><small class="text-slate-500 dark:text-slate-400">Servido directo a tu mesa</small>`;
  }
}

// ==============================================================================
// ENVÍO DE PEDIDO ONLINE (POST /api/pedidos)
// ==============================================================================
async function submitClientOrder() {
  if (state.cart.length === 0) return;

  const nombre = document.getElementById('checkout-cliente-nombre').value.trim();
  const tel = document.getElementById('checkout-cliente-tel').value.trim();
  const dir = document.getElementById('checkout-cliente-dir').value.trim();
  const obs = document.getElementById('checkout-observaciones').value.trim();
  const pagoRadio = document.querySelector('input[name="payment-method"]:checked');
  const metodoPago = pagoRadio ? pagoRadio.value : 'efectivo_entrega';

  if (!nombre) {
    showToast('⚠️ Por favor, indica tu nombre', 'error');
    return;
  }

  if (state.orderType === 'domicilio') {
    if (!tel || !dir) {
      showToast('⚠️ Teléfono y Dirección son obligatorios para entrega a domicilio', 'error');
      return;
    }
  } else if (state.orderType === 'recoger') {
    if (!tel) {
      showToast('⚠️ Indica un teléfono de contacto para el aviso de recogida', 'error');
      return;
    }
  }

  const payload = {
    tipo_pedido: state.orderType,
    mesa_numero: state.orderType === 'mesa' ? state.selectedMesa : null,
    cliente_nombre: nombre,
    cliente_telefono: tel || null,
    cliente_direccion: state.orderType === 'domicilio' ? dir : null,
    metodo_pago: metodoPago,
    observaciones: obs || null,
    lineas: state.cart.map(item => ({
      pizza_id: item.pizza_id,
      cantidad: item.cantidad,
      notas: item.notas || null,
    })),
  };

  const btnSubmit = document.getElementById('btn-submit-order');
  btnSubmit.disabled = true;
  btnSubmit.textContent = '⏳ Enviando a Cocina...';

  try {
    const res = await fetch(`${API_BASE}/pedidos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      const pedidoCreado = data.data;

      // Si el cliente eligió Stripe, intentar iniciar Checkout de forma transparente
      if (metodoPago === 'stripe') {
        btnSubmit.textContent = '💳 Conectando con Stripe...';
        try {
          const stripeRes = await fetch(`${API_BASE}/pagos/crear-sesion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pedido_id: pedidoCreado.id }),
          });

          const stripeData = await stripeRes.json();

          if (stripeRes.ok && stripeData.success && stripeData.url) {
            state.cart = [];
            updateCartBadge();
            closeCartDrawer();
            showToast('🔄 Redirigiendo a pasarela segura de Stripe...', 'info');
            window.location.href = stripeData.url;
            return;
          } else {
            showToast(`⚠️ ${stripeData.message || 'Stripe no disponible en este servidor. Pedido registrado para pago en caja.'}`, 'warning');
          }
        } catch (stripeErr) {
          showToast(`⚠️ Pasarela Stripe inactiva. Pedido guardado para abonar en entrega o caja.`, 'warning');
        }
      }

      state.cart = [];
      updateCartBadge();
      closeCartDrawer();

      state.activeTrackingId = pedidoCreado.id;
      localStorage.setItem('last_pedido_id', pedidoCreado.id);
      document.getElementById('badge-tracking')?.classList.remove('hidden');

      showToast(`🎉 ¡Pedido #${pedidoCreado.id} enviado a cocina!`, 'success');

      switchClientView('tracking');
      startTrackingPolling();
    } else {
      throw new Error(data.message || 'Error al tramitar el pedido');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = '🚀 Confirmar y Enviar Pedido';
  }
}

// ==============================================================================
// SEGUIMIENTO DE PEDIDO EN VIVO (TRACKING)
// ==============================================================================
async function fetchTrackingData(orderId) {
  try {
    const res = await fetch(`${API_BASE}/pedidos/${orderId}`);
    const data = await res.json();
    if (res.ok && data.success) {
      const pedido = data.data;
      renderTrackingUI(pedido);

      // Reconciliación automática con Stripe si está pendiente pero tiene sesión
      if (pedido.metodo_pago === 'stripe' && pedido.estado_pago === 'pendiente' && pedido.stripe_session_id) {
        fetch(`${API_BASE}/pagos/confirmar-sesion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pedido_id: pedido.id, session_id: pedido.stripe_session_id })
        })
        .then(r => r.json())
        .then(confData => {
          if (confData.success && confData.estado_pago === 'pagado') {
            pedido.estado_pago = 'pagado';
            renderTrackingUI(pedido);
          }
        })
        .catch(console.error);
      }
    }
  } catch (err) {
    console.error('Error al consultar tracking:', err);
  }
}

function renderTrackingUI(pedido) {
  document.getElementById('tracking-order-title').textContent = `Estado de tu Pedido #${pedido.id}`;
  
  const badgeType = document.getElementById('tracking-type-badge');
  if (pedido.tipo_pedido === 'domicilio') {
    badgeType.textContent = '🛵 PEDIDO A DOMICILIO';
  } else if (pedido.tipo_pedido === 'recoger') {
    badgeType.textContent = '🥡 PEDIDO PARA RECOGER';
  } else {
    badgeType.textContent = `🍽️ PEDIDO EN MESA ${pedido.mesa_numero}`;
  }

  const stepPendiente = document.getElementById('step-pendiente');
  const stepPrep = document.getElementById('step-preparacion');
  const stepCamino = document.getElementById('step-camino');
  const stepEntregado = document.getElementById('step-entregado');

  const steps = [stepPendiente, stepPrep, stepCamino, stepEntregado];
  steps.forEach(s => s.className = 'p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 space-y-1 text-slate-500');

  const estado = pedido.estado;

  if (estado === 'pendiente') {
    stepPendiente.className = 'p-3 rounded-2xl bg-brand-500/10 border border-brand-500 text-brand-500 font-bold space-y-1';
  } else if (estado === 'en_preparacion') {
    stepPendiente.className = 'p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500 text-emerald-500 font-bold space-y-1';
    stepPrep.className = 'p-3 rounded-2xl bg-orange-500/10 border border-orange-500 text-orange-500 font-bold space-y-1';
  } else if (estado === 'en_reparto' || estado === 'listo') {
    stepPendiente.className = 'p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500 text-emerald-500 font-bold space-y-1';
    stepPrep.className = 'p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500 text-emerald-500 font-bold space-y-1';
    stepCamino.className = 'p-3 rounded-2xl bg-brand-500/10 border border-brand-500 text-brand-500 font-bold space-y-1';
  } else if (estado === 'servido' || estado === 'entregado') {
    steps.forEach(s => s.className = 'p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500 text-emerald-500 font-bold space-y-1');
  }

  const itemsContainer = document.getElementById('tracking-items-list');
  if (itemsContainer && Array.isArray(pedido.lineas)) {
    itemsContainer.innerHTML = pedido.lineas.map(l => `
      <div class="flex justify-between">
        <span>${l.cantidad}x ${l.nombre}</span>
        <strong>${parseFloat(l.subtotal).toFixed(2)} €</strong>
      </div>
    `).join('');
  }

  document.getElementById('tracking-total-val').textContent = `${parseFloat(pedido.total).toFixed(2)} €`;

  const destInfo = document.getElementById('tracking-dest-info');
  if (destInfo) {
    if (pedido.tipo_pedido === 'domicilio') {
      destInfo.innerHTML = `
        <p><strong>Cliente:</strong> ${pedido.cliente_nombre}</p>
        <p><strong>Teléfono:</strong> ${pedido.cliente_telefono || '--'}</p>
        <p><strong>Dirección:</strong> ${pedido.cliente_direccion || '--'}</p>
      `;
    } else if (pedido.tipo_pedido === 'recoger') {
      destInfo.innerHTML = `
        <p><strong>Cliente:</strong> ${pedido.cliente_nombre}</p>
        <p><strong>Teléfono:</strong> ${pedido.cliente_telefono || '--'}</p>
        <p><strong>Recogida:</strong> Mostrador Pizzería</p>
      `;
    } else {
      destInfo.innerHTML = `
        <p><strong>Mesa:</strong> #${pedido.mesa_numero}</p>
        <p><strong>Cliente:</strong> ${pedido.cliente_nombre}</p>
      `;
    }
  }

  const paymentEl = document.getElementById('tracking-payment-val');
  if (paymentEl) {
    if (pedido.metodo_pago === 'stripe') {
      if (pedido.estado_pago === 'pagado') {
        paymentEl.innerHTML = '<span class="text-emerald-500 font-bold">💳 Stripe Online (Pagado)</span>';
      } else {
        paymentEl.innerHTML = `
          <div class="space-y-1.5">
            <span class="text-amber-500 font-bold block">💳 Stripe Online (Pendiente de Pago)</span>
            <button onclick="iniciarStripeParaPedido(${pedido.id})" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow transition-all cursor-pointer flex items-center gap-1.5">
              <span>💳</span> <span>Completar Pago con Tarjeta</span>
            </button>
          </div>
        `;
      }
    } else if (pedido.metodo_pago === 'tarjeta_entrega' || pedido.metodo_pago === 'tarjeta_recogida') {

      paymentEl.textContent = '💳 Datáfono';
    } else if (pedido.metodo_pago === 'pago_mesa') {
      paymentEl.textContent = '🍽️ Pago en Mesa (Cuenta solicitada)';
    } else {
      paymentEl.textContent = '💵 En mano al recibir';
    }
  }
}

function startTrackingPolling() {
  if (state.trackingInterval) clearInterval(state.trackingInterval);
  state.trackingInterval = setInterval(() => {
    if (state.activeTrackingId && state.currentClientView === 'tracking') {
      fetchTrackingData(state.activeTrackingId);
    }
  }, 4000);
}

// ==============================================================================
// COCINA KDS (KANBAN EN TIEMPO REAL CON TAILWIND)
// ==============================================================================
async function loadPedidosKDS() {
  try {
    const res = await fetch(`${API_BASE}/pedidos`);
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      state.pedidos = data.data;
      renderKDSBoard();
      renderCobrosCrudTable();
      renderHistoricoTable();
    }
  } catch (err) {
    console.error('Error al cargar comandas KDS:', err);
  }
}


function renderKDSBoard() {
  const listPendiente = document.getElementById('list-pedidos-pendiente');
  const listPrep = document.getElementById('list-pedidos-preparacion');
  const listListo = document.getElementById('list-pedidos-listo');

  if (!listPendiente) return;

  let pedidosFiltrados = state.pedidos || [];
  if (state.kdsFilter !== 'all') {
    pedidosFiltrados = pedidosFiltrados.filter(p => p.tipo_pedido === state.kdsFilter);
  }

  // Filtro KDS: Los pedidos finalizados y cobrados desaparecen automáticamente del tablero de los cocineros
  if (state.kdsOcultarCobrados) {
    pedidosFiltrados = pedidosFiltrados.filter(p => {
      const isCerradoYCobrado = (p.estado === 'entregado' || p.estado === 'servido') && p.estado_pago === 'pagado';
      return !isCerradoYCobrado && p.estado !== 'cancelado';
    });
  }

  const pendientes = pedidosFiltrados.filter(p => p.estado === 'pendiente');
  const preparacion = pedidosFiltrados.filter(p => p.estado === 'en_preparacion' || p.estado === 'en_reparto');
  const listos = pedidosFiltrados.filter(p => p.estado === 'listo' || p.estado === 'servido' || p.estado === 'entregado');

  document.getElementById('count-pendiente').textContent = pendientes.length;
  document.getElementById('count-preparacion').textContent = preparacion.length;
  document.getElementById('count-listo').textContent = listos.length;
  document.getElementById('badge-cocina-count').textContent = pendientes.length;

  listPendiente.innerHTML = pendientes.map(p => renderKDSCard(p)).join('') || '<p class="text-xs text-slate-400 text-center py-8">Sin comandas pendientes</p>';
  listPrep.innerHTML = preparacion.map(p => renderKDSCard(p)).join('') || '<p class="text-xs text-slate-400 text-center py-8">Horno despejado</p>';
  listListo.innerHTML = listos.map(p => renderKDSCard(p)).join('') || '<p class="text-xs text-slate-400 text-center py-8">No hay pedidos en espera</p>';
}

function renderKDSCard(p) {
  let badgeColor = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
  let badgeText = `🍽️ Mesa ${p.mesa_numero || '--'}`;

  if (p.tipo_pedido === 'domicilio') {
    badgeColor = 'bg-brand-500/10 text-brand-500 border-brand-500/30';
    badgeText = `🛵 Domicilio`;
  } else if (p.tipo_pedido === 'recoger') {
    badgeColor = 'bg-amber-500/10 text-amber-500 border-amber-500/30';
    badgeText = `🥡 Recoger`;
  }

  const lineasHtml = (p.lineas || []).map(l => `
    <div class="flex items-start gap-2 text-xs sm:text-sm">
      <span class="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-bold text-xs">${l.cantidad}x</span>
      <div>
        <strong class="text-slate-900 dark:text-white">${l.nombre}</strong>
        ${l.notas ? `<span class="block text-xs text-amber-500 italic font-medium">"${l.notas}"</span>` : ''}
      </div>
    </div>
  `).join('');

  let actionButtons = '';
  if (p.estado === 'pendiente') {
    actionButtons = `
      <button onclick="updateOrderStatus(${p.id}, 'en_preparacion')" class="w-full py-2 rounded-xl bg-brand-orange hover:bg-orange-600 text-white font-bold text-xs shadow-sm transition-all cursor-pointer">
        🔥 Meter al Horno
      </button>
    `;
  } else if (p.estado === 'en_preparacion') {
    actionButtons = `
      <button onclick="updateOrderStatus(${p.id}, '${p.tipo_pedido === 'domicilio' ? 'en_reparto' : 'listo'}')" class="w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs shadow-sm transition-all cursor-pointer">
        ${p.tipo_pedido === 'domicilio' ? '🛵 A Reparto' : '✅ Marcar Listo'}
      </button>
    `;
  } else if (p.estado === 'en_reparto' || p.estado === 'listo') {
    actionButtons = `
      <button onclick="updateOrderStatus(${p.id}, '${p.tipo_pedido === 'mesa' ? 'servido' : 'entregado'}')" class="w-full py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs shadow-sm transition-all cursor-pointer">
        📦 Entregado / Servido
      </button>
    `;
  }

  // Badge descriptivo de estado del pago
  let pagoBadge = '';
  if (p.metodo_pago === 'stripe') {
    if (p.estado_pago === 'pagado') {
      pagoBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">💳 Stripe: Pagado</span>`;
    } else {
      pagoBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">💳 Stripe: Pendiente</span>`;
    }
  } else if (p.metodo_pago === 'tarjeta_entrega' || p.metodo_pago === 'tarjeta_recogida') {
    pagoBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30">💳 Datáfono</span>`;
  } else if (p.metodo_pago === 'pago_mesa') {
    pagoBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30">🍽️ Pago en Mesa</span>`;
  } else {
    pagoBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/10 text-slate-600 dark:text-slate-300 border border-slate-500/30">💵 Efectivo</span>`;
  }

  return `
    <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 space-y-3 shadow-sm hover:border-slate-400 transition-colors">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${badgeColor} uppercase">${badgeText}</span>
          <strong class="font-bold text-sm">#${p.id}</strong>
          ${pagoBadge}
        </div>
        <span class="text-xs text-slate-400">${formatTime(p.fecha)}</span>
      </div>

      <div class="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
        <strong class="block text-slate-900 dark:text-white text-sm">${p.cliente_nombre || 'Cliente'}</strong>
        ${p.cliente_telefono ? `<span class="text-slate-500 block">📞 Tel: ${p.cliente_telefono}</span>` : ''}
        ${p.cliente_direccion ? `<span class="text-blue-500 dark:text-blue-400 block font-medium mt-0.5">📍 ${p.cliente_direccion}</span>` : ''}
      </div>

      <div class="space-y-1.5 pt-1">
        ${lineasHtml}
      </div>

      ${p.observaciones ? `<div class="p-2 rounded-lg bg-amber-500/10 border-l-2 border-amber-500 text-xs text-amber-600 dark:text-amber-400">💬 ${p.observaciones}</div>` : ''}

      <div class="pt-1 space-y-1.5">
        ${actionButtons}
        <button onclick="openEditarPedidoModal(${p.id})" class="w-full py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-xs border border-blue-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5" title="Ajustar o modificar comanda">
          <span>✏️</span> <span>Ajustar / Modificar Pedido</span>
        </button>
        ${(!p.estado_pago || p.estado_pago === 'pendiente') ? `
          <button onclick="openCobroModal(${p.id})" class="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5">
            <span>💶</span> <span>Cobrar (${parseFloat(p.total).toFixed(2)} €)</span>
          </button>
        ` : `
          <button onclick="openTicketModal(${p.id})" class="w-full py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700/80 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5">
            <span>🧾</span> <span>Ver Ticket Fiscal</span>
          </button>
        `}
      </div>

    </div>
  `;

}

window.updateOrderStatus = async function(orderId, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/pedidos/${orderId}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: newStatus }),
    });

    if (res.ok) {
      showToast(`⚡ Pedido #${orderId} actualizado a "${newStatus}"`, 'success');
      await loadPedidosKDS();
    } else {
      throw new Error('Error al actualizar estado');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
};

function startKdsPolling() {
  if (state.kdsInterval) clearInterval(state.kdsInterval);
  state.kdsInterval = setInterval(() => {
    if (state.userMode !== 'cliente' && (state.activePersonalTab === 'cocina' || state.activePersonalTab === 'cobros' || state.activePersonalTab === 'historico')) {
      loadPedidosKDS();
    }
  }, 5000);
}

// ==============================================================================
// ADMINISTRACIÓN DE PIZZAS (CRUD ADMIN CON TAILWIND)
// ==============================================================================
function renderAdminPizzas() {
  const container = document.getElementById('admin-pizzas-grid');
  if (!container) return;

  container.innerHTML = state.pizzas.map(p => `
    <div class="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col justify-between">
      <div class="h-36 overflow-hidden relative bg-slate-100 dark:bg-slate-800">
        <img src="${p.imagen_url || 'https://images.unsplash.com/photo-1513104890138-7c749659a591'}" class="w-full h-full object-cover">
        <span class="absolute top-2 left-2 px-2.5 py-0.5 rounded-full text-xs font-bold bg-black/60 text-white">
          ${getCategoryName(p.categoria_id)}
        </span>
      </div>
      <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div>
          <h4 class="font-display font-bold text-base text-slate-900 dark:text-white">${p.nombre}</h4>
          <p class="text-xs text-slate-500 line-clamp-2 mt-1">${p.descripcion}</p>
        </div>
        <div class="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
          <strong class="text-lg font-bold">${parseFloat(p.precio).toFixed(2)} €</strong>
          <div class="flex gap-1.5">
            <button class="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs cursor-pointer" onclick="editPizzaModal(${p.id})">✏️</button>
            <button class="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-red-500 hover:text-white text-xs cursor-pointer" onclick="deletePizza(${p.id})">🗑️</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

window.editPizzaModal = function(pizzaId) {
  const pizza = state.pizzas.find(p => p.id === pizzaId);
  if (!pizza) return;

  document.getElementById('pizza-modal-title').textContent = '✏️ Editar Pizza';
  document.getElementById('form-pizza-id').value = pizza.id;
  document.getElementById('form-pizza-nombre').value = pizza.nombre;
  document.getElementById('form-pizza-categoria').value = pizza.categoria_id || '1';
  document.getElementById('form-pizza-precio').value = pizza.precio;
  document.getElementById('form-pizza-imagen').value = pizza.imagen_url || '';
  document.getElementById('form-pizza-desc').value = pizza.descripcion || '';
  document.getElementById('form-pizza-disponible').checked = pizza.disponible !== false;

  document.getElementById('pizza-modal').classList.remove('hidden');
};

window.deletePizza = async function(pizzaId) {
  if (!confirm(`¿Seguro que deseas eliminar la pizza #${pizzaId}?`)) return;

  try {
    const res = await fetch(`${API_BASE}/pizzas/${pizzaId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('🗑️ Pizza eliminada con éxito', 'success');
      await loadPizzas();
      renderAdminPizzas();
    }
  } catch (err) {
    showToast('❌ Error al eliminar pizza', 'error');
  }
};

async function savePizzaForm(e) {
  e.preventDefault();
  const id = document.getElementById('form-pizza-id').value;
  const nombre = document.getElementById('form-pizza-nombre').value.trim();
  const categoria_id = parseInt(document.getElementById('form-pizza-categoria').value, 10);
  const precio = parseFloat(document.getElementById('form-pizza-precio').value);
  const imagen_url = document.getElementById('form-pizza-imagen').value.trim();
  const descripcion = document.getElementById('form-pizza-desc').value.trim();
  const disponible = document.getElementById('form-pizza-disponible').checked;

  const payload = { nombre, categoria_id, precio, imagen_url, descripcion, disponible };

  try {
    let res;
    if (id) {
      res = await fetch(`${API_BASE}/pizzas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(`${API_BASE}/pizzas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (res.ok) {
      showToast(id ? '✅ Pizza actualizada' : '🎉 Nueva pizza añadida', 'success');
      document.getElementById('pizza-modal').classList.add('hidden');
      await loadPizzas();
      renderAdminPizzas();
    } else {
      throw new Error('Error al guardar pizza');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

// ==============================================================================
// GESTIÓN DE SALA & MESAS (QR CODES CON TAILWIND)
// ==============================================================================
async function loadMesas() {
  try {
    const res = await fetch(`${API_BASE}/mesas`);
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      state.mesas = data.data;
      renderMesas();
    }
  } catch (err) {
    console.error('Error al cargar mesas:', err);
  }
}

function renderMesas() {
  const container = document.getElementById('mesas-grid');
  if (!container) return;

  container.innerHTML = state.mesas.map(m => `
    <div class="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
      <div class="flex items-center justify-between">
        <h3 class="font-display font-black text-xl text-slate-900 dark:text-white">Mesa ${m.numero}</h3>
        <span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${m.estado === 'ocupada' ? 'bg-red-500/10 text-red-500 border border-red-500/30' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'}">
          ${m.estado}
        </span>
      </div>
      <p class="text-xs text-slate-500">Capacidad: <strong class="text-slate-800 dark:text-slate-200">${m.capacidad} comensales</strong></p>
      <button class="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer" onclick="showQrModal(${m.numero})">
        📱 Ver Código QR
      </button>
    </div>
  `).join('');
}

window.showQrModal = function(mesaNum) {
  const modal = document.getElementById('qr-modal');
  const title = document.getElementById('modal-qr-title');
  const qrImg = document.getElementById('qr-image');
  const qrInput = document.getElementById('qr-url-input');
  const openLink = document.getElementById('qr-open-link');

  const tableUrl = `${window.location.origin}/?mesa=${mesaNum}`;

  title.textContent = `Código QR - Mesa #${mesaNum}`;
  qrInput.value = tableUrl;
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(tableUrl)}`;
  openLink.href = tableUrl;

  modal.classList.remove('hidden');
};

// ==============================================================================
// TPV MOSTRADOR
// ==============================================================================
function renderPosCatalog() {
  const container = document.getElementById('pos-pizzas-list');
  if (!container) return;

  container.innerHTML = state.pizzas.map(p => `
    <div class="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-brand-500 transition-all cursor-pointer" onclick="addPosItem(${p.id})">
      <strong class="block text-sm text-slate-900 dark:text-white leading-tight">${p.nombre}</strong>
      <div class="text-xs font-bold text-slate-500 mt-1">${parseFloat(p.precio).toFixed(2)} €</div>
    </div>
  `).join('');
}

let posItems = [];
window.addPosItem = function(pizzaId) {
  const pizza = state.pizzas.find(p => p.id === pizzaId);
  if (!pizza) return;

  const existing = posItems.find(i => i.pizza_id === pizzaId);
  if (existing) {
    existing.cantidad += 1;
  } else {
    posItems.push({
      pizza_id: pizza.id,
      nombre: pizza.nombre,
      precio: parseFloat(pizza.precio),
      cantidad: 1,
    });
  }
  renderPosTicket();
};

function renderPosTicket() {
  const container = document.getElementById('pos-ticket-items');
  const totalEl = document.getElementById('pos-total-amount');
  const btnSubmit = document.getElementById('btn-submit-pos');

  if (posItems.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">No has añadido ninguna pizza todavía.</p>`;
    totalEl.textContent = '0.00 €';
    btnSubmit.disabled = true;
    return;
  }

  let total = 0;
  container.innerHTML = posItems.map(item => {
    const sub = item.precio * item.cantidad;
    total += sub;
    return `
      <div class="flex justify-between items-center text-xs">
        <span>${item.cantidad}x ${item.nombre}</span>
        <strong>${sub.toFixed(2)} €</strong>
      </div>
    `;
  }).join('');

  totalEl.textContent = `${total.toFixed(2)} €`;
  btnSubmit.disabled = false;
}

// ==============================================================================
// GESTIÓN DE CAJA & COBROS (PANTALLA CRUD PROFESIONAL)
// ==============================================================================
function renderCobrosCrudTable() {
  const tbody = document.getElementById('crud-cobros-table-body');
  if (!tbody) return;

  const todasPendientes = (state.pedidos || []).filter(p => !p.estado_pago || p.estado_pago === 'pendiente');

  // Cálculos de KPIs
  const totalEur = todasPendientes.reduce((sum, p) => sum + (parseFloat(p.total) || 0), 0);
  const countMesas = todasPendientes.filter(p => p.tipo_pedido === 'mesa').length;
  const countDomicilio = todasPendientes.filter(p => p.tipo_pedido === 'domicilio').length;
  const countRecoger = todasPendientes.filter(p => p.tipo_pedido === 'recoger').length;
  const countDelivery = countDomicilio + countRecoger;

  // Actualizar indicadores KPI
  const kpiTotalEl = document.getElementById('kpi-cobros-total-eur');
  const kpiCountEl = document.getElementById('kpi-cobros-count');
  const kpiMesasEl = document.getElementById('kpi-cobros-mesas');
  const kpiDeliveryEl = document.getElementById('kpi-cobros-delivery');

  if (kpiTotalEl) kpiTotalEl.textContent = `${totalEur.toFixed(2)} €`;
  if (kpiCountEl) kpiCountEl.textContent = todasPendientes.length;
  if (kpiMesasEl) kpiMesasEl.textContent = countMesas;
  if (kpiDeliveryEl) kpiDeliveryEl.textContent = countDelivery;

  // Actualizar contadores de píldoras de filtro
  const countTodasEl = document.getElementById('count-tab-todas');
  const countMesasEl = document.getElementById('count-tab-mesas');
  const countDomEl = document.getElementById('count-tab-domicilio');
  const countRecEl = document.getElementById('count-tab-recoger');
  const badgeNavCobros = document.getElementById('badge-nav-cobros-count');

  if (countTodasEl) countTodasEl.textContent = todasPendientes.length;
  if (countMesasEl) countMesasEl.textContent = countMesas;
  if (countDomEl) countDomEl.textContent = countDomicilio;
  if (countRecEl) countRecEl.textContent = countRecoger;
  if (badgeNavCobros) badgeNavCobros.textContent = todasPendientes.length;

  // Filtrado por canal
  let filtradas = todasPendientes;
  if (state.cobrosFilter && state.cobrosFilter !== 'all') {
    filtradas = filtradas.filter(p => p.tipo_pedido === state.cobrosFilter);
  }

  // Filtrado por búsqueda en tiempo real
  const searchInput = document.getElementById('input-search-crud-cobros');
  const searchVal = (searchInput?.value || '').trim().toLowerCase();
  if (searchVal) {
    filtradas = filtradas.filter(p => {
      const matchId = p.id.toString().includes(searchVal);
      const matchCliente = (p.cliente_nombre || '').toLowerCase().includes(searchVal);
      const matchTel = (p.cliente_telefono || '').includes(searchVal);
      const matchMesa = p.mesa_numero ? p.mesa_numero.toString().includes(searchVal) : false;
      const matchDir = (p.cliente_direccion || '').toLowerCase().includes(searchVal);
      return matchId || matchCliente || matchTel || matchMesa || matchDir;
    });
  }

  // Si no hay comandas para el filtro actual
  if (filtradas.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-12 text-slate-400">
          <span class="text-3xl block mb-2">🎉</span>
          <span class="font-bold text-sm text-slate-700 dark:text-slate-300 block">No hay cuentas pendientes</span>
          <p class="text-xs text-slate-400 mt-1">Todas las comandas para este filtro están cobradas o no coinciden con la búsqueda.</p>
        </td>
      </tr>
    `;
    return;
  }

  // Ordenar: primero las que están listas/servidas/entregadas (listas para cobrar), luego por fecha reciente
  filtradas.sort((a, b) => {
    const listos = ['listo', 'servido', 'entregado'];
    const aListo = listos.includes(a.estado) ? 1 : 0;
    const bListo = listos.includes(b.estado) ? 1 : 0;
    if (aListo !== bListo) return bListo - aListo;
    return new Date(b.fecha) - new Date(a.fecha);
  });

  tbody.innerHTML = filtradas.map(p => {
    // Badge Canal / Mesa
    let canalBadge = '';
    if (p.tipo_pedido === 'mesa') {
      canalBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 whitespace-nowrap">🍽️ Mesa ${p.mesa_numero || '--'}</span>`;
    } else if (p.tipo_pedido === 'domicilio') {
      canalBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-brand-500/10 text-brand-500 border border-brand-500/20 whitespace-nowrap">🛵 Domicilio</span>`;
    } else {
      canalBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 whitespace-nowrap">🥡 Recoger</span>`;
    }

    // Badge Estado Cocina
    let estadoCocinaBadge = '';
    switch (p.estado) {
      case 'pendiente':
        estadoCocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 whitespace-nowrap">⏳ Recibido</span>`;
        break;
      case 'en_preparacion':
        estadoCocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20 whitespace-nowrap">🔥 En Horno</span>`;
        break;
      case 'en_reparto':
        estadoCocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/10 text-purple-500 border border-purple-500/20 whitespace-nowrap">🛵 En Reparto</span>`;
        break;
      case 'listo':
      case 'servido':
        estadoCocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 whitespace-nowrap">✅ Servido / Listo</span>`;
        break;
      case 'entregado':
        estadoCocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-500/10 text-slate-500 border border-slate-500/20 whitespace-nowrap">📦 Entregado</span>`;
        break;
      default:
        estadoCocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300 uppercase">${p.estado}</span>`;
    }

    // Forma de pago prevista
    let metodoPagoStr = '💵 En Efectivo';
    if (p.metodo_pago === 'tarjeta_entrega' || p.metodo_pago === 'tarjeta_recogida') {
      metodoPagoStr = '💳 Datáfono';
    } else if (p.metodo_pago === 'stripe') {
      metodoPagoStr = '💳 Stripe Online';
    } else if (p.metodo_pago === 'pago_mesa') {
      metodoPagoStr = '🍽️ En Mesa';
    }

    // Resumen de productos
    const itemsSummary = (p.lineas && p.lineas.length > 0)
      ? p.lineas.map(l => `${l.cantidad}x ${l.nombre}`).join(', ')
      : (p.observaciones || 'Comanda registrada');

    return `
      <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
        <td class="py-3 px-4">
          <strong class="font-black text-sm text-slate-900 dark:text-white block">#${p.id}</strong>
          <span class="text-[10px] text-slate-400 block">${formatTime(p.fecha)}</span>
        </td>
        <td class="py-3 px-4">
          ${canalBadge}
        </td>
        <td class="py-3 px-4">
          <strong class="font-bold text-slate-800 dark:text-slate-200 block truncate max-w-[140px]">${p.cliente_nombre || 'Cliente'}</strong>
          <span class="text-[11px] text-slate-400 block truncate max-w-[140px]">${p.cliente_telefono || (p.cliente_direccion || 'Presencial')}</span>
        </td>
        <td class="py-3 px-4">
          ${estadoCocinaBadge}
        </td>
        <td class="py-3 px-4">
          <span class="text-[11px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20 inline-block mb-0.5">⏳ Pendiente</span>
          <span class="text-[10px] text-slate-400 block">${metodoPagoStr}</span>
        </td>
        <td class="py-3 px-4 max-w-[200px]">
          <span class="text-xs text-slate-600 dark:text-slate-300 block truncate" title="${itemsSummary}">${itemsSummary}</span>
        </td>
        <td class="py-3 px-4 text-right">
          <strong class="font-display font-black text-base text-brand-500 block">${parseFloat(p.total).toFixed(2)} €</strong>
        </td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openEditarPedidoModal(${p.id})" class="px-2.5 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-xs border border-blue-500/20 transition-all cursor-pointer flex items-center gap-1" title="Ajustar o modificar comanda">
              <span>✏️</span> <span>Modificar</span>
            </button>
            <button onclick="openTicketModal(${p.id})" class="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition-all cursor-pointer flex items-center gap-1" title="Ver e imprimir pre-ticket">
              <span>🧾</span> <span>Pre-Ticket</span>
            </button>
            <button onclick="openCobroModal(${p.id})" class="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1" title="Registrar Cobro">
              <span>💶</span> <span>Cobrar</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

const renderPendingBillsTable = renderCobrosCrudTable;

// ==============================================================================
// GESTIÓN DE MANTENIMIENTO & HISTÓRICO DE PEDIDOS ORGANIZADOS POR FECHAS
// ==============================================================================
function renderHistoricoTable() {
  const tbody = document.getElementById('historico-table-body');
  if (!tbody) return;

  const hoyStr = new Date().toISOString().split('T')[0];
  const ayerDate = new Date();
  ayerDate.setDate(ayerDate.getDate() - 1);
  const ayerStr = ayerDate.toISOString().split('T')[0];

  // Actualizar contador del día de hoy
  const hoyCount = (state.pedidos || []).filter(p => {
    const pFecha = p.fecha ? p.fecha.split('T')[0] : '';
    return pFecha === hoyStr;
  }).length;
  const hoyBadge = document.getElementById('historico-count-hoy');
  if (hoyBadge) hoyBadge.textContent = hoyCount;

  // Filtrar según rango o fecha seleccionada
  let filtradas = [...(state.pedidos || [])];

  if (state.historicoRango === 'hoy') {
    filtradas = filtradas.filter(p => {
      const pFecha = p.fecha ? p.fecha.split('T')[0] : '';
      return pFecha === hoyStr;
    });
  } else if (state.historicoRango === 'ayer') {
    filtradas = filtradas.filter(p => {
      const pFecha = p.fecha ? p.fecha.split('T')[0] : '';
      return pFecha === ayerStr;
    });
  } else if (state.historicoRango === 'semana') {
    const sieteDiasAtras = new Date();
    sieteDiasAtras.setDate(sieteDiasAtras.getDate() - 7);
    filtradas = filtradas.filter(p => {
      const pDate = new Date(p.fecha);
      return pDate >= sieteDiasAtras;
    });
  } else if (state.historicoRango === 'custom') {
    const fechaPickerVal = document.getElementById('historico-date-input')?.value || state.historicoFecha;
    if (fechaPickerVal) {
      filtradas = filtradas.filter(p => {
        const pFecha = p.fecha ? p.fecha.split('T')[0] : '';
        return pFecha === fechaPickerVal;
      });
    }
  }

  // Buscador en tiempo real
  const searchInput = document.getElementById('historico-search-input');
  const searchVal = (searchInput?.value || '').trim().toLowerCase();
  if (searchVal) {
    filtradas = filtradas.filter(p => {
      const matchId = p.id.toString().includes(searchVal);
      const matchCliente = (p.cliente_nombre || '').toLowerCase().includes(searchVal);
      const matchTel = (p.cliente_telefono || '').includes(searchVal);
      const matchMesa = p.mesa_numero ? p.mesa_numero.toString().includes(searchVal) : false;
      const matchDir = (p.cliente_direccion || '').toLowerCase().includes(searchVal);
      return matchId || matchCliente || matchTel || matchMesa || matchDir;
    });
  }

  // Cálculos de KPIs del período seleccionado
  const pedidosPagados = filtradas.filter(p => p.estado_pago === 'pagado');
  const totalFacturado = pedidosPagados.reduce((acc, p) => acc + (parseFloat(p.total) || 0), 0);
  const totalPedidosCerrados = filtradas.filter(p => p.estado === 'entregado' || p.estado === 'servido' || p.estado_pago === 'pagado').length;
  const ticketMedio = totalPedidosCerrados > 0 ? (totalFacturado / totalPedidosCerrados) : 0;

  // Desglose por método de pago
  const totalEfectivo = pedidosPagados
    .filter(p => p.metodo_pago === 'efectivo_entrega' || p.metodo_pago === 'en_mano' || p.metodo_pago === 'efectivo' || !p.metodo_pago)
    .reduce((acc, p) => acc + (parseFloat(p.total) || 0), 0);

  const totalTarjeta = pedidosPagados
    .filter(p => p.metodo_pago === 'tarjeta_entrega' || p.metodo_pago === 'tarjeta_recogida' || p.metodo_pago === 'datafono')
    .reduce((acc, p) => acc + (parseFloat(p.total) || 0), 0);

  const totalStripe = pedidosPagados
    .filter(p => p.metodo_pago === 'stripe')
    .reduce((acc, p) => acc + (parseFloat(p.total) || 0), 0);

  // Actualizar KPIs en el DOM
  const kpiTotal = document.getElementById('kpi-historico-total-eur');
  const kpiCount = document.getElementById('kpi-historico-pedidos-count');
  const kpiTicketMedio = document.getElementById('kpi-historico-ticket-medio');
  const kpiEfectivo = document.getElementById('kpi-historico-efectivo');
  const kpiTarjeta = document.getElementById('kpi-historico-tarjeta');
  const kpiStripe = document.getElementById('kpi-historico-stripe');

  if (kpiTotal) kpiTotal.textContent = `${totalFacturado.toFixed(2)} €`;
  if (kpiCount) kpiCount.textContent = totalPedidosCerrados;
  if (kpiTicketMedio) kpiTicketMedio.textContent = `${ticketMedio.toFixed(2)} €`;
  if (kpiEfectivo) kpiEfectivo.textContent = `${totalEfectivo.toFixed(2)} €`;
  if (kpiTarjeta) kpiTarjeta.textContent = `${totalTarjeta.toFixed(2)} €`;
  if (kpiStripe) kpiStripe.textContent = `${totalStripe.toFixed(2)} €`;

  if (filtradas.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-12 text-slate-400">
          <span class="text-3xl block mb-2">📅</span>
          <span class="font-bold text-sm text-slate-700 dark:text-slate-300 block">No hay pedidos registrados en este período</span>
          <p class="text-xs text-slate-400 mt-1">Prueba seleccionando otra fecha o "Todos".</p>
        </td>
      </tr>
    `;
    return;
  }

  // Ordenar por fecha más reciente primero
  filtradas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  tbody.innerHTML = filtradas.map(p => {
    // Formateo de fecha y hora
    const d = new Date(p.fecha);
    const fechaFormat = d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
    const horaFormat = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Canal
    let canalBadge = '';
    if (p.tipo_pedido === 'mesa') {
      canalBadge = `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 whitespace-nowrap">🍽️ Mesa ${p.mesa_numero || '--'}</span>`;
    } else if (p.tipo_pedido === 'domicilio') {
      canalBadge = `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-brand-500/10 text-brand-500 border border-brand-500/20 whitespace-nowrap">🛵 Domicilio</span>`;
    } else {
      canalBadge = `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 whitespace-nowrap">🥡 Recoger</span>`;
    }

    // Estado Cocina
    let cocinaBadge = '';
    switch (p.estado) {
      case 'entregado':
      case 'servido':
        cocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">✅ Servido</span>`;
        break;
      case 'listo':
        cocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20">📦 Listo</span>`;
        break;
      case 'en_preparacion':
      case 'en_reparto':
        cocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/10 text-purple-500 border border-purple-500/20">🔥 En Curso</span>`;
        break;
      case 'pendiente':
        cocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">⏳ Recibido</span>`;
        break;
      default:
        cocinaBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300 uppercase">${p.estado}</span>`;
    }

    // Estado Pago
    let pagoBadge = '';
    let metodoStr = '💵 Efectivo';
    if (p.metodo_pago === 'tarjeta_entrega' || p.metodo_pago === 'tarjeta_recogida' || p.metodo_pago === 'datafono') {
      metodoStr = '💳 Datáfono';
    } else if (p.metodo_pago === 'stripe') {
      metodoStr = '💳 Stripe Online';
    }

    if (p.estado_pago === 'pagado') {
      pagoBadge = `
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 inline-block">✅ Pagado</span>
        <span class="text-[10px] text-slate-400 block mt-0.5">${metodoStr}</span>
      `;
    } else {
      pagoBadge = `
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 inline-block">⏳ Pendiente</span>
        <span class="text-[10px] text-slate-400 block mt-0.5">${metodoStr}</span>
      `;
    }

    const itemsSummary = (p.lineas && p.lineas.length > 0)
      ? p.lineas.map(l => `${l.cantidad}x ${l.nombre}`).join(', ')
      : (p.observaciones || 'Comanda registrada');

    return `
      <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
        <td class="py-3 px-4">
          <strong class="font-black text-sm text-slate-900 dark:text-white block">#${p.id}</strong>
          <span class="text-[10px] text-slate-400 block">${fechaFormat} • ${horaFormat}</span>
        </td>
        <td class="py-3 px-4">
          ${canalBadge}
        </td>
        <td class="py-3 px-4">
          <strong class="font-bold text-slate-800 dark:text-slate-200 block truncate max-w-[130px]">${p.cliente_nombre || 'Cliente'}</strong>
          <span class="text-[11px] text-slate-400 block truncate max-w-[130px]">${p.cliente_telefono || (p.cliente_direccion || 'Presencial')}</span>
        </td>
        <td class="py-3 px-4 max-w-[180px]">
          <span class="text-xs text-slate-600 dark:text-slate-300 block truncate" title="${itemsSummary}">${itemsSummary}</span>
        </td>
        <td class="py-3 px-4">
          ${cocinaBadge}
        </td>
        <td class="py-3 px-4">
          ${pagoBadge}
        </td>
        <td class="py-3 px-4 text-right">
          <strong class="font-display font-black text-base text-slate-900 dark:text-white block">${parseFloat(p.total).toFixed(2)} €</strong>
        </td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center gap-1">
            <button onclick="openEditarPedidoModal(${p.id})" class="px-2 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-xs border border-blue-500/20 transition-all cursor-pointer flex items-center gap-1" title="Ajustar o modificar comanda">
              <span>✏️</span> <span>Modificar</span>
            </button>
            <button onclick="openTicketModal(${p.id})" class="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition-all cursor-pointer flex items-center gap-1" title="Ver / Imprimir Ticket Fiscal">
              <span>🧾</span> <span>Ticket</span>
            </button>
            ${p.estado_pago !== 'pagado' ? `
              <button onclick="openCobroModal(${p.id})" class="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center gap-1" title="Cobrar ahora">
                <span>💶</span> <span>Cobrar</span>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function imprimirArqueoDiario() {
  const hoyStr = new Date().toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
  const totalFacturado = document.getElementById('kpi-historico-total-eur')?.textContent || '0.00 €';
  const pedidosCount = document.getElementById('kpi-historico-pedidos-count')?.textContent || '0';
  const efec = document.getElementById('kpi-historico-efectivo')?.textContent || '0.00 €';
  const tarj = document.getElementById('kpi-historico-tarjeta')?.textContent || '0.00 €';
  const strp = document.getElementById('kpi-historico-stripe')?.textContent || '0.00 €';

  const ticketContent = `
========================================
       PIZZERÍA BELLA NAPOLI
    INFORME DE CIERRE DE CAJA / ARQUEO
========================================
Fecha Informe: ${hoyStr}
Hora Emisión:  ${new Date().toLocaleTimeString()}
Responsable:   Turno Activo (${state.userMode.toUpperCase()})
----------------------------------------
Comandas Cerradas:      ${pedidosCount}
TOTAL FACTURADO:        ${totalFacturado}
----------------------------------------
DESGLOSE POR MODALIDAD DE COBRO:
  - Efectivo en Cajón:  ${efec}
  - Datáfono / TPV:     ${tarj}
  - Stripe Online:      ${strp}
========================================
      Firma Responsable de Turno:


________________________________________
`;

  const printWindow = window.open('', '', 'width=450,height=650');
  if (printWindow) {
    printWindow.document.write(`<pre style="font-family: monospace; font-size: 13px; line-height: 1.4; padding: 20px;">${ticketContent}</pre>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  } else {
    alert(ticketContent);
  }
}

// ==============================================================================
// GESTIÓN DE MODIFICACIÓN / AJUSTE DE COMANDA (CRUD DE PEDIDOS)
// ==============================================================================
window.openEditarPedidoModal = async function(orderId) {
  let order = (state.pedidos || []).find(p => p.id === orderId);
  if (!order || !order.lineas) {
    try {
      const res = await fetch(`${API_BASE}/pedidos/${orderId}`);
      const data = await res.json();
      if (res.ok && data.success) {
        order = data.data;
      }
    } catch (err) {
      console.error('Error al cargar pedido para edición:', err);
    }
  }

  if (!order) {
    showToast(`⚠️ No se encontró el pedido #${orderId}`, 'error');
    return;
  }

  // Clonar en estado de edición
  state.editingOrder = {
    ...order,
    lineas: Array.isArray(order.lineas) ? JSON.parse(JSON.stringify(order.lineas)) : []
  };

  const idEl = document.getElementById('edit-pedido-id');
  if (idEl) idEl.textContent = order.id;
  
  // Set tipo
  const tipoSelect = document.getElementById('edit-pedido-tipo');
  if (tipoSelect) {
    tipoSelect.value = order.tipo_pedido || 'mesa';
    updateEditTipoVisibility(tipoSelect.value);
  }

  // Set mesa
  const mesaSelect = document.getElementById('edit-pedido-mesa');
  if (mesaSelect) {
    mesaSelect.value = order.mesa_numero ? order.mesa_numero.toString() : '';
  }

  // Set estado
  const estadoSelect = document.getElementById('edit-pedido-estado');
  if (estadoSelect) {
    estadoSelect.value = order.estado || 'pendiente';
  }

  // Set cliente info
  const nombreInput = document.getElementById('edit-pedido-nombre');
  if (nombreInput) nombreInput.value = order.cliente_nombre || '';

  const telInput = document.getElementById('edit-pedido-telefono');
  if (telInput) telInput.value = order.cliente_telefono || '';

  const dirInput = document.getElementById('edit-pedido-direccion');
  if (dirInput) dirInput.value = order.cliente_direccion || '';

  const obsInput = document.getElementById('edit-pedido-observaciones');
  if (obsInput) obsInput.value = order.observaciones || '';

  // Descuento / Ajuste
  const descInput = document.getElementById('edit-input-descuento');
  if (descInput) {
    const subtotal = (state.editingOrder.lineas || []).reduce((s, l) => s + (parseFloat(l.precio_unitario) || 0) * (parseInt(l.cantidad, 10) || 1), 0);
    const orderTotal = parseFloat(order.total) || 0;
    const diff = subtotal - orderTotal;
    descInput.value = diff > 0.05 ? diff.toFixed(2) : '0.00';
  }

  // Rellenar selector de pizzas
  populateEditPizzaSelect();

  // Renderizar líneas
  renderEditComandaLines();

  // Mostrar modal
  document.getElementById('modal-editar-pedido')?.classList.remove('hidden');
};

function updateEditTipoVisibility(tipo) {
  const groupMesa = document.getElementById('edit-group-mesa');
  const groupDir = document.getElementById('edit-group-direccion');
  if (groupMesa) groupMesa.style.display = tipo === 'mesa' ? 'block' : 'none';
  if (groupDir) groupDir.style.display = tipo === 'domicilio' ? 'block' : 'none';
}

function populateEditPizzaSelect() {
  const select = document.getElementById('edit-select-pizza');
  if (!select) return;

  const pizzas = (state.pizzas && state.pizzas.length > 0) ? state.pizzas : [];
  if (pizzas.length === 0) {
    select.innerHTML = '<option value="">No hay pizzas cargadas</option>';
    return;
  }

  select.innerHTML = pizzas.map(p => `
    <option value="${p.id}">${p.nombre} (${parseFloat(p.precio).toFixed(2)} €)</option>
  `).join('');
}

window.renderEditComandaLines = function() {
  const container = document.getElementById('edit-pedido-lineas-list');
  const countBadge = document.getElementById('edit-badge-items-count');
  if (!container || !state.editingOrder) return;

  const lineas = state.editingOrder.lineas || [];
  const totalItems = lineas.reduce((s, l) => s + (parseInt(l.cantidad, 10) || 1), 0);
  if (countBadge) countBadge.textContent = `${totalItems} pizza(s)`;

  if (lineas.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-slate-400 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
        <span class="text-2xl block mb-1">🍕</span>
        <span class="font-bold text-xs text-slate-600 dark:text-slate-300">La comanda no tiene pizzas</span>
        <p class="text-[11px] text-slate-400">Selecciona una pizza arriba y pulsa "➕ Añadir"</p>
      </div>
    `;
    recalcEditComanda();
    return;
  }

  container.innerHTML = lineas.map((linea, index) => {
    const subtotal = ((parseFloat(linea.precio_unitario) || 0) * (parseInt(linea.cantidad, 10) || 1)).toFixed(2);
    return `
      <div class="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <span class="text-lg">🍕</span>
            <div class="truncate">
              <strong class="font-bold text-slate-800 dark:text-slate-100 block text-xs truncate">${linea.nombre || 'Pizza'}</strong>
              <span class="text-[11px] text-slate-400">${parseFloat(linea.precio_unitario).toFixed(2)} € / ud.</span>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <div class="flex items-center border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-800">
              <button type="button" onclick="editPedidoChangeQty(${index}, -1)" class="w-7 h-7 flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs cursor-pointer">-</button>
              <span class="w-8 text-center text-xs font-black text-slate-900 dark:text-white">${linea.cantidad}</span>
              <button type="button" onclick="editPedidoChangeQty(${index}, 1)" class="w-7 h-7 flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs cursor-pointer">+</button>
            </div>
            
            <strong class="w-16 text-right font-display font-black text-xs text-brand-500">${subtotal} €</strong>

            <button type="button" onclick="editPedidoRemoveLine(${index})" class="w-7 h-7 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 flex items-center justify-center text-xs cursor-pointer transition-all" title="Eliminar de comanda">
              🗑️
            </button>
          </div>
        </div>

        <div>
          <input type="text" value="${linea.notas || ''}" onchange="editPedidoChangeNotes(${index}, this.value)" placeholder="Nota específica para esta pizza (ej: sin queso, al punto...)" class="w-full text-[11px] p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none">
        </div>
      </div>
    `;
  }).join('');

  recalcEditComanda();
};

window.editPedidoAddPizza = function() {
  if (!state.editingOrder) return;
  const select = document.getElementById('edit-select-pizza');
  const cantInput = document.getElementById('edit-input-nueva-cant');
  const pizzaId = parseInt(select?.value, 10);
  const cantidad = Math.max(1, parseInt(cantInput?.value, 10) || 1);

  if (!pizzaId) {
    showToast('⚠️ Selecciona una pizza válida', 'warning');
    return;
  }

  const pz = (state.pizzas || []).find(p => p.id === pizzaId);
  if (!pz) {
    showToast('⚠️ Pizza no encontrada en catálogo', 'error');
    return;
  }

  if (!state.editingOrder.lineas) {
    state.editingOrder.lineas = [];
  }

  const existing = state.editingOrder.lineas.find(l => l.pizza_id === pz.id && (!l.notas || l.notas.trim() === ''));
  if (existing) {
    existing.cantidad = (parseInt(existing.cantidad, 10) || 1) + cantidad;
  } else {
    state.editingOrder.lineas.push({
      pizza_id: pz.id,
      nombre: pz.nombre,
      cantidad: cantidad,
      precio_unitario: parseFloat(pz.precio),
      notas: ''
    });
  }

  if (cantInput) cantInput.value = 1;
  renderEditComandaLines();
  showToast(`➕ Añadida "${pz.nombre}" a la comanda`, 'success');
};

window.editPedidoChangeQty = function(index, delta) {
  if (!state.editingOrder || !state.editingOrder.lineas) return;
  const linea = state.editingOrder.lineas[index];
  if (!linea) return;

  const nuevaCant = (parseInt(linea.cantidad, 10) || 1) + delta;
  if (nuevaCant <= 0) {
    state.editingOrder.lineas.splice(index, 1);
  } else {
    linea.cantidad = nuevaCant;
  }
  renderEditComandaLines();
};

window.editPedidoRemoveLine = function(index) {
  if (!state.editingOrder || !state.editingOrder.lineas) return;
  state.editingOrder.lineas.splice(index, 1);
  renderEditComandaLines();
};

window.editPedidoChangeNotes = function(index, notes) {
  if (!state.editingOrder || !state.editingOrder.lineas) return;
  const linea = state.editingOrder.lineas[index];
  if (linea) {
    linea.notas = notes;
  }
};

window.recalcEditComanda = function() {
  if (!state.editingOrder) return;
  const lineas = state.editingOrder.lineas || [];
  const subtotal = lineas.reduce((s, l) => s + (parseFloat(l.precio_unitario) || 0) * (parseInt(l.cantidad, 10) || 1), 0);
  
  const descInput = document.getElementById('edit-input-descuento');
  const descuento = Math.max(0, parseFloat(descInput?.value) || 0);

  const total = Math.max(0, subtotal - descuento);

  const subtotalEl = document.getElementById('edit-calc-subtotal');
  const totalEl = document.getElementById('edit-calc-total');

  if (subtotalEl) subtotalEl.textContent = `${subtotal.toFixed(2)} €`;
  if (totalEl) totalEl.textContent = `${total.toFixed(2)} €`;
};

window.guardarEdicionPedido = async function(andCobrar) {
  if (!state.editingOrder) return;
  const orderId = state.editingOrder.id;

  const tipo = document.getElementById('edit-pedido-tipo')?.value || 'mesa';
  const mesaVal = document.getElementById('edit-pedido-mesa')?.value;
  const estado = document.getElementById('edit-pedido-estado')?.value || 'pendiente';
  const nombre = (document.getElementById('edit-pedido-nombre')?.value || '').trim();
  const telefono = (document.getElementById('edit-pedido-telefono')?.value || '').trim();
  const direccion = (document.getElementById('edit-pedido-direccion')?.value || '').trim();
  const observaciones = (document.getElementById('edit-pedido-observaciones')?.value || '').trim();
  const descuento = Math.max(0, parseFloat(document.getElementById('edit-input-descuento')?.value) || 0);

  const lineas = state.editingOrder.lineas || [];
  if (lineas.length === 0) {
    showToast('⚠️ La comanda debe tener al menos una pizza', 'warning');
    return;
  }

  if (tipo === 'recoger' && (!nombre || !telefono)) {
    showToast('⚠️ Para pedidos a recoger se requiere nombre y teléfono', 'warning');
    return;
  }

  if (tipo === 'domicilio' && (!nombre || !telefono || !direccion)) {
    showToast('⚠️ Para pedidos a domicilio se requiere nombre, teléfono y dirección', 'warning');
    return;
  }

  const subtotal = lineas.reduce((s, l) => s + (parseFloat(l.precio_unitario) || 0) * (parseInt(l.cantidad, 10) || 1), 0);
  const totalFinal = Math.max(0, subtotal - descuento);

  const payload = {
    tipo_pedido: tipo,
    mesa_numero: tipo === 'mesa' ? (parseInt(mesaVal, 10) || null) : null,
    estado: estado,
    cliente_nombre: nombre || (tipo === 'mesa' ? `Cliente Mesa ${mesaVal || '--'}` : 'Cliente Mostrador'),
    cliente_telefono: telefono || null,
    cliente_direccion: direccion || null,
    observaciones: observaciones || null,
    descuento: descuento,
    total: totalFinal,
    lineas: lineas.map(l => ({
      pizza_id: l.pizza_id,
      cantidad: parseInt(l.cantidad, 10) || 1,
      precio_unitario: parseFloat(l.precio_unitario),
      notas: l.notas || null
    }))
  };

  try {
    showToast(`⏳ Guardando cambios en comanda #${orderId}...`, 'info');
    const res = await fetch(`${API_BASE}/pedidos/${orderId}/comanda`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Error al guardar la comanda');
    }

    showToast(`✅ Comanda #${orderId} actualizada correctamente`, 'success');
    document.getElementById('modal-editar-pedido')?.classList.add('hidden');

    // Recargar datos en cocina, mostrador y cobros
    await loadPedidosKDS();
    if (typeof loadMesas === 'function') {
      await loadMesas();
    }

    // Si pulsó "Guardar & Cobrar", abrir inmediatamente el modal de cobro
    if (andCobrar) {
      setTimeout(() => {
        openCobroModal(orderId);
      }, 200);
    }
  } catch (err) {
    console.error('Error al guardar pedido editado:', err);
    showToast(`❌ ${err.message}`, 'error');
  }
};

window.openCobroModal = async function(orderId) {
  let order = (state.pedidos || []).find(p => p.id === orderId);
  if (!order || !order.lineas) {
    try {
      const res = await fetch(`${API_BASE}/pedidos/${orderId}`);
      const data = await res.json();
      if (res.ok && data.success) {
        order = data.data;
      }
    } catch (err) {
      console.error('Error al cargar pedido para cobro:', err);
    }
  }

  if (!order) {
    showToast(`⚠️ No se encontró el pedido #${orderId}`, 'error');
    return;
  }

  state.cobroModalOrder = order;

  document.getElementById('cobro-order-id').textContent = order.id;
  document.getElementById('cobro-order-cliente').textContent = order.cliente_nombre || 'Cliente';
  document.getElementById('cobro-order-total').textContent = `${parseFloat(order.total).toFixed(2)} €`;

  const tipoBadge = document.getElementById('cobro-order-tipo');
  if (order.tipo_pedido === 'domicilio') {
    tipoBadge.textContent = '🛵 Domicilio';
    tipoBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand-500/10 text-brand-500 uppercase border border-brand-500/30';
  } else if (order.tipo_pedido === 'recoger') {
    tipoBadge.textContent = '🥡 Para Recoger';
    tipoBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 uppercase border border-amber-500/30';
  } else {
    tipoBadge.textContent = `🍽️ Mesa ${order.mesa_numero || '--'}`;
    tipoBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-500 uppercase border border-emerald-500/30';
  }

  const itemsCount = (order.lineas || []).reduce((acc, i) => acc + (parseInt(i.cantidad, 10) || 1), 0);
  document.getElementById('cobro-order-items-summary').textContent = `${itemsCount} pizza(s) en la comanda`;

  // Pre-seleccionar método
  let methodToSelect = 'efectivo_entrega';
  if (order.metodo_pago === 'stripe') {
    methodToSelect = 'stripe';
  } else if (order.metodo_pago === 'tarjeta_entrega' || order.metodo_pago === 'tarjeta_recogida') {
    methodToSelect = 'tarjeta_entrega';
  }

  const radio = document.querySelector(`input[name="cobro-method"][value="${methodToSelect}"]`);
  if (radio) radio.checked = true;

  updateCobroMethodPanels();

  // Inicializar importe en efectivo con importe exacto
  const inputEntregado = document.getElementById('input-importe-entregado');
  if (inputEntregado) {
    inputEntregado.value = parseFloat(order.total).toFixed(2);
  }
  updateCambioCalculator();

  document.getElementById('modal-cobro').classList.remove('hidden');
};

function updateCobroMethodPanels() {
  const method = document.querySelector('input[name="cobro-method"]:checked')?.value || 'efectivo_entrega';
  document.getElementById('panel-cobro-efectivo')?.classList.toggle('hidden', method !== 'efectivo_entrega');
  document.getElementById('panel-cobro-datafono')?.classList.toggle('hidden', method !== 'tarjeta_entrega');
  document.getElementById('panel-cobro-stripe')?.classList.toggle('hidden', method !== 'stripe');
}

function updateCambioCalculator() {
  if (!state.cobroModalOrder) return;

  const total = parseFloat(state.cobroModalOrder.total) || 0;
  const input = document.getElementById('input-importe-entregado');
  const entregado = parseFloat(input?.value) || 0;
  const cambio = entregado - total;

  const box = document.getElementById('box-cambio-info');
  const val = document.getElementById('val-cambio-devolver');

  if (cambio >= 0) {
    box.className = 'p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-between transition-all';
    box.querySelector('span').textContent = 'Cambio a Devolver:';
    val.textContent = `${cambio.toFixed(2)} €`;
  } else {
    box.className = 'p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 flex items-center justify-between transition-all';
    box.querySelector('span').textContent = 'Falta por Abonar:';
    val.textContent = `${Math.abs(cambio).toFixed(2)} €`;
  }
}

async function confirmarCobroModal() {
  const order = state.cobroModalOrder;
  if (!order) return;

  const method = document.querySelector('input[name="cobro-method"]:checked')?.value || 'efectivo_entrega';
  const total = parseFloat(order.total) || 0;
  let entregado = total;
  let cambio = 0;

  if (method === 'efectivo_entrega') {
    entregado = parseFloat(document.getElementById('input-importe-entregado').value) || 0;
    if (entregado < total) {
      if (!confirm(`⚠️ El importe entregado (${entregado.toFixed(2)} €) es inferior al total (${total.toFixed(2)} €).\n\n¿Deseas registrar el cobro de todos modos?`)) {
        return;
      }
    }
    cambio = Math.max(0, entregado - total);
  }

  const btnConfirmar = document.getElementById('btn-confirmar-cobro');
  btnConfirmar.disabled = true;
  btnConfirmar.innerHTML = '<span>⏳</span> <span>Registrando Cobro...</span>';

  try {
    const res = await fetch(`${API_BASE}/pedidos/${order.id}/cobro`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metodo_pago: method,
        importe_entregado: entregado,
        cambio: cambio,
      }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      showToast(`🎉 ¡Cobro del Pedido #${order.id} registrado con éxito!`, 'success');
      document.getElementById('modal-cobro').classList.add('hidden');

      // Actualizar pedido en estado local
      order.estado_pago = 'pagado';
      order.metodo_pago = method;

      await loadPedidosKDS();
      renderPendingBillsTable();

      // Abrir automáticamente el ticket fiscal
      openTicketModal(order.id, data);
    } else {
      throw new Error(data.message || 'Error al registrar el cobro');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btnConfirmar.disabled = false;
    btnConfirmar.innerHTML = '<span>✅</span> <span>Confirmar Cobro & Emitir Ticket</span>';
  }
}

window.openTicketModal = async function(orderId, cobroResponseData) {
  let order = null;
  let detalles = null;

  if (cobroResponseData && cobroResponseData.data) {
    order = cobroResponseData.data;
    detalles = cobroResponseData.detalles_cobro;
  } else {
    order = (state.pedidos || []).find(p => p.id === orderId);
    if (!order || !order.lineas) {
      try {
        const res = await fetch(`${API_BASE}/pedidos/${orderId}`);
        const data = await res.json();
        if (res.ok && data.success) {
          order = data.data;
        }
      } catch (err) {
        console.error('Error al obtener datos del ticket:', err);
      }
    }
  }

  if (!order) {
    showToast(`⚠️ No se pudo generar el ticket para el pedido #${orderId}`, 'error');
    return;
  }

  const total = parseFloat(order.total) || 0;
  const baseImp = total / 1.10;
  const iva = total - baseImp;

  document.getElementById('ticket-num').textContent = `FAC-2026-${order.id.toString().padStart(4, '0')}`;
  document.getElementById('ticket-fecha').textContent = new Date().toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const tipoStr = order.tipo_pedido === 'mesa' ? `Mesa #${order.mesa_numero || '--'}` : (order.tipo_pedido === 'domicilio' ? 'A Domicilio' : 'Para Recoger');
  document.getElementById('ticket-tipo').textContent = tipoStr;
  document.getElementById('ticket-cliente').textContent = order.cliente_nombre || 'Cliente Contado';

  const itemsList = document.getElementById('ticket-items-list');
  if (itemsList) {
    itemsList.innerHTML = (order.lineas || []).map(l => {
      const cant = parseInt(l.cantidad, 10) || 1;
      const pu = parseFloat(l.precio_unitario || (l.subtotal / cant) || 0);
      const sub = pu * cant;
      return `
        <div class="grid grid-cols-12 py-0.5">
          <span class="col-span-2 font-bold">${cant}x</span>
          <span class="col-span-6 truncate">${l.nombre || 'Pizza'}</span>
          <span class="col-span-4 text-right font-bold">${sub.toFixed(2)} €</span>
        </div>
      `;
    }).join('') || '<div class="text-center py-2 text-slate-500">Pizzas seleccionadas</div>';
  }

  document.getElementById('ticket-base-imp').textContent = `${baseImp.toFixed(2)} €`;
  document.getElementById('ticket-iva-val').textContent = `${iva.toFixed(2)} €`;
  document.getElementById('ticket-total-val').textContent = `${total.toFixed(2)} €`;

  const metodoStr = (order.metodo_pago === 'stripe') ? 'STRIPE ONLINE' : ((order.metodo_pago === 'tarjeta_entrega' || order.metodo_pago === 'tarjeta_recogida') ? 'DATÁFONO BANCARIO' : 'EFECTIVO');
  document.getElementById('ticket-metodo-val').textContent = metodoStr;

  const cashDetails = document.getElementById('ticket-cash-details');
  if (detalles && order.metodo_pago === 'efectivo_entrega') {
    cashDetails?.classList.remove('hidden');
    document.getElementById('ticket-entregado-val').textContent = `${parseFloat(detalles.importe_entregado).toFixed(2)} €`;
    document.getElementById('ticket-cambio-val').textContent = `${parseFloat(detalles.cambio).toFixed(2)} €`;
  } else {
    cashDetails?.classList.add('hidden');
  }

  document.getElementById('modal-ticket').classList.remove('hidden');
};

window.iniciarStripeParaPedido = async function(orderId) {
  try {
    showToast('🔄 Conectando con Stripe Checkout...', 'info');
    const res = await fetch(`${API_BASE}/pagos/crear-sesion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido_id: orderId }),
    });

    const data = await res.json();
    if (res.ok && data.success && data.url) {
      window.location.href = data.url;
    } else {
      showToast(`⚠️ ${data.message || 'No se pudo iniciar sesión de Stripe.'}`, 'warning');
    }
  } catch (err) {
    showToast(`❌ Error al conectar con Stripe: ${err.message}`, 'error');
  }
};

// ==============================================================================
// HELPERS Y EVENT LISTENERS
// ==============================================================================
function initEventListeners() {

  document.getElementById('brand-logo')?.addEventListener('click', () => {
    if (state.userMode === 'cliente') switchClientView('landing');
  });

  document.querySelectorAll('#nav-cliente .nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchClientView(tab.dataset.view));
  });

  document.querySelectorAll('#nav-personal .nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchPersonalTab(tab.dataset.tab));
  });

  document.getElementById('btn-hero-domicilio')?.addEventListener('click', () => {
    switchClientView('menu');
    const r = document.querySelector('input[name="order-type"][value="domicilio"]');
    if (r) { r.checked = true; updateOrderModeUI(); }
  });

  document.getElementById('btn-hero-recoger')?.addEventListener('click', () => {
    switchClientView('menu');
    const r = document.querySelector('input[name="order-type"][value="recoger"]');
    if (r) { r.checked = true; updateOrderModeUI(); }
  });

  document.getElementById('btn-ver-todas-landing')?.addEventListener('click', () => switchClientView('menu'));

  document.querySelectorAll('input[name="order-type"]').forEach(radio => {
    radio.addEventListener('change', updateOrderModeUI);
  });

  document.querySelectorAll('#client-cat-filters .pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#client-cat-filters .pill-btn').forEach(b => {
        b.className = 'pill-btn px-4 py-2 rounded-full text-xs sm:text-sm font-bold bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-slate-400 whitespace-nowrap cursor-pointer transition-all';
      });
      btn.className = 'pill-btn active px-4 py-2 rounded-full text-xs sm:text-sm font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900 border border-slate-900 dark:border-white whitespace-nowrap cursor-pointer transition-all';
      renderClientPizzas(btn.dataset.cat, document.getElementById('input-search-pizzas').value);
    });
  });

  document.getElementById('input-search-pizzas')?.addEventListener('input', (e) => {
    const activeCat = document.querySelector('#client-cat-filters .pill-btn.active')?.dataset.cat || 'all';
    renderClientPizzas(activeCat, e.target.value);
  });

  document.getElementById('btn-header-cart')?.addEventListener('click', openCartDrawer);
  document.getElementById('btn-close-cart')?.addEventListener('click', closeCartDrawer);
  document.getElementById('btn-submit-order')?.addEventListener('click', submitClientOrder);

  document.getElementById('btn-staff-auth')?.addEventListener('click', openStaffModal);
  document.getElementById('btn-footer-staff')?.addEventListener('click', openStaffModal);
  document.getElementById('btn-close-staff-modal')?.addEventListener('click', closeStaffModal);
  document.getElementById('btn-logout-staff')?.addEventListener('click', logoutStaff);

  // Footer Links
  document.getElementById('footer-link-menu')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchClientView('menu');
  });
  document.getElementById('footer-link-domicilio')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchClientView('menu');
    const r = document.querySelector('input[name="order-type"][value="domicilio"]');
    if (r) { r.checked = true; updateOrderModeUI(); }
  });
  document.getElementById('footer-link-recoger')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchClientView('menu');
    const r = document.querySelector('input[name="order-type"][value="recoger"]');
    if (r) { r.checked = true; updateOrderModeUI(); }
  });
  document.getElementById('footer-link-tracking')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchClientView('tracking');
  });

  // Keypad
  document.querySelectorAll('.key-btn[data-val]').forEach(btn => {
    btn.addEventListener('click', () => handlePinInput(btn.dataset.val));
  });

  document.getElementById('btn-pin-clear')?.addEventListener('click', () => {
    state.currentPin = '';
    document.getElementById('staff-pin-input').value = '';
  });

  document.getElementById('btn-pin-enter')?.addEventListener('click', () => {
    if (state.currentPin.length === 4) verifyStaffPin(state.currentPin);
  });

  document.getElementById('btn-demo-cocina')?.addEventListener('click', () => loginStaff('cocinero'));
  document.getElementById('btn-demo-admin')?.addEventListener('click', () => loginStaff('admin'));

  document.getElementById('btn-open-new-pizza')?.addEventListener('click', () => {
    document.getElementById('pizza-form').reset();
    document.getElementById('form-pizza-id').value = '';
    document.getElementById('pizza-modal-title').textContent = '🍕 Añadir Nueva Pizza';
    document.getElementById('pizza-modal').classList.remove('hidden');
  });

  document.getElementById('btn-close-pizza-modal')?.addEventListener('click', () => {
    document.getElementById('pizza-modal').classList.add('hidden');
  });

  document.getElementById('btn-cancel-pizza-modal')?.addEventListener('click', () => {
    document.getElementById('pizza-modal').classList.add('hidden');
  });

  // Menú Hamburguesa Móvil
  const btnMobileMenu = document.getElementById('btn-mobile-menu');
  const mobileMenuDropdown = document.getElementById('mobile-menu-dropdown');
  const hamburgerIcon = document.getElementById('hamburger-icon');

  btnMobileMenu?.addEventListener('click', () => {
    const isHidden = mobileMenuDropdown.classList.contains('hidden');
    mobileMenuDropdown.classList.toggle('hidden', !isHidden);
    if (hamburgerIcon) hamburgerIcon.textContent = isHidden ? '✕' : '☰';
  });

  document.querySelectorAll('.mobile-nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchClientView(tab.dataset.view);
      mobileMenuDropdown?.classList.add('hidden');
      if (hamburgerIcon) hamburgerIcon.textContent = '☰';
    });
  });

  document.querySelectorAll('.mobile-personal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchPersonalTab(tab.dataset.tab);
      mobileMenuDropdown?.classList.add('hidden');
      if (hamburgerIcon) hamburgerIcon.textContent = '☰';
    });
  });

  document.getElementById('btn-mobile-staff-auth')?.addEventListener('click', () => {
    mobileMenuDropdown?.classList.add('hidden');
    if (hamburgerIcon) hamburgerIcon.textContent = '☰';
    openStaffModal();
  });

  document.getElementById('pizza-form')?.addEventListener('submit', savePizzaForm);

  document.getElementById('btn-close-qr-modal')?.addEventListener('click', () => {
    document.getElementById('qr-modal').classList.add('hidden');
  });

  document.getElementById('btn-tracking-back-menu')?.addEventListener('click', () => switchClientView('menu'));

  // KDS Filter Chips
  document.querySelectorAll('.chip-filter').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip-filter').forEach(c => {
        c.className = 'chip-filter px-3 py-1 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer';
      });
      chip.className = 'chip-filter active px-3 py-1 rounded-lg text-xs font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900 cursor-pointer';
      state.kdsFilter = chip.dataset.filterType;
      renderKDSBoard();
    });
  });

  document.getElementById('pos-tipo-pedido')?.addEventListener('change', (e) => {
    const tipo = e.target.value;
    document.getElementById('pos-mesa-wrap')?.classList.toggle('hidden', tipo !== 'mesa');
    document.getElementById('pos-dir-wrap')?.classList.toggle('hidden', tipo !== 'domicilio');
    document.getElementById('pos-tel-wrap')?.classList.toggle('hidden', tipo === 'mesa');
  });

  document.getElementById('btn-submit-pos')?.addEventListener('click', submitPosOrder);

  // Toggle KDS: Ocultar o mostrar pedidos ya entregados/servidos y cobrados
  document.getElementById('chk-kds-ocultar-cobrados')?.addEventListener('change', (e) => {
    state.kdsOcultarCobrados = e.target.checked;
    renderKDSBoard();
  });

  // Botones de cambio rápido de pantalla para el empleado
  document.getElementById('bar-btn-cocina')?.addEventListener('click', () => returnToStaffPanel('cocina'));
  document.getElementById('bar-btn-cobros')?.addEventListener('click', () => returnToStaffPanel('cobros'));
  document.getElementById('bar-btn-historico')?.addEventListener('click', () => returnToStaffPanel('historico'));
  document.getElementById('bar-btn-web-cliente')?.addEventListener('click', () => {
    switchClientView('menu');
    showToast('👁️ Viendo la carta como cliente (tu turno de personal sigue activo)', 'info');
  });

  // Retorno a personal desde la pantalla de seguimiento de cliente
  document.getElementById('btn-tracking-to-staff')?.addEventListener('click', () => returnToStaffPanel('cocina'));

  // Búsqueda de cualquier comanda en pantalla de seguimiento
  const handleSearchTracking = () => {
    const input = document.getElementById('input-search-tracking-id');
    const id = input?.value.trim();
    if (id) {
      state.activeTrackingId = id;
      localStorage.setItem('last_pedido_id', id);
      document.getElementById('badge-tracking')?.classList.remove('hidden');
      fetchTrackingData(id);
      showToast(`🔎 Consultando pedido #${id}`, 'info');
    }
  };
  document.getElementById('btn-search-tracking-id')?.addEventListener('click', handleSearchTracking);
  document.getElementById('input-search-tracking-id')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearchTracking();
  });

  // Pantalla CRUD Caja & Cobros
  document.getElementById('btn-goto-nueva-comanda')?.addEventListener('click', () => switchPersonalTab('mostrador'));

  document.getElementById('btn-refresh-crud-cobros')?.addEventListener('click', async () => {
    await loadPedidosKDS();
    renderCobrosCrudTable();
    showToast('🔄 Cuentas por cobrar actualizadas', 'info');
  });

  // Filtros de Canal en CRUD Cobros
  document.querySelectorAll('.pill-cobro-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill-cobro-filter').forEach(b => {
        b.className = 'pill-cobro-filter px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-slate-400 transition-all cursor-pointer whitespace-nowrap';
      });
      btn.className = 'pill-cobro-filter active px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900 border border-slate-900 dark:border-white transition-all cursor-pointer whitespace-nowrap';
      state.cobrosFilter = btn.dataset.filter;
      renderCobrosCrudTable();
    });
  });

  // Buscador en tiempo real en CRUD Cobros
  document.getElementById('input-search-crud-cobros')?.addEventListener('input', () => {
    renderCobrosCrudTable();
  });

  // Pantalla Mantenimiento & Histórico de Pedidos por Fechas
  document.getElementById('btn-refresh-historico')?.addEventListener('click', async () => {
    await loadPedidosKDS();
    renderHistoricoTable();
    showToast('🔄 Histórico actualizado', 'info');
  });

  document.getElementById('btn-print-arqueo-dia')?.addEventListener('click', imprimirArqueoDiario);

  document.querySelectorAll('.pill-historico-rango').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill-historico-rango').forEach(b => {
        b.className = 'pill-historico-rango px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-slate-400 transition-all cursor-pointer whitespace-nowrap';
      });
      btn.className = 'pill-historico-rango active px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900 border border-slate-900 dark:border-white transition-all cursor-pointer whitespace-nowrap';
      state.historicoRango = btn.dataset.rango;
      renderHistoricoTable();
    });
  });

  document.getElementById('historico-date-input')?.addEventListener('change', (e) => {
    state.historicoRango = 'custom';
    state.historicoFecha = e.target.value;
    document.querySelectorAll('.pill-historico-rango').forEach(b => {
      b.className = 'pill-historico-rango px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-slate-400 transition-all cursor-pointer whitespace-nowrap';
    });
    renderHistoricoTable();
  });

  document.getElementById('historico-search-input')?.addEventListener('input', () => {
    renderHistoricoTable();
  });

  // Modal de Modificación / Ajuste de Comanda
  document.getElementById('btn-close-edit-pedido-modal')?.addEventListener('click', () => {
    document.getElementById('modal-editar-pedido')?.classList.add('hidden');
  });

  document.getElementById('btn-cancel-edit-pedido')?.addEventListener('click', () => {
    document.getElementById('modal-editar-pedido')?.classList.add('hidden');
  });

  document.getElementById('edit-pedido-tipo')?.addEventListener('change', (e) => {
    updateEditTipoVisibility(e.target.value);
  });

  // Modal de Cobro Presencial
  document.getElementById('btn-close-cobro-modal')?.addEventListener('click', () => {
    document.getElementById('modal-cobro').classList.add('hidden');
  });

  document.getElementById('btn-cancel-cobro')?.addEventListener('click', () => {
    document.getElementById('modal-cobro').classList.add('hidden');
  });

  document.querySelectorAll('input[name="cobro-method"]').forEach(radio => {
    radio.addEventListener('change', updateCobroMethodPanels);
  });

  document.getElementById('input-importe-entregado')?.addEventListener('input', updateCambioCalculator);

  document.querySelectorAll('.btn-quick-cash').forEach(btn => {
    btn.addEventListener('click', () => {
      const cashVal = btn.dataset.cash;
      const input = document.getElementById('input-importe-entregado');
      if (!input || !state.cobroModalOrder) return;

      if (cashVal === 'exact') {
        input.value = parseFloat(state.cobroModalOrder.total).toFixed(2);
      } else {
        input.value = parseFloat(cashVal).toFixed(2);
      }
      updateCambioCalculator();
    });
  });

  document.getElementById('btn-confirmar-cobro')?.addEventListener('click', confirmarCobroModal);

  document.getElementById('btn-cobro-abrir-stripe')?.addEventListener('click', () => {
    if (state.cobroModalOrder) {
      iniciarStripeParaPedido(state.cobroModalOrder.id);
    }
  });

  // Modal de Ticket Fiscal
  document.getElementById('btn-close-ticket-modal')?.addEventListener('click', () => {
    document.getElementById('modal-ticket').classList.add('hidden');
  });

  document.getElementById('btn-ticket-close')?.addEventListener('click', () => {
    document.getElementById('modal-ticket').classList.add('hidden');
  });

  document.getElementById('btn-print-ticket')?.addEventListener('click', () => {
    window.print();
  });
}


async function submitPosOrder() {
  if (posItems.length === 0) return;

  const tipo = document.getElementById('pos-tipo-pedido').value;
  const mesa = document.getElementById('pos-mesa').value;
  const cliente = document.getElementById('pos-cliente').value.trim() || 'Cliente Mostrador';
  const dir = document.getElementById('pos-direccion')?.value.trim();
  const tel = document.getElementById('pos-telefono')?.value.trim();
  const obs = document.getElementById('pos-obs').value.trim();

  const payload = {
    tipo_pedido: tipo,
    mesa_numero: tipo === 'mesa' ? parseInt(mesa, 10) : null,
    cliente_nombre: cliente,
    cliente_telefono: tel || null,
    cliente_direccion: dir || null,
    observaciones: obs || null,
    lineas: posItems.map(i => ({ pizza_id: i.pizza_id, cantidad: i.cantidad })),
  };

  try {
    const res = await fetch(`${API_BASE}/pedidos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      showToast('🚀 Pedido de mostrador enviado a cocina', 'success');
      posItems = [];
      renderPosTicket();
      document.getElementById('pos-cliente').value = '';
      document.getElementById('pos-obs').value = '';
      if (state.activePersonalTab === 'cocina') loadPedidosKDS();
    }
  } catch (err) {
    showToast(`❌ Error al tramitar comanda: ${err.message}`, 'error');
  }
}

function openCartDrawer() {
  renderCartDrawer();
  document.getElementById('cart-drawer-modal').classList.remove('hidden');
}

function closeCartDrawer() {
  document.getElementById('cart-drawer-modal').classList.add('hidden');
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const borderColor = type === 'success' ? 'border-emerald-500' : type === 'error' ? 'border-brand-500' : 'border-blue-500';
  
  toast.className = `px-4 py-3 rounded-2xl bg-slate-900 text-white border-l-4 ${borderColor} shadow-2xl text-xs sm:text-sm font-semibold flex items-center gap-2 pointer-events-auto animate-slide-up`;
  toast.innerHTML = msg;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
