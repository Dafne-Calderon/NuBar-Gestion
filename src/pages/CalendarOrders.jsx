import { useEffect, useMemo, useState } from 'react';
import {
  Bike,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  PackageCheck,
  Plus,
  RefreshCcw,
  Save,
  Store,
  Trash2,
  Truck,
  UserRound,
  UsersRound,
  Warehouse,
  XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { money, number } from '../utils/calculations.js';

const WEEKDAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
];

const DEFAULT_SETTINGS = {
  id: 1,
  fuel_price_per_liter: 1300,
  vehicle_km_per_liter: 30,
  maintenance_cost_per_km: 50,
  delivery_base_fee: 1000,
  minimum_delivery_fee: 2000,
  delivery_margin_percent: 20,
  round_trip: true,
  auto_split_production: true,
  origin_address: '',
};

const emptyForm = {
  recipe_id: '',
  quantity_bars: 0,
  seller_id: '',
  customer: '',
  delivery_date: '',
  address: '',
  commune: '',
  distance_km: 0,
  notes: '',
  status: 'pendiente',
};

const emptyZone = {
  commune: '',
  weekday: 1,
  default_distance_km: 0,
  base_fee_override: '',
};

function weekdayName(value) {
  return WEEKDAYS.find((day) => day.value === Number(value))?.label || '';
}

function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextDeliveryDate(weekday) {
  const now = new Date();
  const currentIsoDay = now.getDay() === 0 ? 7 : now.getDay();
  let daysAhead = Number(weekday) - currentIsoDay;
  const target = new Date(now);
  target.setHours(10, 0, 0, 0);

  if (daysAhead < 0 || (daysAhead === 0 && target <= now)) daysAhead += 7;
  target.setDate(target.getDate() + daysAhead);
  return toDateTimeLocal(target);
}

function googleDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function calculateDeliveryPreview(settings, zone, distanceValue) {
  const distance = Math.max(Number(distanceValue || zone?.default_distance_km || 0), 0);
  const kmPerLiter = Math.max(Number(settings.vehicle_km_per_liter || 30), 0.001);
  const totalKm = distance * (settings.round_trip ? 2 : 1);
  const base = zone?.base_fee_override !== null
    && zone?.base_fee_override !== undefined
    && zone?.base_fee_override !== ''
    ? Number(zone.base_fee_override)
    : Number(settings.delivery_base_fee || 0);
  const fuel = (totalKm / kmPerLiter) * Number(settings.fuel_price_per_liter || 0);
  const maintenance = totalKm * Number(settings.maintenance_cost_per_km || 0);
  const subtotal = base + fuel + maintenance;
  const withMargin = subtotal * (1 + Number(settings.delivery_margin_percent || 0) / 100);
  const suggested = Math.ceil(Math.max(Number(settings.minimum_delivery_fee || 0), withMargin) / 100) * 100;

  return { distance, totalKm, base, fuel, maintenance, subtotal, suggested };
}

