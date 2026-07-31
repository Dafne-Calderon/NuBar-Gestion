import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Factory,
  PackageCheck,
  Plus,
  RefreshCcw,
  Save,
  ShoppingBag,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { money, number } from '../utils/calculations.js';

const MODE_LABELS = {
  daily: 'Día',
  weekly: 'Semana',
  monthly: 'Mes',
};

const FREQUENCY_LABELS = {
  one_time: 'Una sola vez',
  daily: 'Diario',
  weekly: 'Semanal',
  monthly: 'Mensual',
};

const emptyOrderForm = {
  customer: '',
  recipe_id: '',
  quantity_bars: 20,
  delivery_date: nextDateTimeLocal(),
  address: '',
  notes: '',
  frequency: 'one_time',
  repeat_count: 1,
};

function todayInput() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}`;
}

function nextDateTimeLocal() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);

  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function localDate(value) {
  const [year, month, day] = value.split('-').map(Number);

  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dateRange(mode, referenceValue) {
  const reference = localDate(referenceValue);
  let start;
  let end;

  if (mode === 'daily') {
    start = new Date(reference);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  } else if (mode === 'weekly') {
    const isoDay =
      reference.getDay() === 0 ? 7 : reference.getDay();

    start = new Date(reference);
    start.setDate(start.getDate() - (isoDay - 1));
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(end.getDate() + 7);
  } else {
    start = new Date(
      reference.getFullYear(),
      reference.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );

    end = new Date(
      reference.getFullYear(),
      reference.getMonth() + 1,
      1,
      0,
      0,
      0,
      0,
    );
  }

  return { start, end };
}

function rangeLabel(start, end) {
  const last = new Date(end);
  last.setMilliseconds(last.getMilliseconds() - 1);

  const formatter = new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
  });

  return `${formatter.format(start)} — ${formatter.format(
    last,
  )}`;
}

function addFrequency(date, frequency, index) {
  const result = new Date(date);

  if (frequency === 'daily') {
    result.setDate(result.getDate() + index);
  } else if (frequency === 'weekly') {
    result.setDate(result.getDate() + index * 7);
  } else if (frequency === 'monthly') {
    result.setMonth(result.getMonth() + index);
  }

  return result;
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

export default function ProductionForecast() {
  const { user, profile } = useAuth();

  const [mode, setMode] = useState('weekly');
  const [referenceDate, setReferenceDate] = useState(
    todayInput(),
  );
  const [bufferPercent, setBufferPercent] = useState(() =>
    Number(localStorage.getItem('nubar-production-buffer') || 5),
  );
  const [recipes, setRecipes] = useState([]);
  const [regularOrders, setRegularOrders] = useState([]);
  const [wholesaleOrders, setWholesaleOrders] = useState([]);
  const [productionLogs, setProductionLogs] = useState([]);
  const [stockDrafts, setStockDrafts] = useState({});
  const [orderForm, setOrderForm] = useState(emptyOrderForm);
  const [selectedRecipeId, setSelectedRecipeId] = useState('');
  const [quantityToProduce, setQuantityToProduce] = useState(0);
  const [productionNotes, setProductionNotes] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [producing, setProducing] = useState(false);

  const canSchedule = ['admin', 'ventas', 'produccion'].includes(
    profile?.role,
  );
  const canProduce = ['admin', 'produccion'].includes(
    profile?.role,
  );

  const range = useMemo(
    () => dateRange(mode, referenceDate),
    [mode, referenceDate],
  );

  useEffect(() => {
    localStorage.setItem(
      'nubar-production-buffer',
      String(bufferPercent),
    );
  }, [bufferPercent]);

  useEffect(() => {
    load();
  }, [mode, referenceDate]);

  async function load(preferredRecipeId = selectedRecipeId) {
    setLoading(true);
    setMessage('');

    const recipesPromise = supabase
      .from('recipes')
      .select('*, recipe_items(*, ingredients(*))')
      .eq('active', true)
      .order('name');

    const regularPromise = supabase
      .from('orders')
      .select(
        'id, recipe_id, quantity_bars, customer, delivery_date, address, notes, status, recipes(id, name, bars_per_batch)',
      )
      .lt('delivery_date', range.end.toISOString())
      .not('status', 'in', '("cancelado","entregado")')
      .order('delivery_date');

    const wholesalePromise = supabase
      .from('wholesale_orders')
      .select(
        'id, customer, delivery_date, address, commune, status, wholesale_order_items(recipe_id, quantity, recipes(id, name, bars_per_batch))',
      )
      .lt('delivery_date', range.end.toISOString())
      .not('status', 'in', '("cancelado","entregado")')
      .order('delivery_date');

    const logsPromise = supabase
      .from('production_logs')
      .select('*, recipes(name)')
      .order('produced_at', { ascending: false })
      .limit(20);

    const [
      recipesResult,
      regularResult,
      wholesaleResult,
      logsResult,
    ] = await Promise.all([
      recipesPromise,
      regularPromise,
      wholesalePromise,
      logsPromise,
    ]);

    setLoading(false);

    if (recipesResult.error || regularResult.error) {
      setMessage(
        (recipesResult.error || regularResult.error).message,
      );
      return;
    }

    const loadedRecipes = recipesResult.data || [];
    setRecipes(loadedRecipes);
    setStockDrafts(
      Object.fromEntries(
        loadedRecipes.map((recipe) => [
          recipe.id,
          Number(recipe.finished_stock_qty || 0),
        ]),
      ),
    );
    setRegularOrders(regularResult.data || []);

    if (wholesaleResult.error) {
      setWholesaleOrders([]);
    } else {
      setWholesaleOrders(wholesaleResult.data || []);
    }

    if (!logsResult.error) {
      setProductionLogs(logsResult.data || []);
    }

    const recipeId =
      loadedRecipes.find(
        (recipe) => recipe.id === preferredRecipeId,
      )?.id ||
      loadedRecipes[0]?.id ||
      '';

    if (recipeId) {
      setSelectedRecipeId(recipeId);
    }

    setOrderForm((current) => ({
      ...current,
      recipe_id:
        current.recipe_id || loadedRecipes[0]?.id || '',
    }));
  }

  const forecast = useMemo(() => {
    const byRecipe = new Map();

    function ensure(recipeId, recipe) {
      if (!recipeId) return null;

      if (!byRecipe.has(recipeId)) {
        const fullRecipe = recipes.find(
          (item) => item.id === recipeId,
        );

        byRecipe.set(recipeId, {
          recipe_id: recipeId,
          recipe: fullRecipe || recipe || null,
          name: fullRecipe?.name || recipe?.name || 'Receta',
          bars_per_batch: Math.max(
            Number(
              fullRecipe?.bars_per_batch ||
                recipe?.bars_per_batch ||
                1,
            ),
            1,
          ),
          physical_stock: Number(
            fullRecipe?.finished_stock_qty || 0,
          ),
          reserved_stock: Number(
            fullRecipe?.reserved_stock_qty || 0,
          ),
          committed_before_end: 0,
          pending: 0,
          in_production: 0,
          ready: 0,
          total: 0,
          normal_order_ids: [],
          wholesale_order_ids: [],
          deliveries: [],
        });
      }

      return byRecipe.get(recipeId);
    }

    function add({
      recipeId,
      recipe,
      quantity,
      status,
      type,
      orderId,
      customer,
      deliveryDate,
    }) {
      const row = ensure(recipeId, recipe);
      if (!row) return;

      const qty = Number(quantity || 0);
      const delivery = new Date(deliveryDate);
      const isInsidePeriod =
        delivery >= range.start && delivery < range.end;
      const isCommitted = [
        'pendiente',
        'en_produccion',
        'listo',
      ].includes(status);

      if (isCommitted) {
        row.committed_before_end += qty;
      }

      if (status === 'pendiente') {
        if (type === 'normal') {
          row.normal_order_ids.push(orderId);
        } else {
          row.wholesale_order_ids.push(orderId);
        }
      }

      if (!isInsidePeriod) return;

      row.total += qty;

      if (status === 'en_produccion') {
        row.in_production += qty;
      } else if (status === 'listo') {
        row.ready += qty;
      } else if (status === 'pendiente') {
        row.pending += qty;
      }

      row.deliveries.push({
        id: `${type}-${orderId}-${recipeId}`,
        order_id: orderId,
        type,
        customer,
        delivery_date: deliveryDate,
        quantity: qty,
        status,
      });
    }

    regularOrders.forEach((order) => {
      add({
        recipeId: order.recipe_id,
        recipe: order.recipes,
        quantity: order.quantity_bars,
        status: order.status,
        type: 'normal',
        orderId: order.id,
        customer: order.customer,
        deliveryDate: order.delivery_date,
      });
    });

    wholesaleOrders.forEach((order) => {
      (order.wholesale_order_items || []).forEach((item) => {
        add({
          recipeId: item.recipe_id,
          recipe: item.recipes,
          quantity: item.quantity,
          status: order.status,
          type: 'wholesale',
          orderId: order.id,
          customer: order.customer,
          deliveryDate: order.delivery_date,
        });
      });
    });

    recipes.forEach((recipe) => ensure(recipe.id, recipe));

    return Array.from(byRecipe.values())
      .map((row) => {
        const availableStock = Math.max(
          row.physical_stock - row.reserved_stock,
          0,
        );
        const globalDeficit = Math.max(
          row.reserved_stock - row.physical_stock,
          0,
        );
        const stockDeficit = Math.max(
          row.committed_before_end - row.physical_stock,
          0,
        );
        const recommendedExact = Math.ceil(
          stockDeficit *
            (1 + Math.max(Number(bufferPercent || 0), 0) / 100),
        );
        const recommendedBatches =
          recommendedExact > 0
            ? Math.ceil(recommendedExact / row.bars_per_batch)
            : 0;
        const recommendedQuantity =
          recommendedBatches * row.bars_per_batch;

        return {
          ...row,
          available_stock: availableStock,
          global_deficit: globalDeficit,
          stock_deficit: stockDeficit,
          recommended_exact: recommendedExact,
          recommended_batches: recommendedBatches,
          recommended_quantity: recommendedQuantity,
          extra_quantity: Math.max(
            recommendedQuantity - stockDeficit,
            0,
          ),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [
    regularOrders,
    wholesaleOrders,
    recipes,
    bufferPercent,
    range.start,
    range.end,
  ]);

  const selectedPlan = useMemo(
    () =>
      forecast.find(
        (row) => row.recipe_id === selectedRecipeId,
      ) || null,
    [forecast, selectedRecipeId],
  );

  useEffect(() => {
    if (!selectedPlan) return;

    setQuantityToProduce((current) => {
      if (current > 0 && selectedPlan.recipe_id === selectedRecipeId) {
        return current;
      }

      return (
        selectedPlan.recommended_quantity ||
        selectedPlan.bars_per_batch ||
        1
      );
    });
  }, [selectedRecipeId, selectedPlan?.recommended_quantity]);

  const inventoryCalculation = useMemo(() => {
    const recipe = selectedPlan?.recipe;
    const quantity = Math.max(
      Number(quantityToProduce || 0),
      0,
    );

    if (!recipe) {
      return {
        rows: [],
        hasShortages: false,
      };
    }

    const baseBars = Math.max(
      Number(recipe.bars_per_batch || 1),
      1,
    );

    const rows = (recipe.recipe_items || []).map((item) => {
      const needed =
        (Number(item.grams_per_batch || 0) * quantity) /
        baseBars;
      const stock = Number(item.ingredients?.stock_qty || 0);

      return {
        id: item.id,
        name: item.ingredients?.name || 'Ingrediente',
        unit: item.ingredients?.unit || 'g',
        base: Number(item.grams_per_batch || 0),
        needed,
        stock,
        missing: Math.max(needed - stock, 0),
      };
    });

    return {
      rows,
      hasShortages: rows.some((row) => row.missing > 0),
    };
  }, [selectedPlan, quantityToProduce]);

  const totals = useMemo(
    () =>
      forecast.reduce(
        (summary, row) => ({
          total: summary.total + row.total,
          pending: summary.pending + row.pending,
          in_production:
            summary.in_production + row.in_production,
          ready: summary.ready + row.ready,
          physical: summary.physical + row.physical_stock,
          reserved: summary.reserved + row.reserved_stock,
          available: summary.available + row.available_stock,
          deficit: summary.deficit + row.global_deficit,
          recommended:
            summary.recommended + row.recommended_quantity,
        }),
        {
          total: 0,
          pending: 0,
          in_production: 0,
          ready: 0,
          physical: 0,
          reserved: 0,
          available: 0,
          deficit: 0,
          recommended: 0,
        },
      ),
    [forecast],
  );

  async function setPhysicalStock(recipeId) {
    if (!canProduce) return;

    const quantity = Number(stockDrafts[recipeId]);

    if (!Number.isInteger(quantity) || quantity < 0) {
      setMessage(
        'El stock físico debe ser un número entero igual o mayor que cero.',
      );
      return;
    }

    setMessage('');

    const { data, error } = await supabase.rpc(
      'set_finished_stock',
      {
        p_recipe_id: recipeId,
        p_physical_qty: quantity,
        p_note: 'Ajuste manual desde Plan de producción.',
      },
    );

    if (error || !data?.success) {
      setMessage(
        data?.message ||
          error?.message ||
          'No fue posible ajustar el stock físico.',
      );
      return;
    }

    setMessage(
      `Stock físico actualizado a ${number(
        data.physical_stock,
        0,
      )} barritas.`,
    );

    await load(recipeId);
  }

  function updateOrderForm(field, value) {
    setOrderForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function scheduleOrder(event) {
    event.preventDefault();
    setMessage('');

    if (!canSchedule) {
      setMessage('No tienes permisos para agendar pedidos.');
      return;
    }

    if (
      !orderForm.customer.trim() ||
      !orderForm.recipe_id ||
      !orderForm.delivery_date ||
      !orderForm.address.trim()
    ) {
      setMessage(
        'Completa cliente, receta, fecha y dirección.',
      );
      return;
    }

    const quantity = Number(orderForm.quantity_bars || 0);
    const repeatCount =
      orderForm.frequency === 'one_time'
        ? 1
        : Number(orderForm.repeat_count || 1);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setMessage(
        'La cantidad de barritas debe ser un número entero mayor que cero.',
      );
      return;
    }

    if (
      !Number.isInteger(repeatCount) ||
      repeatCount < 1 ||
      repeatCount > 365
    ) {
      setMessage(
        'La cantidad de entregas debe estar entre 1 y 365.',
      );
      return;
    }

    const firstDate = new Date(orderForm.delivery_date);

    const rows = Array.from({ length: repeatCount }, (_, index) => ({
      recipe_id: orderForm.recipe_id,
      quantity_bars: quantity,
      customer: orderForm.customer.trim(),
      delivery_date: addFrequency(
        firstDate,
        orderForm.frequency,
        index,
      ).toISOString(),
      address: orderForm.address.trim(),
      notes: [
        orderForm.notes.trim(),
        orderForm.frequency !== 'one_time'
          ? `Pedido recurrente: ${FREQUENCY_LABELS[
              orderForm.frequency
            ]}, entrega ${index + 1} de ${repeatCount}.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      status: 'pendiente',
      created_by: user?.id || null,
    }));

    setSavingOrder(true);

    const { error } = await supabase.from('orders').insert(rows);

    setSavingOrder(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(
      `${repeatCount} pedido(s) agendado(s) correctamente. Las barritas quedaron reservadas y la recomendación de producción se actualizó usando solamente el faltante real.`,
    );

    setOrderForm({
      ...emptyOrderForm,
      recipe_id: orderForm.recipe_id,
      delivery_date: nextDateTimeLocal(),
    });

    await load(orderForm.recipe_id);
  }

  function choosePlan(row) {
    setSelectedRecipeId(row.recipe_id);
    setQuantityToProduce(
      row.recommended_quantity || row.bars_per_batch,
    );
    setProductionNotes(
      row.stock_deficit > 0
        ? `Producción recomendada para cubrir un faltante real de ${row.stock_deficit} barritas hasta ${rangeLabel(
            range.start,
            range.end,
          )}. El cálculo ya descontó el stock físico disponible.`
        : '',
    );

    setTimeout(() => {
      document
        .getElementById('production-execution')
        ?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
    }, 0);
  }

  async function produceSelectedRecipe() {
    setMessage('');

    if (!canProduce || !selectedPlan) {
      setMessage(
        'Solo administración o producción puede registrar una elaboración.',
      );
      return;
    }

    const quantity = Number(quantityToProduce || 0);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setMessage(
        'La cantidad a producir debe ser un número entero mayor que cero.',
      );
      return;
    }

    if (
      selectedPlan.stock_deficit > 0 &&
      quantity < selectedPlan.stock_deficit
    ) {
      setMessage(
        `El faltante real es de ${selectedPlan.stock_deficit} barritas. Produce al menos esa cantidad para cubrir los compromisos hasta el final del período.`,
      );
      return;
    }

    if (inventoryCalculation.hasShortages) {
      setMessage(
        'No puedes iniciar la producción porque faltan ingredientes.',
      );
      return;
    }

    const confirmed = window.confirm(
      `¿Producir ${quantity} barritas de ${selectedPlan.name}? Se descontarán automáticamente los ingredientes del inventario.`,
    );

    if (!confirmed) return;

    setProducing(true);

    const { data, error } = await supabase.rpc('produce_recipe', {
      p_recipe_id: selectedPlan.recipe_id,
      p_quantity_bars: quantity,
      p_notes:
        productionNotes.trim() ||
        `Producción desde Plan de producción. Período: ${rangeLabel(
          range.start,
          range.end,
        )}.`,
    });

    if (error || !data?.success) {
      setProducing(false);
      setMessage(
        data?.message ||
          error?.message ||
          'No fue posible registrar la producción.',
      );
      return;
    }

    const normalIds = selectedPlan.normal_order_ids || [];
    const wholesaleIds = selectedPlan.wholesale_order_ids || [];

    const updates = [];

    if (normalIds.length > 0) {
      updates.push(
        supabase
          .from('orders')
          .update({ status: 'en_produccion' })
          .in('id', normalIds),
      );
    }

    if (wholesaleIds.length > 0) {
      updates.push(
        supabase
          .from('wholesale_orders')
          .update({
            status: 'en_produccion',
            updated_at: new Date().toISOString(),
          })
          .in('id', wholesaleIds),
      );
    }

    await Promise.all(updates);

    if (data.production_id) {
      await supabase
        .from('production_logs')
        .update({
          planned_for: range.start.toISOString(),
          safety_percent: Number(bufferPercent || 0),
          source: 'planificacion',
        })
        .eq('id', data.production_id);

      const links = [
        ...normalIds.map((orderId) => ({
          production_id: data.production_id,
          order_type: 'normal',
          order_id: orderId,
        })),
        ...wholesaleIds.map((orderId) => ({
          production_id: data.production_id,
          order_type: 'wholesale',
          order_id: orderId,
        })),
      ];

      if (links.length > 0) {
        await supabase
          .from('production_order_links')
          .insert(links);
      }
    }

    setProducing(false);
    setProductionNotes('');
    setMessage(
      `Producción registrada: ${quantity} barritas de ${selectedPlan.name}. Los ingredientes fueron descontados, el stock físico aumentó y los pedidos asociados pasaron a “En producción”.`,
    );

    await load(selectedPlan.recipe_id);
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Planificación de producción</h1>
          <p>
            Agenda pedidos por fecha, calcula la demanda y produce
            directamente desde una sola sección.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={() => load()}
          disabled={loading}
        >
          <RefreshCcw size={16} />
          {loading ? 'Calculando...' : 'Actualizar'}
        </button>
      </div>

      {message && <div className="notice">{message}</div>}

      {canSchedule && (
        <form className="card form-card" onSubmit={scheduleOrder}>
          <div className="card-header-inline">
            <div>
              <h3>Agendar pedido para producción</h3>
              <p style={{ margin: '5px 0 0' }}>
                El pedido aparecerá automáticamente en la demanda del
                día, semana o mes correspondiente.
              </p>
            </div>

            <ShoppingBag size={27} />
          </div>

          <div className="form-grid">
            <Input
              label="Cliente"
              value={orderForm.customer}
              onChange={(value) =>
                updateOrderForm('customer', value)
              }
              required
            />

            <label>
              Barrita / receta
              <select
                value={orderForm.recipe_id}
                onChange={(event) =>
                  updateOrderForm(
                    'recipe_id',
                    event.target.value,
                  )
                }
                required
              >
                <option value="">Seleccionar receta</option>

                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
              </select>
            </label>

            <Input
              label="Cantidad de barritas"
              type="number"
              min="1"
              step="1"
              value={orderForm.quantity_bars}
              onChange={(value) =>
                updateOrderForm('quantity_bars', value)
              }
              required
            />

            <label>
              Primera fecha de entrega
              <input
                type="datetime-local"
                value={orderForm.delivery_date}
                onChange={(event) =>
                  updateOrderForm(
                    'delivery_date',
                    event.target.value,
                  )
                }
                required
              />
            </label>

            <label>
              Frecuencia
              <select
                value={orderForm.frequency}
                onChange={(event) =>
                  updateOrderForm(
                    'frequency',
                    event.target.value,
                  )
                }
              >
                <option value="one_time">
                  Una sola vez
                </option>
                <option value="daily">Diario</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
              </select>
            </label>

            {orderForm.frequency !== 'one_time' && (
              <Input
                label="Cantidad de entregas"
                type="number"
                min="1"
                max="365"
                step="1"
                value={orderForm.repeat_count}
                onChange={(value) =>
                  updateOrderForm('repeat_count', value)
                }
              />
            )}

            <label style={{ gridColumn: '1 / -1' }}>
              Dirección
              <input
                value={orderForm.address}
                onChange={(event) =>
                  updateOrderForm(
                    'address',
                    event.target.value,
                  )
                }
                placeholder="Calle, número y comuna"
                required
              />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              Observaciones
              <textarea
                rows="2"
                value={orderForm.notes}
                onChange={(event) =>
                  updateOrderForm('notes', event.target.value)
                }
              />
            </label>
          </div>

          <button
            type="submit"
            className="primary-button"
            disabled={savingOrder || recipes.length === 0}
          >
            <Plus size={16} />
            {savingOrder ? 'Agendando...' : 'Agendar pedido'}
          </button>
        </form>
      )}

      <div className="card form-card" style={{ marginTop: '18px' }}>
        <div className="form-grid">
          <label>
            Vista de planificación
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="daily">Diaria</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensual</option>
            </select>
          </label>

          <label>
            Fecha de referencia
            <input
              type="date"
              value={referenceDate}
              onChange={(event) =>
                setReferenceDate(event.target.value)
              }
            />
          </label>

          <label>
            Margen preventivo (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={bufferPercent}
              onChange={(event) =>
                setBufferPercent(event.target.value)
              }
            />
            <small className="field-help">
              Se agrega a la demanda antes de redondear por lotes.
            </small>
          </label>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              paddingTop: '24px',
            }}
          >
            <CalendarDays size={20} />
            <div>
              <small>{MODE_LABELS[mode]} seleccionado</small>
              <strong style={{ display: 'block' }}>
                {rangeLabel(range.start, range.end)}
              </strong>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '14px',
          margin: '18px 0',
        }}
      >
        <ForecastKpi
          label="Demanda del período"
          value={totals.total}
        />
        <ForecastKpi
          label="Stock físico"
          value={totals.physical}
        />
        <ForecastKpi
          label="Stock reservado"
          value={totals.reserved}
        />
        <ForecastKpi
          label="Disponible para nuevas ventas"
          value={totals.available}
        />
        <ForecastKpi
          label="Déficit comprometido"
          value={totals.deficit}
          emphasis
        />
        <ForecastKpi
          label="Producción recomendada"
          value={totals.recommended}
        />
      </div>

      <div className="card table-card" style={{ marginBottom: '18px' }}>
        <div style={{ padding: '6px 8px 18px' }}>
          <h3 style={{ margin: 0 }}>
            Inventario de barritas terminadas
          </h3>
          <p style={{ margin: '5px 0 0' }}>
            Físico es lo realmente producido. Reservado corresponde a
            pedidos activos. Disponible es físico menos reservado.
          </p>
        </div>

        <table>
          <thead>
            <tr>
              <th>Barrita</th>
              <th>Stock físico</th>
              <th>Reservado</th>
              <th>Disponible</th>
              <th>Déficit</th>
              <th>Ajustar stock físico</th>
            </tr>
          </thead>

          <tbody>
            {forecast.map((row) => (
              <tr key={`stock-${row.recipe_id}`}>
                <td><strong>{row.name}</strong></td>
                <td>{number(row.physical_stock, 0)}</td>
                <td>{number(row.reserved_stock, 0)}</td>
                <td>
                  <span className="badge ok">
                    {number(row.available_stock, 0)}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      row.global_deficit > 0
                        ? 'badge danger'
                        : 'badge ok'
                    }
                  >
                    {number(row.global_deficit, 0)}
                  </span>
                </td>
                <td>
                  {canProduce ? (
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'center',
                        minWidth: '210px',
                      }}
                    >
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={stockDrafts[row.recipe_id] ?? 0}
                        onChange={(event) =>
                          setStockDrafts((current) => ({
                            ...current,
                            [row.recipe_id]: event.target.value,
                          }))
                        }
                        style={{ maxWidth: '105px' }}
                      />
                      <button
                        type="button"
                        className="mini-button"
                        onClick={() =>
                          setPhysicalStock(row.recipe_id)
                        }
                      >
                        <Save size={14} />
                        Guardar
                      </button>
                    </div>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Barrita / receta</th>
              <th>Demanda período</th>
              <th>Comprometido hasta fin período</th>
              <th>Stock físico</th>
              <th>Faltante real</th>
              <th>Margen / redondeo</th>
              <th>Recomendación</th>
              <th>Acción</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8">
                  Calculando planificación...
                </td>
              </tr>
            ) : forecast.length === 0 ? (
              <tr>
                <td colSpan="8">
                  No hay recetas activas ni pedidos en este período.
                </td>
              </tr>
            ) : (
              forecast.map((row) => (
                <tr key={row.recipe_id}>
                  <td>
                    <strong>{row.name}</strong>
                    <small
                      style={{
                        display: 'block',
                        opacity: 0.65,
                      }}
                    >
                      {number(row.bars_per_batch, 0)} por lote
                    </small>
                  </td>
                  <td>{number(row.total, 0)}</td>
                  <td>{number(row.committed_before_end, 0)}</td>
                  <td>{number(row.physical_stock, 0)}</td>
                  <td>
                    <span
                      className={
                        row.stock_deficit > 0
                          ? 'badge danger'
                          : 'badge ok'
                      }
                    >
                      {number(row.stock_deficit, 0)}
                    </span>
                  </td>
                  <td>+{number(row.extra_quantity, 0)}</td>
                  <td>
                    <span
                      className={
                        row.stock_deficit > 0
                          ? 'badge neutral'
                          : 'badge ok'
                      }
                    >
                      {row.stock_deficit > 0
                        ? `Producir ${number(
                            row.recommended_quantity,
                            0,
                          )}`
                        : 'Cubierto con stock'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => choosePlan(row)}
                    >
                      <Factory size={14} />
                      Preparar producción
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedPlan && (
        <div
          id="production-execution"
          className="card form-card"
          style={{ marginTop: '20px' }}
        >
          <div className="card-header-inline">
            <div>
              <h3>Producción: {selectedPlan.name}</h3>
              <p style={{ margin: '5px 0 0' }}>
                Stock físico: {number(selectedPlan.physical_stock, 0)} ·
                comprometido hasta fin del período:{' '}
                {number(selectedPlan.committed_before_end, 0)} ·
                faltante real: {number(selectedPlan.stock_deficit, 0)} ·
                recomendación: {number(selectedPlan.recommended_quantity, 0)}
                {' '}barritas en{' '}
                {number(selectedPlan.recommended_batches, 0)} lote(s).
              </p>
            </div>

            <PackageCheck size={28} />
          </div>

          <div className="form-grid">
            <label>
              Receta
              <select
                value={selectedRecipeId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const nextPlan = forecast.find(
                    (row) => row.recipe_id === nextId,
                  );

                  setSelectedRecipeId(nextId);
                  setQuantityToProduce(
                    nextPlan?.recommended_quantity ||
                      nextPlan?.bars_per_batch ||
                      1,
                  );
                }}
              >
                {forecast.map((row) => (
                  <option
                    key={row.recipe_id}
                    value={row.recipe_id}
                  >
                    {row.name}
                  </option>
                ))}
              </select>
            </label>

            <Input
              label="Cantidad a producir"
              type="number"
              min="1"
              step="1"
              value={quantityToProduce}
              onChange={setQuantityToProduce}
            />

            <div style={{ paddingTop: '24px' }}>
              <span className="chip active">
                {selectedPlan.bars_per_batch > 0
                  ? `${number(
                      Math.ceil(
                        Number(quantityToProduce || 0) /
                          selectedPlan.bars_per_batch,
                      ),
                      0,
                    )} lote(s)`
                  : '-'}
              </span>
            </div>

            <label style={{ gridColumn: '1 / -1' }}>
              Nota de producción
              <textarea
                rows="2"
                value={productionNotes}
                onChange={(event) =>
                  setProductionNotes(event.target.value)
                }
              />
            </label>
          </div>

          <div className="card table-card compact-table">
            <table>
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Base</th>
                  <th>Necesario</th>
                  <th>Stock</th>
                  <th>Faltante</th>
                </tr>
              </thead>

              <tbody>
                {inventoryCalculation.rows.length === 0 ? (
                  <tr>
                    <td colSpan="5">
                      La receta no tiene ingredientes configurados.
                    </td>
                  </tr>
                ) : (
                  inventoryCalculation.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>{number(row.base, 1)} g</td>
                      <td>{number(row.needed, 1)} g</td>
                      <td>
                        {number(row.stock, 1)} {row.unit}
                      </td>
                      <td>
                        <span
                          className={
                            row.missing > 0
                              ? 'badge danger'
                              : 'badge ok'
                          }
                        >
                          {row.missing > 0
                            ? `Faltan ${number(
                                row.missing,
                                1,
                              )} ${row.unit}`
                            : 'Disponible'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div
            className="notice"
            style={{ marginTop: '16px' }}
          >
            <strong>Pedidos pendientes asociados hasta el final del período:</strong>{' '}
            {selectedPlan.normal_order_ids.length} normales y{' '}
            {selectedPlan.wholesale_order_ids.length} mayoristas.
            La recomendación solo fabrica el faltante después de considerar
            el stock físico existente.
          </div>

          {canProduce && (
            <button
              type="button"
              className="primary-button"
              onClick={produceSelectedRecipe}
              disabled={
                producing ||
                inventoryCalculation.hasShortages ||
                inventoryCalculation.rows.length === 0
              }
            >
              <Factory size={16} />
              {producing
                ? 'Produciendo...'
                : `Producir ${number(
                    quantityToProduce,
                    0,
                  )} barritas`}
            </button>
          )}
        </div>
      )}

      <div
        className="card table-card"
        style={{ marginTop: '20px' }}
      >
        <div style={{ padding: '6px 8px 18px' }}>
          <h3 style={{ margin: 0 }}>Producciones recientes</h3>
          <p style={{ margin: '5px 0 0' }}>
            Registro de elaboraciones que ya descontaron inventario.
          </p>
        </div>

        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Receta</th>
              <th>Cantidad</th>
              <th>Estado</th>
              <th>Notas</th>
            </tr>
          </thead>

          <tbody>
            {productionLogs.length === 0 ? (
              <tr>
                <td colSpan="5">
                  Todavía no hay producciones registradas.
                </td>
              </tr>
            ) : (
              productionLogs.map((log) => (
                <tr key={log.id}>
                  <td>
                    {new Date(
                      log.produced_at || log.created_at,
                    ).toLocaleString('es-CL')}
                  </td>
                  <td>
                    <strong>
                      {log.recipes?.name || 'Receta'}
                    </strong>
                  </td>
                  <td>{number(log.quantity_bars, 0)}</td>
                  <td>
                    <span className="badge ok">
                      <CheckCircle2 size={13} />
                      Registrada
                    </span>
                  </td>
                  <td>{log.notes || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="notice" style={{ marginTop: '16px' }}>
        <Factory size={18} />
        <span>
          La cantidad recomendada considera todos los pedidos activos
          hasta el final del período, resta el stock físico terminado y
          fabrica solamente el déficit. Al agendar un pedido se reserva
          stock; al cancelarlo se libera, y al entregarlo se descuenta del
          stock físico.
        </span>
      </div>
    </section>
  );
}

function ForecastKpi({ label, value, emphasis = false }) {
  return (
    <div
      className="card"
      style={{
        padding: '18px',
        border: emphasis
          ? '2px solid rgba(124, 74, 39, 0.35)'
          : undefined,
      }}
    >
      <small>{label}</small>
      <strong
        style={{
          display: 'block',
          fontSize: '1.8rem',
          marginTop: '7px',
        }}
      >
        {number(value, 0)}
      </strong>
    </div>
  );
}

function Input({ label, value, onChange, ...props }) {
  return (
    <label>
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </label>
  );
}