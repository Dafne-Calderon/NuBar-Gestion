import { useEffect, useMemo, useState } from 'react';
import {
  CalendarRange,
  ChevronDown,
  ChevronUp,
  PackagePlus,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { money, number } from '../utils/calculations.js';

const PRICE_RULES = {
  classic: [
    { min: 10, max: 19, price: 1200, label: '10 a 19' },
    { min: 20, max: 49, price: 1100, label: '20 a 49' },
    { min: 50, max: Infinity, price: 1050, label: '50 o más' },
  ],
  filled_raspberry: [
    { min: 5, max: 9, price: 2200, label: '5 a 9' },
    { min: 10, max: 19, price: 2000, label: '10 a 19' },
    { min: 20, max: Infinity, price: 1900, label: '20 o más' },
  ],
};

const FREQUENCY_LABELS = {
  one_time: 'Una sola vez',
  daily: 'Diario',
  weekly: 'Semanal',
  monthly: 'Mensual',
  custom: 'Fechas personalizadas',
};

const emptyOrderForm = {
  customer: '',
  email: '',
  phone: '',
  address: '',
  commune: '',
  delivery_date: nextDateTimeLocal(),
  frequency: 'one_time',
  repeat_count: 1,
  notes: '',
};

function nextDateTimeLocal() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);

  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addFrequencyInterval(value, frequency, amount) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return nextDateTimeLocal();
  }

  if (frequency === 'weekly') {
    date.setDate(date.getDate() + amount * 7);
  } else if (frequency === 'monthly') {
    date.setMonth(date.getMonth() + amount);
  } else {
    date.setDate(date.getDate() + amount);
  }

  return toDateTimeLocal(date);
}

function clampDeliveryCount(value) {
  return Math.min(Math.max(Number(value || 1), 1), 365);
}

function buildDeliveryDates(
  firstDate,
  frequency,
  count,
  currentDates = [],
) {
  const total = frequency === 'one_time'
    ? 1
    : clampDeliveryCount(count);
  const start = firstDate || nextDateTimeLocal();

  if (frequency === 'custom') {
    const dates = currentDates.slice(0, total);

    if (dates.length === 0) {
      dates.push(start);
    } else {
      dates[0] = dates[0] || start;
    }

    while (dates.length < total) {
      dates.push(
        addFrequencyInterval(
          dates[dates.length - 1] || start,
          'daily',
          1,
        ),
      );
    }

    return dates;
  }

  return Array.from({ length: total }, (_, index) =>
    addFrequencyInterval(start, frequency, index),
  );
}

function unitPrice(category, quantity) {
  const qty = Number(quantity || 0);
  const rule = (PRICE_RULES[category] || []).find(
    (item) => qty >= item.min && qty <= item.max,
  );

  return rule?.price || 0;
}

function statusLabel(status) {
  return (
    {
      pendiente: 'Pendiente',
      en_produccion: 'En producción',
      listo: 'Listo',
      entregado: 'Entregado',
      cancelado: 'Cancelado',
    }[status] || status
  );
}

function statusClass(status) {
  if (status === 'cancelado') return 'danger';
  if (['listo', 'entregado'].includes(status)) return 'ok';
  return 'neutral';
}