export default function CalendarOrders() {
  const { user, profile } = useAuth();
  const [recipes, setRecipes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [sellerInventory, setSellerInventory] = useState([]);
  const [finishedStock, setFinishedStock] = useState([]);
  const [zones, setZones] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState('pendientes');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [calculatingRoute, setCalculatingRoute] = useState(false);
  const [sellerName, setSellerName] = useState('');
  const [zoneForm, setZoneForm] = useState(emptyZone);
  const [stockAdjustment, setStockAdjustment] = useState('');

  const canManage = profile?.role === 'admin';
  const canSchedule = ['admin', 'ventas'].includes(profile?.role);
  const canUpdateStatus = ['admin', 'ventas', 'produccion'].includes(profile?.role);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setWorking(true);

    const results = await Promise.all([
      supabase.from('recipes').select('*').eq('active', true).order('name'),
      supabase.from('orders').select('*, recipes(name), sellers(name)').order('delivery_date', { ascending: true }),
      supabase.from('sellers').select('*').order('created_at'),
      supabase.from('seller_inventory').select('*, recipes(name), sellers(name)').order('updated_at', { ascending: false }),
      supabase.from('finished_goods_inventory').select('*, recipes(name)').order('updated_at', { ascending: false }),
      supabase.from('delivery_zones').select('*').order('weekday').order('commune'),
      supabase.from('sales_settings').select('*').eq('id', 1).maybeSingle(),
    ]);

    setWorking(false);

    const firstError = results.find((result) => result.error)?.error;
    if (firstError) {
      const missingTables = /seller_inventory|finished_goods_inventory|delivery_zones|sales_settings|sellers/i.test(firstError.message);
      setMessage(missingTables
        ? 'Falta instalar el módulo de ventas y delivery. Ejecuta supabase/sales_delivery_calendar.sql en Supabase.'
        : firstError.message);
      return;
    }

    const [recipesResult, ordersResult, sellersResult, sellerStockResult, finishedResult, zonesResult, settingsResult] = results;
    const loadedRecipes = recipesResult.data || [];
    const activeSellers = (sellersResult.data || []).filter((seller) => seller.active);

    setRecipes(loadedRecipes);
    setOrders(ordersResult.data || []);
    setSellers(sellersResult.data || []);
    setSellerInventory(sellerStockResult.data || []);
    setFinishedStock(finishedResult.data || []);
    setZones(zonesResult.data || []);
    setSettings({ ...DEFAULT_SETTINGS, ...(settingsResult.data || {}) });

    setForm((current) => ({
      ...current,
      recipe_id: current.recipe_id || loadedRecipes[0]?.id || '',
      seller_id: current.seller_id || activeSellers[0]?.id || '',
    }));
  }

  const activeSellers = useMemo(() => sellers.filter((seller) => seller.active), [sellers]);

  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === form.recipe_id),
    [recipes, form.recipe_id]
  );

  const selectedZone = useMemo(
    () => zones.find((zone) => zone.active && zone.commune === form.commune),
    [zones, form.commune]
  );

  const warehouseAvailable = useMemo(
    () => Number(finishedStock.find((stock) => stock.recipe_id === form.recipe_id)?.warehouse_bars || 0),
    [finishedStock, form.recipe_id]
  );

  const selectedSellerAvailable = useMemo(() => {
    if (!form.seller_id) return warehouseAvailable;
    return Number(sellerInventory.find(
      (stock) => stock.recipe_id === form.recipe_id && stock.seller_id === form.seller_id
    )?.available_bars || 0);
  }, [sellerInventory, form.recipe_id, form.seller_id, warehouseAvailable]);

  const totalAvailable = useMemo(() => {
    const sellersTotal = sellerInventory
      .filter((stock) => stock.recipe_id === form.recipe_id)
      .reduce((sum, stock) => sum + Number(stock.available_bars || 0), 0);
    return warehouseAvailable + sellersTotal;
  }, [sellerInventory, form.recipe_id, warehouseAvailable]);

  const delivery = useMemo(
    () => calculateDeliveryPreview(settings, selectedZone, form.distance_km),
    [settings, selectedZone, form.distance_km]
  );

  const visibleOrders = useMemo(() => {
    if (filter === 'todos') return orders;
    if (filter === 'listos') return orders.filter((order) => ['listo', 'entregado'].includes(order.status));
    return orders.filter((order) => !['listo', 'entregado', 'cancelado'].includes(order.status));
  }, [orders, filter]);

  function changeZone(commune) {
    const zone = zones.find((item) => item.commune === commune && item.active);
    setForm((current) => ({
      ...current,
      commune,
      distance_km: zone?.default_distance_km ?? current.distance_km,
      delivery_date: zone ? nextDeliveryDate(zone.weekday) : current.delivery_date,
    }));
  }

  async function calculateRouteDistance() {
    setMessage('');

    if (!settings.origin_address?.trim()) {
      setMessage('Primero guarda la dirección de salida en Configuración del delivery.');
      return;
    }

    if (!form.address.trim()) {
      setMessage('Ingresa la dirección del cliente antes de calcular la distancia.');
      return;
    }

    setCalculatingRoute(true);
    const { data, error } = await supabase.functions.invoke('calculate-route', {
      body: {
        origin: settings.origin_address.trim(),
        destination: form.address.trim(),
      },
    });
    setCalculatingRoute(false);

    if (error || data?.error) {
      setMessage(data?.error || error?.message || 'No fue posible calcular la ruta. Puedes ingresar la distancia manualmente.');
      return;
    }

    setForm((current) => ({ ...current, distance_km: data.distance_km }));
    setMessage(`Ruta calculada: ${number(data.distance_km, 1)} km solo ida${data.duration_minutes ? ` · ${data.duration_minutes} min aprox.` : ''}`);
  }

  async function createOrder(event) {
    event.preventDefault();
    setMessage('');

    if (!canSchedule) {
      setMessage('Solo administración o ventas puede agendar pedidos.');
      return;
    }

    const quantity = Number(form.quantity_bars || 0);
    if (!form.recipe_id || !form.customer.trim() || !form.delivery_date || !form.address.trim()) {
      setMessage('Completa receta, cliente, fecha de entrega y dirección.');
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setMessage('La cantidad de barritas debe ser un número entero mayor que cero.');
      return;
    }

    if (quantity > selectedSellerAvailable) {
      setMessage(`No hay stock suficiente en ${form.seller_id ? 'el vendedor seleccionado' : 'bodega'}. Disponibles: ${selectedSellerAvailable}.`);
      return;
    }

    setWorking(true);
    const { data, error } = await supabase.rpc('create_order_with_stock', {
      p_recipe_id: form.recipe_id,
      p_quantity_bars: quantity,
      p_customer: form.customer.trim(),
      p_delivery_date: new Date(form.delivery_date).toISOString(),
      p_address: form.address.trim(),
      p_commune: form.commune || null,
      p_distance_km: Number(form.distance_km || 0),
      p_seller_id: form.seller_id || null,
      p_notes: form.notes.trim() || null,
      p_status: form.status,
    });
    setWorking(false);

    if (error) {
      setMessage(error.message.includes('create_order_with_stock')
        ? 'Falta ejecutar supabase/sales_delivery_calendar.sql en Supabase.'
        : error.message);
      return;
    }

    if (!data?.success) {
      const dayHelp = data?.expected_weekday
        ? ` Esta comuna se reparte los ${weekdayName(data.expected_weekday).toLowerCase()}.`
        : '';
      setMessage(`${data?.message || 'No fue posible agendar el pedido.'}${dayHelp}`);
      return;
    }

    setMessage(`Pedido agendado. Se descontaron ${quantity} barritas y el delivery sugerido es ${money(data.delivery_fee)}.`);
    setForm((current) => ({
      ...emptyForm,
      recipe_id: current.recipe_id,
      seller_id: current.seller_id,
      commune: current.commune,
      distance_km: current.distance_km,
      delivery_date: selectedZone ? nextDeliveryDate(selectedZone.weekday) : '',
    }));
    await load();
  }

  async function updateOrderStatus(order, status) {
    if (!canUpdateStatus) return;
    if (status === 'cancelado' && !confirm('¿Cancelar el pedido? Las barritas se devolverán automáticamente al stock original.')) return;

    setWorking(true);
    const { data, error } = await supabase.rpc('update_order_status_with_stock', {
      p_order_id: order.id,
      p_status: status,
    });
    setWorking(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    if (!data?.success) {
      setMessage(data?.message || 'No fue posible actualizar el pedido.');
      return;
    }

    const messages = {
      listo: 'Pedido marcado como listo.',
      entregado: 'Pedido marcado como entregado.',
      en_produccion: 'Pedido enviado a producción.',
      cancelado: 'Pedido cancelado y stock repuesto automáticamente.',
      pendiente: 'Pedido marcado como pendiente.',
    };
    setMessage(messages[status] || 'Estado actualizado.');
    await load();
  }

  async function createSeller(event) {
    event.preventDefault();
    if (!canManage || !sellerName.trim()) return;

    const { error } = await supabase.from('sellers').insert({
      name: sellerName.trim(),
      created_by: user.id,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setSellerName('');
    setMessage('Vendedor creado. Cuando existan exactamente dos vendedores activos, la producción podrá dividirse 50/50.');
    await load();
  }

  async function toggleSeller(seller) {
    if (!canManage) return;
    const { error } = await supabase.from('sellers').update({ active: !seller.active }).eq('id', seller.id);
    if (error) return setMessage(error.message);
    await load();
  }

  async function splitStock() {
    if (!canManage || !form.recipe_id) return;
    if (!confirm(`¿Distribuir todo el stock de bodega de ${selectedRecipe?.name || 'esta receta'} entre los dos vendedores activos?`)) return;

    const { data, error } = await supabase.rpc('split_warehouse_stock', { p_recipe_id: form.recipe_id });
    if (error) return setMessage(error.message);
    setMessage(data?.message || `Se distribuyeron ${data?.distributed || 0} barritas en partes iguales.`);
    await load();
  }

  async function adjustStock() {
    const quantity = Number(stockAdjustment);
    if (!canManage || !form.recipe_id || !Number.isInteger(quantity) || quantity < 0) {
      setMessage('Ingresa un stock general entero igual o mayor que cero.');
      return;
    }

    const { data, error } = await supabase.rpc('adjust_finished_stock', {
      p_recipe_id: form.recipe_id,
      p_new_quantity: quantity,
      p_notes: 'Ajuste manual desde Pedidos y entregas',
    });
    if (error) return setMessage(error.message);
    setMessage(`Stock general actualizado de ${data.previous_stock} a ${data.new_stock} barritas.`);
    setStockAdjustment('');
    await load();
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!canManage) return;

    const payload = {
      fuel_price_per_liter: Number(settings.fuel_price_per_liter || 0),
      vehicle_km_per_liter: Number(settings.vehicle_km_per_liter || 30),
      maintenance_cost_per_km: Number(settings.maintenance_cost_per_km || 0),
      delivery_base_fee: Number(settings.delivery_base_fee || 0),
      minimum_delivery_fee: Number(settings.minimum_delivery_fee || 0),
      delivery_margin_percent: Number(settings.delivery_margin_percent || 0),
      round_trip: Boolean(settings.round_trip),
      auto_split_production: Boolean(settings.auto_split_production),
      origin_address: settings.origin_address?.trim() || '',
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('sales_settings').update(payload).eq('id', 1);
    if (error) return setMessage(error.message);
    setMessage('Configuración de delivery guardada.');
    await load();
  }

  async function saveZone(event) {
    event.preventDefault();
    if (!canManage || !zoneForm.commune.trim()) return;

    const payload = {
      commune: zoneForm.commune.trim(),
      weekday: Number(zoneForm.weekday),
      default_distance_km: Number(zoneForm.default_distance_km || 0),
      base_fee_override: zoneForm.base_fee_override === '' ? null : Number(zoneForm.base_fee_override),
      created_by: user.id,
    };

    const { error } = await supabase.from('delivery_zones').upsert(payload, { onConflict: 'commune' });
    if (error) return setMessage(error.message);
    setZoneForm(emptyZone);
    setMessage('Comuna y día de reparto guardados.');
    await load();
  }

  async function removeZone(id) {
    if (!canManage || !confirm('¿Eliminar esta comuna del calendario de reparto?')) return;
    const { error } = await supabase.from('delivery_zones').delete().eq('id', id);
    if (error) return setMessage(error.message);
    await load();
  }

  function mapsUrl(order) {
    const destination = encodeURIComponent(order.address);
    if (settings.origin_address?.trim()) {
      return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(settings.origin_address)}&destination=${destination}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${destination}`;
  }

  function calendarUrl(order) {
    const start = new Date(order.delivery_date);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const seller = order.sellers?.name ? `Vendedor: ${order.sellers.name}\n` : '';
    const details = `${order.quantity_bars} barritas de ${order.recipes?.name || 'NüBar'}\n${seller}Comuna: ${order.commune || 'Sin comuna'}\nDelivery: ${money(order.delivery_fee)}\n${order.notes || ''}`;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `Pedido NüBar - ${order.customer}`,
      dates: `${googleDate(start)}/${googleDate(end)}`,
      details,
      location: order.address,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function statusLabel(status) {
    return ({
      pendiente: 'Pendiente',
      en_produccion: 'En producción',
      listo: 'Listo',
      entregado: 'Entregado',
      cancelado: 'Cancelado',
    })[status] || status;
  }

  function statusClass(status) {
    if (status === 'cancelado') return 'danger';
    if (['listo', 'entregado'].includes(status)) return 'ok';
    return 'neutral';
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Pedidos, ventas y delivery</h1>
          <p>Stock disponible por vendedor, descuento automático, comunas por día y agenda de entregas.</p>
        </div>
        <button className="secondary-button" onClick={load} disabled={working}>
          <RefreshCcw size={16} /> Actualizar
        </button>
      </div>

      {message && <div className="notice">{message}</div>}

      <div className="card stock-control-card">
        <div className="card-header-inline">
          <div>
            <h3>Barritas disponibles para venta</h3>
            <p className="muted">El total considera bodega y stock entregado a cada vendedor.</p>
          </div>
          <label className="wide-select">
            Producto / receta
            <select value={form.recipe_id} onChange={(event) => setForm({ ...form, recipe_id: event.target.value })}>
              <option value="">Seleccionar</option>
              {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
            </select>
          </label>
        </div>

        <div className="stock-kpis">
          <StockKpi icon={PackageCheck} label="Total disponible" value={totalAvailable} emphasis />
          <StockKpi icon={Warehouse} label="En bodega" value={warehouseAvailable} />
          {activeSellers.map((seller) => {
            const quantity = Number(sellerInventory.find(
              (stock) => stock.recipe_id === form.recipe_id && stock.seller_id === seller.id
            )?.available_bars || 0);
            return <StockKpi key={seller.id} icon={Store} label={seller.name} value={quantity} />;
          })}
        </div>

        {canManage && (
          <div className="stock-admin-actions">
            <label>
              Corregir stock de bodega
              <input
                type="number"
                min="0"
                step="1"
                value={stockAdjustment}
                onChange={(event) => setStockAdjustment(event.target.value)}
                placeholder={String(warehouseAvailable)}
              />
            </label>
            <button type="button" className="secondary-button" onClick={adjustStock}><Save size={16} /> Guardar ajuste</button>
            <button type="button" className="primary-button" onClick={splitStock} disabled={warehouseAvailable <= 0}>
              <UsersRound size={16} /> Distribuir 50/50
            </button>
          </div>
        )}
      </div>

      {canSchedule ? (
        <form className="card form-card" onSubmit={createOrder}>
          <div className="card-header-inline">
            <div>
              <h3>Nuevo pedido / entrega</h3>
              <p className="muted">El stock se rebaja al agendar para evitar vender más barritas de las disponibles.</p>
            </div>
            <div className="availability-pill">
              <PackageCheck size={18} />
              <span>Disponibles en esta fuente</span>
              <strong>{selectedSellerAvailable}</strong>
            </div>
          </div>

          <div className="form-grid order-form-grid">
            <label>
              Receta
              <select value={form.recipe_id} onChange={(event) => setForm({ ...form, recipe_id: event.target.value })} required>
                <option value="">Seleccionar</option>
                {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
              </select>
            </label>

            <label>
              Cantidad barritas
              <input
                type="number"
                min="1"
                max={selectedSellerAvailable || undefined}
                step="1"
                value={form.quantity_bars}
                onChange={(event) => setForm({ ...form, quantity_bars: event.target.value })}
                required
              />
              <small className={Number(form.quantity_bars) > selectedSellerAvailable ? 'field-error' : 'field-help'}>
                Máximo disponible: {selectedSellerAvailable}
              </small>
            </label>

            <label>
              Vendedor / origen del stock
              <select value={form.seller_id} onChange={(event) => setForm({ ...form, seller_id: event.target.value })}>
                <option value="">Bodega general</option>
                {activeSellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
              </select>
            </label>

            <label>
              Cliente
              <input value={form.customer} onChange={(event) => setForm({ ...form, customer: event.target.value })} required />
            </label>

            <label>
              Comuna / sector
              <select value={form.commune} onChange={(event) => changeZone(event.target.value)}>
                <option value="">Seleccionar comuna</option>
                {zones.filter((zone) => zone.active).map((zone) => (
                  <option key={zone.id} value={zone.commune}>{zone.commune} · {weekdayName(zone.weekday)}</option>
                ))}
              </select>
              {selectedZone && <small className="field-help">Reparto: {weekdayName(selectedZone.weekday)} · distancia base {number(selectedZone.default_distance_km, 1)} km</small>}
            </label>

            <label>
              Fecha entrega
              <input type="datetime-local" value={form.delivery_date} onChange={(event) => setForm({ ...form, delivery_date: event.target.value })} required />
            </label>

            <label className="span-two">
              Dirección / locación
              <input
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
                required
                placeholder="Ej: Av. Providencia 123, Santiago"
              />
            </label>

            <label>
              Distancia solo ida (km)
              <input type="number" min="0" step="0.1" value={form.distance_km} onChange={(event) => setForm({ ...form, distance_km: event.target.value })} />
              <button type="button" className="route-calculate-button" onClick={calculateRouteDistance} disabled={calculatingRoute}>
                <MapPin size={14} /> {calculatingRoute ? 'Calculando ruta...' : 'Calcular con Google Maps'}
              </button>
            </label>

            <label>
              Estado inicial
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                <option value="pendiente">Pendiente</option>
                <option value="en_produccion">En producción</option>
                <option value="listo">Listo</option>
              </select>
            </label>
          </div>

          <div className="delivery-preview">
            <div><Bike size={22} /><span>Rendimiento moto</span><strong>{number(settings.vehicle_km_per_liter, 1)} km/L</strong></div>
            <div><Truck size={22} /><span>Recorrido calculado</span><strong>{number(delivery.totalKm, 1)} km</strong></div>
            <div><span>Bencina estimada</span><strong>{money(delivery.fuel)}</strong></div>
            <div><span>Desgaste + base</span><strong>{money(delivery.maintenance + delivery.base)}</strong></div>
            <div className="delivery-total"><span>Delivery sugerido</span><strong>{money(delivery.suggested)}</strong></div>
          </div>

          <label>
            Notas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>

          <button className="primary-button" disabled={working || selectedSellerAvailable <= 0 || Number(form.quantity_bars) > selectedSellerAvailable}>
            <Plus size={16} /> Agendar y descontar stock
          </button>
        </form>
      ) : (
        <div className="notice">Tu usuario puede ver pedidos. Solo administración o ventas puede agendarlos.</div>
      )}

      <div className="toolbar">
        <button className={filter === 'pendientes' ? 'chip active' : 'chip'} onClick={() => setFilter('pendientes')}>Pendientes</button>
        <button className={filter === 'listos' ? 'chip active' : 'chip'} onClick={() => setFilter('listos')}>Listos</button>
        <button className={filter === 'todos' ? 'chip active' : 'chip'} onClick={() => setFilter('todos')}>Todos</button>
      </div>

      <div className="calendar-grid">
        {visibleOrders.map((order) => (
          <article className={`order-card ${['listo', 'entregado'].includes(order.status) ? 'ready-order' : ''}`} key={order.id}>
            <div className="order-card-topline">
              <span className={`badge ${statusClass(order.status)}`}>{statusLabel(order.status)}</span>
              <strong>{money(order.delivery_fee)} delivery</strong>
            </div>

            <h3>{order.customer}</h3>
            <p><strong>{order.quantity_bars}</strong> barritas · {order.recipes?.name}</p>
            <p><CalendarDays size={15} /> {new Date(order.delivery_date).toLocaleString('es-CL')}</p>
            {order.sellers?.name && <p><UserRound size={15} /> Vendedor: <strong>{order.sellers.name}</strong></p>}
            {order.commune && <p><MapPin size={15} /> {order.commune} · {number(order.distance_km, 1)} km solo ida</p>}

            <div className="order-link-row">
              <a className="maps-link" href={mapsUrl(order)} target="_blank" rel="noreferrer">
                <MapPin size={16} /> Ver ruta
              </a>
              <a className="calendar-link" href={calendarUrl(order)} target="_blank" rel="noreferrer">
                <CalendarDays size={16} /> Google Calendar
              </a>
            </div>

            <p className="muted">{order.address}</p>
            {order.notes && <p className="muted">{order.notes}</p>}

            {canUpdateStatus && order.status !== 'cancelado' && (
              <div className="order-actions">
                {!['listo', 'entregado'].includes(order.status) && (
                  <button type="button" className="mini-button" onClick={() => updateOrderStatus(order, 'en_produccion')}>
                    <Clock3 size={14} /> En producción
                  </button>
                )}
                {order.status !== 'entregado' && (
                  <button type="button" className="mini-button success-button" onClick={() => updateOrderStatus(order, 'listo')}>
                    <CheckCircle2 size={14} /> Marcar listo
                  </button>
                )}
                {order.status === 'listo' && (
                  <button type="button" className="mini-button" onClick={() => updateOrderStatus(order, 'entregado')}>
                    <PackageCheck size={14} /> Entregado
                  </button>
                )}
                <button type="button" className="mini-button danger-button" onClick={() => updateOrderStatus(order, 'cancelado')}>
                  <XCircle size={14} /> Cancelar
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {canManage && (
        <div className="admin-sales-grid">
          <div className="card">
            <h3>Vendedores y distribución</h3>
            <p className="muted">Crea los dos vendedores. Con exactamente dos activos, las nuevas producciones se reparten automáticamente 50/50.</p>
            <form className="inline-create-form" onSubmit={createSeller}>
              <input value={sellerName} onChange={(event) => setSellerName(event.target.value)} placeholder="Nombre del vendedor" required />
              <button className="primary-button"><Plus size={16} /> Crear</button>
            </form>
            <div className="seller-list">
              {sellers.map((seller) => (
                <div key={seller.id} className="seller-row">
                  <div><Store size={18} /><strong>{seller.name}</strong></div>
                  <button className="mini-button" onClick={() => toggleSeller(seller)}>{seller.active ? 'Desactivar' : 'Activar'}</button>
                </div>
              ))}
            </div>
          </div>

          <form className="card" onSubmit={saveSettings}>
            <h3>Configuración del delivery</h3>
            <div className="form-grid compact-settings-grid">
              <SettingInput label="Bencina ($/L)" value={settings.fuel_price_per_liter} onChange={(value) => setSettings({ ...settings, fuel_price_per_liter: value })} />
              <SettingInput label="Rendimiento (km/L)" value={settings.vehicle_km_per_liter} onChange={(value) => setSettings({ ...settings, vehicle_km_per_liter: value })} step="0.1" />
              <SettingInput label="Desgaste ($/km)" value={settings.maintenance_cost_per_km} onChange={(value) => setSettings({ ...settings, maintenance_cost_per_km: value })} />
              <SettingInput label="Cargo base" value={settings.delivery_base_fee} onChange={(value) => setSettings({ ...settings, delivery_base_fee: value })} />
              <SettingInput label="Cobro mínimo" value={settings.minimum_delivery_fee} onChange={(value) => setSettings({ ...settings, minimum_delivery_fee: value })} />
              <SettingInput label="Margen delivery (%)" value={settings.delivery_margin_percent} onChange={(value) => setSettings({ ...settings, delivery_margin_percent: value })} step="0.1" />
              <label className="span-two">
                Dirección de salida
                <input value={settings.origin_address} onChange={(event) => setSettings({ ...settings, origin_address: event.target.value })} placeholder="Ej: taller NüBar, Santiago" />
              </label>
            </div>
            <div className="settings-checks">
              <label className="check-row">
                <input type="checkbox" checked={settings.round_trip} onChange={(event) => setSettings({ ...settings, round_trip: event.target.checked })} />
                Considerar ida y vuelta
              </label>
              <label className="check-row">
                <input type="checkbox" checked={settings.auto_split_production} onChange={(event) => setSettings({ ...settings, auto_split_production: event.target.checked })} />
                Repartir producción 50/50
              </label>
            </div>
            <button className="primary-button"><Save size={16} /> Guardar configuración</button>
          </form>
        </div>
      )}

      {canManage && (
        <div className="card">
          <h3>Sectorización semanal por comuna</h3>
          <p className="muted">Cada comuna queda asociada a un día de lunes a viernes y a una distancia base solo de ida.</p>
          <form className="zone-form" onSubmit={saveZone}>
            <label>
              Comuna
              <input value={zoneForm.commune} onChange={(event) => setZoneForm({ ...zoneForm, commune: event.target.value })} placeholder="Ej: Providencia" required />
            </label>
            <label>
              Día
              <select value={zoneForm.weekday} onChange={(event) => setZoneForm({ ...zoneForm, weekday: event.target.value })}>
                {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
              </select>
            </label>
            <label>
              Distancia base (km)
              <input type="number" min="0" step="0.1" value={zoneForm.default_distance_km} onChange={(event) => setZoneForm({ ...zoneForm, default_distance_km: event.target.value })} />
            </label>
            <label>
              Cargo base especial
              <input type="number" min="0" step="100" value={zoneForm.base_fee_override} onChange={(event) => setZoneForm({ ...zoneForm, base_fee_override: event.target.value })} placeholder="Opcional" />
            </label>
            <button className="primary-button"><Plus size={16} /> Guardar comuna</button>
          </form>

          <div className="table-card compact-table">
            <table>
              <thead><tr><th>Comuna</th><th>Día</th><th>Distancia</th><th>Cargo especial</th><th>Acción</th></tr></thead>
              <tbody>
                {zones.map((zone) => (
                  <tr key={zone.id}>
                    <td><strong>{zone.commune}</strong></td>
                    <td>{weekdayName(zone.weekday)}</td>
                    <td>{number(zone.default_distance_km, 1)} km</td>
                    <td>{zone.base_fee_override === null ? 'Tarifa general' : money(zone.base_fee_override)}</td>
                    <td><button className="icon-button" onClick={() => removeZone(zone.id)}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function StockKpi({ icon: Icon, label, value, emphasis = false }) {
  return (
    <div className={`stock-kpi ${emphasis ? 'emphasis' : ''}`}>
      <Icon size={22} />
      <span>{label}</span>
      <strong>{value} barritas</strong>
    </div>
  );
}

function SettingInput({ label, value, onChange, step = '1' }) {
  return (
    <label>
      {label}
      <input type="number" min="0" step={step} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