export default function WholesaleSales() {
  const { profile } = useAuth();

  const [recipes, setRecipes] = useState([]);
  const [recipeSettings, setRecipeSettings] = useState({});
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(emptyOrderForm);
  const [deliveryDates, setDeliveryDates] = useState([
    emptyOrderForm.delivery_date,
  ]);
  const [lines, setLines] = useState([
    { recipe_id: '', quantity: 20 },
  ]);
  const [showConfiguration, setShowConfiguration] =
    useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const canCreate = ['admin', 'ventas'].includes(profile?.role);
  const canConfigure = profile?.role === 'admin';

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setMessage('');

    const [recipesResult, ordersResult] = await Promise.all([
      supabase
        .from('recipes')
        .select(
          'id, name, active, bars_per_batch, wholesale_enabled, wholesale_category, finished_stock_qty, reserved_stock_qty',
        )
        .order('name'),
      supabase
        .from('wholesale_orders')
        .select(
          '*, wholesale_order_items(*, recipes(id, name, bars_per_batch))',
        )
        .order('delivery_date', { ascending: true })
        .limit(150),
    ]);

    setLoading(false);

    if (recipesResult.error || ordersResult.error) {
      const error =
        recipesResult.error || ordersResult.error;

      setMessage(
        /wholesale_orders|wholesale_enabled|wholesale_category/i.test(
          error.message,
        )
          ? 'Falta instalar el módulo mayorista. Ejecuta el archivo SQL incluido en Supabase.'
          : error.message,
      );
      return;
    }

    const loadedRecipes = recipesResult.data || [];
    setRecipes(loadedRecipes);
    setOrders(ordersResult.data || []);

    setRecipeSettings(
      Object.fromEntries(
        loadedRecipes.map((recipe) => [
          recipe.id,
          {
            enabled: Boolean(recipe.wholesale_enabled),
            category:
              recipe.wholesale_category || 'classic',
          },
        ]),
      ),
    );

    const firstEnabled = loadedRecipes.find(
      (recipe) => recipe.wholesale_enabled,
    );

    setLines((current) =>
      current.map((line, index) => ({
        ...line,
        recipe_id:
          line.recipe_id ||
          (index === 0 ? firstEnabled?.id || '' : ''),
      })),
    );
  }

  const enabledRecipes = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          recipe.active !== false &&
          recipe.wholesale_enabled,
      ),
    [recipes],
  );

  const previewLines = useMemo(
    () =>
      lines.map((line) => {
        const recipe = recipes.find(
          (item) => item.id === line.recipe_id,
        );
        const quantity = Number(line.quantity || 0);
        const price = unitPrice(
          recipe?.wholesale_category,
          quantity,
        );

        const physicalStock = Number(
          recipe?.finished_stock_qty || 0,
        );
        const reservedStock = Number(
          recipe?.reserved_stock_qty || 0,
        );

        return {
          ...line,
          recipe,
          quantity,
          unit_price: price,
          subtotal: quantity * price,
          physical_stock: physicalStock,
          reserved_stock: reservedStock,
          available_stock: Math.max(
            physicalStock - reservedStock,
            0,
          ),
          projected_deficit: Math.max(
            reservedStock + quantity - physicalStock,
            0,
          ),
        };
      }),
    [lines, recipes],
  );

  const totalUnits = previewLines.reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  const totalPerOrder = previewLines.reduce(
    (sum, line) => sum + line.subtotal,
    0,
  );

  const deliveryCount = deliveryDates.length;
  const scheduleTotal = totalPerOrder * deliveryCount;

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function changeFrequency(value) {
    const count = value === 'one_time'
      ? 1
      : clampDeliveryCount(form.repeat_count);

    setForm((current) => ({
      ...current,
      frequency: value,
      repeat_count: count,
    }));

    setDeliveryDates((current) =>
      buildDeliveryDates(
        current[0] || form.delivery_date,
        value,
        count,
        current,
      ),
    );
  }

  function changeDeliveryCount(value) {
    const count = clampDeliveryCount(value);

    setForm((current) => ({
      ...current,
      repeat_count: count,
    }));

    setDeliveryDates((current) =>
      buildDeliveryDates(
        current[0] || form.delivery_date,
        form.frequency,
        count,
        current,
      ),
    );
  }

  function updateDeliveryDate(index, value) {
    if (index === 0) {
      setForm((current) => ({
        ...current,
        delivery_date: value,
      }));

      setDeliveryDates((current) => {
        if (form.frequency === 'custom') {
          return current.map((date, dateIndex) =>
            dateIndex === 0 ? value : date,
          );
        }

        return buildDeliveryDates(
          value,
          form.frequency,
          current.length,
          current,
        );
      });

      return;
    }

    setDeliveryDates((current) =>
      current.map((date, dateIndex) =>
        dateIndex === index ? value : date,
      ),
    );
  }

  function regenerateDeliveryDates() {
    setDeliveryDates((current) =>
      buildDeliveryDates(
        current[0] || form.delivery_date,
        form.frequency,
        form.frequency === 'one_time'
          ? 1
          : form.repeat_count,
        current,
      ),
    );
  }

  function updateLine(index, field, value) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, [field]: value }
          : line,
      ),
    );
  }

  function addLine() {
    setLines((current) => [
      ...current,
      {
        recipe_id: enabledRecipes[0]?.id || '',
        quantity: 5,
      },
    ]);
  }

  function removeLine(index) {
    setLines((current) =>
      current.length === 1
        ? current
        : current.filter(
            (_, lineIndex) => lineIndex !== index,
          ),
    );
  }

  async function saveRecipeConfiguration(recipe) {
    if (!canConfigure) return;

    const setting = recipeSettings[recipe.id];

    setMessage('');

    const { error } = await supabase
      .from('recipes')
      .update({
        wholesale_enabled: Boolean(setting?.enabled),
        wholesale_category:
          setting?.category || 'classic',
      })
      .eq('id', recipe.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(
      `Configuración mayorista de ${recipe.name} guardada.`,
    );
    await load();
  }

  async function createSchedule(event) {
    event.preventDefault();
    setMessage('');

    if (!canCreate) {
      setMessage(
        'Solo administración o ventas puede agendar pedidos mayoristas.',
      );
      return;
    }

    if (
      !form.customer.trim() ||
      !form.delivery_date ||
      !form.address.trim()
    ) {
      setMessage(
        'Completa cliente, fecha de entrega y dirección.',
      );
      return;
    }

    if (totalUnits < 20) {
      setMessage(
        'El pedido mínimo mayorista es de 20 unidades totales.',
      );
      return;
    }

    if (
      previewLines.some(
        (line) =>
          !line.recipe ||
          line.quantity <= 0 ||
          line.unit_price <= 0,
      )
    ) {
      setMessage(
        'Revisa los productos y las cantidades mínimas de cada tipo de barrita.',
      );
      return;
    }

    if (
      deliveryCount < 1 ||
      deliveryCount > 365 ||
      deliveryDates.some(
        (date) => !date || Number.isNaN(new Date(date).getTime()),
      )
    ) {
      setMessage(
        'Revisa las fechas de entrega. Debes ingresar entre 1 y 365 fechas válidas.',
      );
      return;
    }

    const normalizedDeliveryDates = deliveryDates.map((date) =>
      new Date(date).toISOString(),
    );

    setSaving(true);

    const { data, error } = await supabase.rpc(
      'create_wholesale_order_schedule_custom',
      {
        p_customer: form.customer.trim(),
        p_email: form.email.trim() || null,
        p_phone: form.phone.trim() || null,
        p_address: form.address.trim(),
        p_commune: form.commune.trim() || null,
        p_frequency: form.frequency,
        p_delivery_dates: normalizedDeliveryDates,
        p_notes: form.notes.trim() || null,
        p_items: previewLines.map((line) => ({
          recipe_id: line.recipe_id,
          quantity: line.quantity,
        })),
      },
    );

    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    if (!data?.success) {
      setMessage(
        data?.message ||
          'No fue posible crear el pedido mayorista.',
      );
      return;
    }

    setMessage(
      `Pedido mayorista agendado: ${
        data.orders_created
      } entrega(s), ${totalUnits} unidades por entrega y ${money(
        data.total_per_order,
      )} por pedido. Las barritas quedaron reservadas y cualquier faltante se agregó al Plan de producción.`,
    );

    const nextDeliveryDate = nextDateTimeLocal();

    setForm({
      ...emptyOrderForm,
      delivery_date: nextDeliveryDate,
    });
    setDeliveryDates([nextDeliveryDate]);

    setLines([
      {
        recipe_id: enabledRecipes[0]?.id || '',
        quantity: 20,
      },
    ]);

    await load();
  }

  async function updateStatus(orderId, status) {
    if (!canCreate) return;

    setMessage('');

    const { error } = await supabase
      .from('wholesale_orders')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(
      status === 'cancelado'
        ? 'Pedido cancelado. La reserva de barritas fue liberada automáticamente.'
        : status === 'entregado'
          ? 'Pedido entregado. Las barritas se descontaron del stock físico y de la reserva.'
          : 'Estado del pedido actualizado. La reserva se mantiene activa.',
    );
    await load();
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Ventas al por mayor</h1>
          <p>
            Agenda pedidos únicos o recurrentes y calcula
            automáticamente los precios mayoristas.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={load}
          disabled={loading}
        >
          <RefreshCcw size={16} />
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {message && <div className="notice">{message}</div>}

      <div
        className="card"
        style={{ marginBottom: '18px' }}
      >
        <div className="card-header-inline">
          <div>
            <h3>Condiciones comerciales</h3>
            <p style={{ margin: '5px 0 0' }}>
              Pedido mínimo: 20 unidades totales por compra.
            </p>
          </div>

          <UsersRound size={28} />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '16px',
            marginTop: '18px',
          }}
        >
          <PriceTable
            title="Barritas clásicas"
            rules={PRICE_RULES.classic}
          />

          <PriceTable
            title="Rellena de frambuesa"
            rules={PRICE_RULES.filled_raspberry}
          />
        </div>
      </div>

      <div
        className="card table-card"
        style={{ marginBottom: '18px' }}
      >
        <div style={{ padding: '6px 8px 18px' }}>
          <h3 style={{ margin: 0 }}>
            Stock de barritas para ventas
          </h3>
          <p style={{ margin: '5px 0 0' }}>
            Al agendar un pedido, su cantidad se suma al stock
            reservado. La disponibilidad corresponde al stock físico
            menos todas las reservas activas.
          </p>
        </div>

        <table>
          <thead>
            <tr>
              <th>Barrita</th>
              <th>Stock físico</th>
              <th>Reservado</th>
              <th>Disponible</th>
              <th>Déficit actual</th>
            </tr>
          </thead>

          <tbody>
            {enabledRecipes.length === 0 ? (
              <tr>
                <td colSpan="5">
                  Todavía no hay recetas habilitadas para ventas
                  mayoristas.
                </td>
              </tr>
            ) : (
              enabledRecipes.map((recipe) => {
                const physical = Number(
                  recipe.finished_stock_qty || 0,
                );
                const reserved = Number(
                  recipe.reserved_stock_qty || 0,
                );
                const available = Math.max(
                  physical - reserved,
                  0,
                );
                const deficit = Math.max(
                  reserved - physical,
                  0,
                );

                return (
                  <tr key={`stock-${recipe.id}`}>
                    <td><strong>{recipe.name}</strong></td>
                    <td>{number(physical, 0)}</td>
                    <td>{number(reserved, 0)}</td>
                    <td>
                      <span className="badge ok">
                        {number(available, 0)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          deficit > 0
                            ? 'badge danger'
                            : 'badge ok'
                        }
                      >
                        {number(deficit, 0)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {canConfigure && (
        <div
          className="card"
          style={{ marginBottom: '18px' }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              setShowConfiguration((current) => !current)
            }
          >
            {showConfiguration ? (
              <ChevronUp size={16} />
            ) : (
              <ChevronDown size={16} />
            )}

            {showConfiguration
              ? 'Ocultar configuración de productos'
              : 'Configurar productos mayoristas'}
          </button>

          {showConfiguration && (
            <div
              className="card table-card"
              style={{ marginTop: '15px' }}
            >
              <table>
                <thead>
                  <tr>
                    <th>Producto / receta</th>
                    <th>Disponible al por mayor</th>
                    <th>Tipo de barrita</th>
                    <th>Acción</th>
                  </tr>
                </thead>

                <tbody>
                  {recipes.map((recipe) => (
                    <tr key={recipe.id}>
                      <td>
                        <strong>{recipe.name}</strong>
                      </td>

                      <td>
                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(
                              recipeSettings[recipe.id]
                                ?.enabled,
                            )}
                            onChange={(event) =>
                              setRecipeSettings(
                                (current) => ({
                                  ...current,
                                  [recipe.id]: {
                                    ...current[recipe.id],
                                    enabled:
                                      event.target.checked,
                                  },
                                }),
                              )
                            }
                          />
                          Sí
                        </label>
                      </td>

                      <td>
                        <select
                          value={
                            recipeSettings[recipe.id]
                              ?.category || 'classic'
                          }
                          onChange={(event) =>
                            setRecipeSettings(
                              (current) => ({
                                ...current,
                                [recipe.id]: {
                                  ...current[recipe.id],
                                  category:
                                    event.target.value,
                                },
                              }),
                            )
                          }
                        >
                          <option value="classic">
                            Barrita clásica
                          </option>
                          <option value="filled_raspberry">
                            Rellena de frambuesa
                          </option>
                        </select>
                      </td>

                      <td>
                        <button
                          type="button"
                          className="mini-button"
                          onClick={() =>
                            saveRecipeConfiguration(recipe)
                          }
                        >
                          <Save size={14} />
                          Guardar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {canCreate ? (
        <form
          className="card form-card"
          onSubmit={createSchedule}
        >
          <div className="card-header-inline">
            <div>
              <h3>Nuevo pedido mayorista</h3>
              <p style={{ margin: '5px 0 0' }}>
                Define la frecuencia, la cantidad de entregas y
                luego ajusta cada fecha de manera independiente.
              </p>
            </div>

            <PackagePlus size={27} />
          </div>

          <div className="form-grid">
            <Input
              label="Cliente o negocio"
              value={form.customer}
              onChange={(value) =>
                updateForm('customer', value)
              }
              required
            />

            <Input
              label="Correo"
              type="email"
              value={form.email}
              onChange={(value) =>
                updateForm('email', value)
              }
            />

            <Input
              label="Teléfono"
              value={form.phone}
              onChange={(value) =>
                updateForm('phone', value)
              }
            />

            <Input
              label="Comuna"
              value={form.commune}
              onChange={(value) =>
                updateForm('commune', value)
              }
              placeholder="Ejemplo: Puente Alto"
            />

            <label style={{ gridColumn: '1 / -1' }}>
              Dirección
              <input
                value={form.address}
                onChange={(event) =>
                  updateForm(
                    'address',
                    event.target.value,
                  )
                }
                placeholder="Calle, número, comuna"
                required
              />
            </label>

            <label>
              Frecuencia
              <select
                value={form.frequency}
                onChange={(event) =>
                  changeFrequency(event.target.value)
                }
              >
                <option value="one_time">
                  Una sola vez
                </option>
                <option value="daily">Diario</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
                <option value="custom">
                  Fechas personalizadas
                </option>
              </select>
            </label>

            {form.frequency !== 'one_time' && (
              <Input
                label="Cantidad de entregas"
                type="number"
                min="1"
                max="365"
                step="1"
                value={form.repeat_count}
                onChange={changeDeliveryCount}
              />
            )}
          </div>

          <div
            className="card"
            style={{
              marginTop: '18px',
              padding: '17px',
            }}
          >
            <div className="card-header-inline">
              <div>
                <h3>Fechas de las entregas</h3>
                <p style={{ margin: '5px 0 0' }}>
                  Se generan según la frecuencia y la cantidad de
                  entregas. Puedes modificar cada fecha de forma
                  independiente antes de guardar el pedido.
                </p>
              </div>

              {form.frequency !== 'one_time' &&
                form.frequency !== 'custom' && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={regenerateDeliveryDates}
                  >
                    <RefreshCcw size={15} />
                    Regenerar fechas
                  </button>
                )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(235px, 1fr))',
                gap: '12px',
                marginTop: '15px',
              }}
            >
              {deliveryDates.map((date, index) => (
                <label key={`delivery-date-${index}`}>
                  Entrega {index + 1}
                  <input
                    type="datetime-local"
                    value={date}
                    onChange={(event) =>
                      updateDeliveryDate(
                        index,
                        event.target.value,
                      )
                    }
                    required
                  />
                </label>
              ))}
            </div>

            <small
              className="field-help"
              style={{ display: 'block', marginTop: '12px' }}
            >
              {form.frequency === 'custom'
                ? 'Modo personalizado: define libremente cada día y hora.'
                : 'Las fechas propuestas son editables; no es obligatorio mantener intervalos exactos.'}
            </small>
          </div>

          <div style={{ marginTop: '20px' }}>
            <div className="card-header-inline">
              <div>
                <h3>Productos del pedido</h3>
                <p style={{ margin: '5px 0 0' }}>
                  El mínimo de 20 unidades puede combinar
                  distintos productos.
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={addLine}
                disabled={enabledRecipes.length === 0}
              >
                <Plus size={15} />
                Agregar producto
              </button>
            </div>

            {enabledRecipes.length === 0 && (
              <div className="notice">
                Primero habilita al menos una receta en
                “Configurar productos mayoristas”.
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gap: '12px',
                marginTop: '14px',
              }}
            >
              {previewLines.map((line, index) => (
                <div
                  key={`${index}-${line.recipe_id}`}
                  className="card"
                  style={{
                    padding: '15px',
                    display: 'grid',
                    gridTemplateColumns:
                      'minmax(220px, 2fr) minmax(130px, 1fr) minmax(145px, 1fr) minmax(145px, 1fr) auto',
                    gap: '12px',
                    alignItems: 'end',
                  }}
                >
                  <label>
                    Producto
                    <select
                      value={line.recipe_id}
                      onChange={(event) =>
                        updateLine(
                          index,
                          'recipe_id',
                          event.target.value,
                        )
                      }
                      required
                    >
                      <option value="">
                        Seleccionar
                      </option>

                      {enabledRecipes.map((recipe) => (
                        <option
                          key={recipe.id}
                          value={recipe.id}
                        >
                          {recipe.name} — disponible:{' '}
                          {Math.max(
                            Number(recipe.finished_stock_qty || 0) -
                              Number(recipe.reserved_stock_qty || 0),
                            0,
                          )}
                        </option>
                      ))}
                    </select>
                    {line.recipe && (
                      <small className="field-help">
                        Físico: {number(line.physical_stock, 0)} ·{' '}
                        reservado: {number(line.reserved_stock, 0)} ·{' '}
                        disponible ahora:{' '}
                        {number(line.available_stock, 0)}
                      </small>
                    )}
                  </label>

                  <label>
                    Cantidad
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(
                          index,
                          'quantity',
                          event.target.value,
                        )
                      }
                      required
                    />
                  </label>

                  <div>
                    <small>Precio unitario</small>
                    <strong
                      style={{
                        display: 'block',
                        marginTop: '8px',
                      }}
                    >
                      {line.unit_price > 0
                        ? money(line.unit_price)
                        : 'Fuera de tramo'}
                    </strong>
                  </div>

                  <div>
                    <small>Subtotal</small>
                    <strong
                      style={{
                        display: 'block',
                        marginTop: '8px',
                      }}
                    >
                      {money(line.subtotal)}
                    </strong>
                    {line.recipe && (
                      <small
                        style={{
                          display: 'block',
                          marginTop: '4px',
                          color:
                            Math.max(
                              line.reserved_stock +
                                line.quantity * deliveryCount -
                                line.physical_stock,
                              0,
                            ) > 0
                              ? '#a33a2b'
                              : undefined,
                        }}
                      >
                        Después de agendar: déficit{' '}
                        {number(
                          Math.max(
                            line.reserved_stock +
                              line.quantity * deliveryCount -
                              line.physical_stock,
                            0,
                          ),
                          0,
                        )}
                      </small>
                    )}
                  </div>

                  <button
                    type="button"
                    className="mini-button"
                    onClick={() => removeLine(index)}
                    disabled={lines.length === 1}
                    title="Quitar producto"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <label style={{ marginTop: '18px' }}>
            Observaciones
            <textarea
              rows="3"
              value={form.notes}
              onChange={(event) =>
                updateForm('notes', event.target.value)
              }
              placeholder="Forma de pago, contacto, horario u otra información."
            />
          </label>

          <div
            className="notice"
            style={{ marginTop: '18px' }}
          >
            <strong>Resumen:</strong>{' '}
            {number(totalUnits, 0)} unidades por entrega ·{' '}
            {money(totalPerOrder)} por pedido ·{' '}
            {deliveryCount} entrega(s) · total programado{' '}
            <strong>{money(scheduleTotal)}</strong>
          </div>

          <button
            type="submit"
            className="primary-button"
            disabled={
              saving ||
              enabledRecipes.length === 0 ||
              totalUnits < 20
            }
          >
            <CalendarRange size={16} />
            {saving
              ? 'Agendando...'
              : 'Agendar pedido mayorista'}
          </button>
        </form>
      ) : (
        <div className="notice">
          Tu usuario puede consultar los pedidos mayoristas.
          Solo administración o ventas puede agendarlos.
        </div>
      )}

      <div
        className="card table-card"
        style={{ marginTop: '20px' }}
      >
        <div style={{ padding: '6px 8px 18px' }}>
          <h3 style={{ margin: 0 }}>
            Pedidos mayoristas agendados
          </h3>
        </div>

        <table>
          <thead>
            <tr>
              <th>Entrega</th>
              <th>Cliente</th>
              <th>Productos</th>
              <th>Unidades</th>
              <th>Total</th>
              <th>Dirección</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8">Cargando pedidos...</td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan="8">
                  Todavía no hay pedidos mayoristas.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    {new Date(
                      order.delivery_date,
                    ).toLocaleString('es-CL')}
                    {order.recurrence_type !==
                      'one_time' && (
                      <small
                        style={{
                          display: 'block',
                          opacity: 0.65,
                        }}
                      >
                        {
                          FREQUENCY_LABELS[
                            order.recurrence_type
                          ]
                        }{' '}
                        · entrega {order.occurrence_number}
                      </small>
                    )}
                  </td>

                  <td>
                    <strong>{order.customer}</strong>
                    {order.phone && (
                      <small
                        style={{
                          display: 'block',
                          opacity: 0.65,
                        }}
                      >
                        {order.phone}
                      </small>
                    )}
                  </td>

                  <td>
                    {(order.wholesale_order_items || [])
                      .map(
                        (item) =>
                          `${item.recipes?.name || 'Producto'} (${
                            item.quantity
                          })`,
                      )
                      .join(', ')}
                  </td>

                  <td>{order.total_units}</td>
                  <td>{money(order.total_amount)}</td>

                  <td>
                    {order.address}
                    {order.commune && (
                      <small
                        style={{
                          display: 'block',
                          opacity: 0.65,
                        }}
                      >
                        {order.commune}
                      </small>
                    )}
                  </td>

                  <td>
                    <span
                      className={`badge ${statusClass(
                        order.status,
                      )}`}
                    >
                      {statusLabel(order.status)}
                    </span>
                  </td>

                  <td>
                    {canCreate && (
                      <select
                        value={order.status}
                        onChange={(event) =>
                          updateStatus(
                            order.id,
                            event.target.value,
                          )
                        }
                      >
                        <option value="pendiente">
                          Pendiente
                        </option>
                        <option value="en_produccion">
                          En producción
                        </option>
                        <option value="listo">Listo</option>
                        <option value="entregado">
                          Entregado
                        </option>
                        <option value="cancelado">
                          Cancelado
                        </option>
                      </select>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PriceTable({ title, rules }) {
  return (
    <div
      style={{
        border: '1px solid rgba(124, 74, 39, 0.16)',
        borderRadius: '16px',
        padding: '16px',
      }}
    >
      <h4 style={{ marginTop: 0 }}>{title}</h4>

      {rules.map((rule) => (
        <div
          key={`${title}-${rule.label}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '8px 0',
            borderBottom:
              '1px solid rgba(124, 74, 39, 0.1)',
          }}
        >
          <span>{rule.label} unidades</span>
          <strong>{money(rule.price)} c/u</strong>
        </div>
      ))}
    </div>
  );
}

function Input({ label, value, onChange, ...props }) {
  return (
    <label>
      {label}
      <input
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        {...props}
      />
    </label>
  );
}