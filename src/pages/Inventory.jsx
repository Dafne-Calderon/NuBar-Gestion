import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileText,
  PackagePlus,
  Printer,
  RefreshCcw,
  Save,
  Wrench,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  ingredientPricePerKg,
  isLegacyInflatedIngredientPrice,
  money,
} from '../utils/calculations.js';

const emptyForm = {
  name: '',
  unit: 'g',
  stock_qty: 0,
  min_stock: 0,
  unit_cost: 0,
  price_per_kg: 0,
  supplier: '',
  kcal_100g: 0,
  protein_100g: 0,
  carbs_100g: 0,
  sugars_100g: 0,
  fat_100g: 0,
  sat_fat_100g: 0,
  trans_fat_100g: 0,
  fiber_100g: 0,
  sodium_mg_100g: 0,
};

const emptyStockForm = {
  ingredient_id: '',
  quantity: '',
  price_per_kg: '',
  supplier: '',
  note: '',
};

export default function Inventory() {
  const { user, profile } = useAuth();

  const [items, setItems] = useState([]);
  const [movements, setMovements] = useState([]);
  const [detectedPrices, setDetectedPrices] = useState({});
  const [form, setForm] = useState(emptyForm);
  const [stockForm, setStockForm] = useState(emptyStockForm);
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState('todos');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingStock, setSavingStock] = useState(false);

  // Solo ADMIN puede crear productos, editarlos y agregar stock.
  const canEdit = profile?.role === 'admin';

  useEffect(() => {
    load();
  }, []);

  const selectedStockItem = useMemo(
    () =>
      items.find(
        (item) => item.id === stockForm.ingredient_id,
      ) || null,
    [items, stockForm.ingredient_id],
  );

  async function load() {
    setLoading(true);

    const [
      { data: ingredientData, error: ingredientError },
      { data: movementData, error: movementError },
    ] = await Promise.all([
      supabase
        .from('ingredients')
        .select('*')
        .order('name'),
      supabase
        .from('inventory_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (ingredientError) {
      setMessage(ingredientError.message);
      setLoading(false);
      return;
    }

    if (movementError) {
      setMessage(
        `${movementError.message}. Ejecuta primero el archivo SQL incluido para habilitar las entradas de inventario.`,
      );
      setLoading(false);
      return;
    }

    const ingredientList = ingredientData || [];
    const movementList = movementData || [];

    const profileIds = [
      ...new Set(
        [
          ...ingredientList.map((item) => item.created_by),
          ...movementList.map((movement) => movement.created_by),
        ].filter(Boolean),
      ),
    ];

    let profilesById = {};

    if (profileIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', profileIds);

      profilesById = Object.fromEntries(
        (profiles || []).map((person) => [
          person.id,
          person,
        ]),
      );
    }

    const detected = {};

    const normalizedItems = ingredientList.map((item) => {
      const correctedPrice = ingredientPricePerKg(item);

      if (isLegacyInflatedIngredientPrice(item)) {
        detected[item.id] = {
          id: item.id,
          name: item.name,
          correctedPrice,
        };
      }

      return {
        ...item,
        price_per_kg: correctedPrice,
        unit_cost: correctedPrice / 1000,
        creator: profilesById[item.created_by] || null,
      };
    });

    const itemNamesById = Object.fromEntries(
      normalizedItems.map((item) => [item.id, item.name]),
    );

    const normalizedMovements = movementList.map(
      (movement) => ({
        ...movement,
        ingredient_name:
          itemNamesById[movement.ingredient_id] ||
          'Producto eliminado',
        creator:
          profilesById[movement.created_by] || null,
      }),
    );

    setDetectedPrices(detected);
    setItems(normalizedItems);
    setMovements(normalizedMovements);
    setLoading(false);
  }

  async function repairDetectedIngredientPrices() {
    if (
      !canEdit ||
      Object.keys(detectedPrices).length === 0
    ) {
      return;
    }

    setMessage('');

    for (const ingredient of Object.values(detectedPrices)) {
      const { error } = await supabase
        .from('ingredients')
        .update({
          price_per_kg: ingredient.correctedPrice,
          unit_cost: ingredient.correctedPrice / 1000,
        })
        .eq('id', ingredient.id);

      if (error) {
        setMessage(error.message);
        return;
      }
    }

    setMessage(
      `Se corrigieron ${
        Object.keys(detectedPrices).length
      } precios que estaban multiplicados por 1.000.`,
    );

    await load();
  }

  function update(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateStockForm(field, value) {
    setStockForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setMessage('');
  }

  function resetStockForm() {
    setStockForm(emptyStockForm);
  }

  async function save(event) {
    event.preventDefault();
    setMessage('');

    if (!canEdit) {
      setMessage(
        'Solo el administrador puede modificar el inventario.',
      );
      return;
    }

    if (!user?.id) {
      setMessage(
        'No se pudo identificar al usuario que inició sesión.',
      );
      return;
    }

    if (!form.name.trim()) {
      setMessage(
        'Debes ingresar el nombre del producto o ingrediente.',
      );
      return;
    }

    const payload = {
      name: form.name.trim(),
      unit: form.unit || 'g',
      stock_qty: Number(form.stock_qty || 0),
      min_stock: Number(form.min_stock || 0),
      unit_cost: Number(form.price_per_kg || 0) / 1000,
      price_per_kg: Number(form.price_per_kg || 0),
      supplier: form.supplier?.trim() || '',
      kcal_100g: Number(form.kcal_100g || 0),
      protein_100g: Number(form.protein_100g || 0),
      carbs_100g: Number(form.carbs_100g || 0),
      sugars_100g: Number(form.sugars_100g || 0),
      fat_100g: Number(form.fat_100g || 0),
      sat_fat_100g: Number(form.sat_fat_100g || 0),
      trans_fat_100g: Number(form.trans_fat_100g || 0),
      fiber_100g: Number(form.fiber_100g || 0),
      sodium_mg_100g: Number(
        form.sodium_mg_100g || 0,
      ),
    };

    // Al editar no se reemplaza el usuario que creó el producto.
    const query = editingId
      ? supabase
          .from('ingredients')
          .update(payload)
          .eq('id', editingId)
      : supabase
          .from('ingredients')
          .insert({
            ...payload,
            created_by: user.id,
          });

    const { error } = await query;

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(
      editingId
        ? 'Producto actualizado correctamente.'
        : 'Producto agregado correctamente.',
    );

    setForm(emptyForm);
    setEditingId(null);
    await load();
  }

  async function addStock(event) {
    event.preventDefault();
    setMessage('');

    if (!canEdit) {
      setMessage(
        'Solo el administrador puede agregar stock.',
      );
      return;
    }

    if (!stockForm.ingredient_id) {
      setMessage(
        'Selecciona el producto al que deseas agregar inventario.',
      );
      return;
    }

    const quantity = Number(stockForm.quantity);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setMessage(
        'La cantidad adicional debe ser mayor que cero.',
      );
      return;
    }

    const pricePerKg =
      stockForm.price_per_kg === ''
        ? null
        : Number(stockForm.price_per_kg);

    if (
      pricePerKg !== null &&
      (!Number.isFinite(pricePerKg) || pricePerKg < 0)
    ) {
      setMessage(
        'El precio por kilo no puede ser negativo.',
      );
      return;
    }

    setSavingStock(true);

    const { error } = await supabase.rpc(
      'add_inventory_stock',
      {
        p_ingredient_id: stockForm.ingredient_id,
        p_quantity: quantity,
        p_price_per_kg: pricePerKg,
        p_supplier:
          stockForm.supplier?.trim() || null,
        p_note: stockForm.note?.trim() || null,
      },
    );

    setSavingStock(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(
      `Se agregaron ${formatQuantity(quantity)} ${
        selectedStockItem?.unit || ''
      } al inventario de ${
        selectedStockItem?.name || 'producto'
      }.`,
    );

    resetStockForm();
    await load();
  }

  function edit(item) {
    if (!canEdit) return;

    setEditingId(item.id);
    setForm({
      ...emptyForm,
      ...item,
    });

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  function openStockEntry(item) {
    setStockForm({
      ingredient_id: item.id,
      quantity: '',
      price_per_kg: '',
      supplier: item.supplier || '',
      note: '',
    });

    setTimeout(() => {
      document
        .getElementById('stock-entry-card')
        ?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
    }, 0);
  }

  function buildInventoryText() {
    const generatedAt = formatDateTime(new Date().toISOString());
    const generatedBy =
      profile?.full_name ||
      profile?.email ||
      user?.email ||
      'Usuario no identificado';

    const lowStockCount = items.filter(
      (item) =>
        Number(item.stock_qty) <= Number(item.min_stock),
    ).length;

    const lines = [
      'NÜBAR — LISTADO GENERAL DE INVENTARIO',
      '======================================',
      `Generado: ${generatedAt}`,
      `Generado por: ${generatedBy}`,
      '',
      `Total de productos: ${items.length}`,
      `Productos con bajo stock: ${lowStockCount}`,
      '',
      'INVENTARIO',
      '----------',
    ];

    items.forEach((item, index) => {
      const status =
        Number(item.stock_qty) <= Number(item.min_stock)
          ? 'BAJO STOCK'
          : 'DISPONIBLE';

      const creator =
        item.creator?.full_name ||
        item.creator?.email ||
        'Usuario no identificado';

      lines.push(
        `${index + 1}. ${item.name}`,
        `   Stock actual: ${formatQuantity(item.stock_qty)} ${
          item.unit || 'g'
        }`,
        `   Stock mínimo: ${formatQuantity(item.min_stock)} ${
          item.unit || 'g'
        }`,
        `   Estado: ${status}`,
        `   Precio por kilo: ${money(
          item.price_per_kg ||
            Number(item.unit_cost || 0) * 1000,
        )}`,
        `   Proveedor: ${item.supplier || '-'}`,
        `   Ingresado por: ${creator}`,
        `   Fecha de creación: ${formatDateTime(
          item.created_at,
        )}`,
        '',
      );
    });

    const comments = movements.filter(
      (movement) => movement.note?.trim(),
    );

    lines.push(
      'OBSERVACIONES DE ENTRADAS DE INVENTARIO',
      '---------------------------------------',
    );

    if (comments.length === 0) {
      lines.push('No existen observaciones registradas.');
    } else {
      comments.forEach((movement, index) => {
        const creator =
          movement.creator?.full_name ||
          movement.creator?.email ||
          'Usuario no identificado';

        lines.push(
          `${index + 1}. ${movement.ingredient_name}`,
          `   Fecha: ${formatDateTime(
            movement.created_at,
          )}`,
          `   Cantidad agregada: ${formatQuantity(
            movement.quantity,
          )} ${movement.unit || ''}`,
          `   Registrado por: ${creator}`,
          `   Observación: ${movement.note}`,
          '',
        );
      });
    }

    return lines.join('\n');
  }

  function exportInventoryTxt() {
    if (items.length === 0) {
      setMessage(
        'No hay productos disponibles para exportar.',
      );
      return;
    }

    const content = buildInventoryText();
    const blob = new Blob([content], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `inventario-nubar-${formatFileDate()}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setMessage(
      'El listado general del inventario se descargó como archivo de texto.',
    );
  }

  function exportInventoryPdf() {
    if (items.length === 0) {
      setMessage(
        'No hay productos disponibles para exportar.',
      );
      return;
    }

    const generatedAt = formatDateTime(
      new Date().toISOString(),
    );
    const generatedBy =
      profile?.full_name ||
      profile?.email ||
      user?.email ||
      'Usuario no identificado';

    const lowStockCount = items.filter(
      (item) =>
        Number(item.stock_qty) <= Number(item.min_stock),
    ).length;

    const inventoryRows = items
      .map((item) => {
        const status =
          Number(item.stock_qty) <= Number(item.min_stock)
            ? 'Bajo stock'
            : 'Disponible';

        const creator =
          item.creator?.full_name ||
          item.creator?.email ||
          'Usuario no identificado';

        return `
          <tr>
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td>${escapeHtml(
              `${formatQuantity(item.stock_qty)} ${
                item.unit || 'g'
              }`,
            )}</td>
            <td>${escapeHtml(
              `${formatQuantity(item.min_stock)} ${
                item.unit || 'g'
              }`,
            )}</td>
            <td class="${
              status === 'Bajo stock' ? 'low-stock' : ''
            }">${escapeHtml(status)}</td>
            <td>${escapeHtml(
              money(
                item.price_per_kg ||
                  Number(item.unit_cost || 0) * 1000,
              ),
            )}</td>
            <td>${escapeHtml(item.supplier || '-')}</td>
            <td>${escapeHtml(creator)}</td>
            <td>${escapeHtml(
              formatDateTime(item.created_at),
            )}</td>
          </tr>
        `;
      })
      .join('');

    const comments = movements.filter(
      (movement) => movement.note?.trim(),
    );

    const commentRows =
      comments.length === 0
        ? `
          <tr>
            <td colspan="5">No existen observaciones registradas.</td>
          </tr>
        `
        : comments
            .map((movement) => {
              const creator =
                movement.creator?.full_name ||
                movement.creator?.email ||
                'Usuario no identificado';

              return `
                <tr>
                  <td><strong>${escapeHtml(
                    movement.ingredient_name,
                  )}</strong></td>
                  <td>${escapeHtml(
                    `${formatQuantity(
                      movement.quantity,
                    )} ${movement.unit || ''}`,
                  )}</td>
                  <td>${escapeHtml(creator)}</td>
                  <td>${escapeHtml(
                    formatDateTime(
                      movement.created_at,
                    ),
                  )}</td>
                  <td>${escapeHtml(movement.note)}</td>
                </tr>
              `;
            })
            .join('');

    const reportWindow = window.open(
      '',
      '_blank',
      'width=1200,height=900',
    );

    if (!reportWindow) {
      setMessage(
        'El navegador bloqueó la ventana del informe. Habilita las ventanas emergentes y vuelve a intentarlo.',
      );
      return;
    }

    reportWindow.document.write(`
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <title>Inventario general NüBar</title>
          <style>
            @page {
              size: A4 landscape;
              margin: 12mm;
            }

            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              color: #2f2118;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 10px;
            }

            h1 {
              margin: 0 0 5px;
              font-size: 24px;
            }

            h2 {
              margin: 24px 0 8px;
              font-size: 15px;
            }

            .subtitle {
              margin-bottom: 15px;
              color: #765b47;
            }

            .summary {
              display: flex;
              gap: 10px;
              margin: 14px 0;
            }

            .summary-card {
              min-width: 155px;
              padding: 9px 12px;
              border: 1px solid #d9c7b3;
              border-radius: 8px;
              background: #fbf7f0;
            }

            .summary-card span {
              display: block;
              color: #765b47;
              font-size: 9px;
            }

            .summary-card strong {
              display: block;
              margin-top: 4px;
              font-size: 15px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
            }

            th,
            td {
              padding: 6px;
              border: 1px solid #d9c7b3;
              text-align: left;
              vertical-align: top;
            }

            th {
              background: #8a572f;
              color: white;
            }

            tr:nth-child(even) td {
              background: #fbf7f0;
            }

            .low-stock {
              color: #b42318;
              font-weight: 700;
            }

            .footer {
              margin-top: 15px;
              color: #765b47;
              font-size: 9px;
            }

            .no-print {
              margin: 0 0 14px;
              padding: 10px 14px;
              border: 0;
              border-radius: 8px;
              background: #8a572f;
              color: white;
              cursor: pointer;
              font-weight: 700;
            }

            @media print {
              .no-print {
                display: none;
              }

              thead {
                display: table-header-group;
              }

              tr {
                break-inside: avoid;
              }
            }
          </style>
        </head>

        <body>
          <button class="no-print" onclick="window.print()">
            Guardar o imprimir PDF
          </button>

          <h1>NüBar — Inventario general</h1>

          <div class="subtitle">
            Generado el ${escapeHtml(
              generatedAt,
            )} por ${escapeHtml(generatedBy)}
          </div>

          <div class="summary">
            <div class="summary-card">
              <span>Total de productos</span>
              <strong>${items.length}</strong>
            </div>

            <div class="summary-card">
              <span>Productos disponibles</span>
              <strong>${
                items.length - lowStockCount
              }</strong>
            </div>

            <div class="summary-card">
              <span>Productos con bajo stock</span>
              <strong>${lowStockCount}</strong>
            </div>
          </div>

          <h2>Listado de inventario</h2>

          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Stock</th>
                <th>Mínimo</th>
                <th>Estado</th>
                <th>Precio/kg</th>
                <th>Proveedor</th>
                <th>Ingresado por</th>
                <th>Fecha</th>
              </tr>
            </thead>

            <tbody>
              ${inventoryRows}
            </tbody>
          </table>

          <h2>Observaciones de entradas de inventario</h2>

          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Registrado por</th>
                <th>Fecha</th>
                <th>Observación</th>
              </tr>
            </thead>

            <tbody>
              ${commentRows}
            </tbody>
          </table>

          <div class="footer">
            Informe generado desde NüBar Gestión Interna.
          </div>

          <script>
            window.addEventListener('load', () => {
              setTimeout(() => window.print(), 350);
            });
          </script>
        </body>
      </html>
    `);

    reportWindow.document.close();
    reportWindow.focus();

    setMessage(
      'Se abrió el informe. En la ventana de impresión selecciona “Guardar como PDF”.',
    );
  }

  const visible =
    filter === 'bajo_stock'
      ? items.filter(
          (item) =>
            Number(item.stock_qty) <=
            Number(item.min_stock),
        )
      : items;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Inventario de ingredientes</h1>
          <p>
            Agrega productos nuevos o suma inventario a los
            productos que ya existen.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '9px',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={exportInventoryTxt}
            disabled={loading || items.length === 0}
          >
            <FileText size={16} />
            Exportar TXT
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={exportInventoryPdf}
            disabled={loading || items.length === 0}
          >
            <Printer size={16} />
            Exportar PDF
          </button>

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
      </div>

      {message && <div className="notice">{message}</div>}

      {Object.keys(detectedPrices).length > 0 && (
        <div className="notice cost-unit-warning">
          <div>
            <AlertTriangle size={18} />

            <span>
              Hay {Object.keys(detectedPrices).length}{' '}
              precio(s) antiguo(s) multiplicado(s) por 1.000.
              Ya se muestran y calculan con el valor correcto por
              kilo.
            </span>
          </div>

          {canEdit && (
            <button
              type="button"
              className="secondary-button"
              onClick={repairDetectedIngredientPrices}
            >
              <Wrench size={16} />
              Guardar corrección
            </button>
          )}
        </div>
      )}

      {canEdit ? (
        <form className="card form-card" onSubmit={save}>
          <div className="card-header-inline">
            <h3>
              {editingId
                ? 'Editar producto'
                : 'Agregar nuevo producto'}
            </h3>

            {editingId && (
              <button
                type="button"
                className="ghost-button"
                onClick={resetForm}
              >
                <X size={16} />
                Cancelar edición
              </button>
            )}
          </div>

          <div className="form-grid">
            <Input
              label="Nombre producto / ingrediente"
              value={form.name}
              onChange={(value) => update('name', value)}
              required
            />

            <label>
              Unidad
              <select
                value={form.unit}
                onChange={(event) =>
                  update('unit', event.target.value)
                }
              >
                <option value="g">Gramos (g)</option>
                <option value="kg">Kilos (kg)</option>
                <option value="un">Unidades</option>
                <option value="ml">Mililitros (ml)</option>
                <option value="l">Litros (l)</option>
              </select>
            </label>

            <Input
              label="Stock inicial"
              type="number"
              step="0.1"
              min="0"
              value={form.stock_qty}
              onChange={(value) =>
                update('stock_qty', value)
              }
            />

            <Input
              label="Stock mínimo"
              type="number"
              step="0.1"
              min="0"
              value={form.min_stock}
              onChange={(value) =>
                update('min_stock', value)
              }
            />

            <label>
              Precio de compra por kilo ($)
              <input
                type="number"
                min="0"
                step="1"
                value={form.price_per_kg}
                onChange={(event) =>
                  update(
                    'price_per_kg',
                    event.target.value,
                  )
                }
              />

              <small className="field-help">
                Si el kilo cuesta $5.000, escribe 5000.
              </small>
            </label>

            <Input
              label="Proveedor"
              value={form.supplier || ''}
              onChange={(value) =>
                update('supplier', value)
              }
            />
          </div>

          <h4>Información nutricional por 100 g</h4>

          <div className="form-grid nutrition-grid">
            <Input
              label="Kcal"
              type="number"
              value={form.kcal_100g}
              onChange={(value) =>
                update('kcal_100g', value)
              }
            />

            <Input
              label="Proteínas (g)"
              type="number"
              value={form.protein_100g}
              onChange={(value) =>
                update('protein_100g', value)
              }
            />

            <Input
              label="Carbohidratos (g)"
              type="number"
              value={form.carbs_100g}
              onChange={(value) =>
                update('carbs_100g', value)
              }
            />

            <Input
              label="Azúcares (g)"
              type="number"
              value={form.sugars_100g}
              onChange={(value) =>
                update('sugars_100g', value)
              }
            />

            <Input
              label="Grasas totales (g)"
              type="number"
              value={form.fat_100g}
              onChange={(value) =>
                update('fat_100g', value)
              }
            />

            <Input
              label="Grasas saturadas (g)"
              type="number"
              value={form.sat_fat_100g}
              onChange={(value) =>
                update('sat_fat_100g', value)
              }
            />

            <Input
              label="Grasas trans (g)"
              type="number"
              value={form.trans_fat_100g}
              onChange={(value) =>
                update('trans_fat_100g', value)
              }
            />

            <Input
              label="Fibra (g)"
              type="number"
              value={form.fiber_100g}
              onChange={(value) =>
                update('fiber_100g', value)
              }
            />

            <Input
              label="Sodio (mg)"
              type="number"
              value={form.sodium_mg_100g}
              onChange={(value) =>
                update('sodium_mg_100g', value)
              }
            />
          </div>

          <button className="primary-button" type="submit">
            <Save size={16} />
            {editingId
              ? 'Guardar cambios'
              : 'Agregar producto'}
          </button>
        </form>
      ) : (
        <div className="notice">
          Tu usuario puede ver el inventario. Solo el
          administrador puede modificarlo.
        </div>
      )}

      {canEdit && stockForm.ingredient_id && (
        <form
          id="stock-entry-card"
          className="card form-card"
          onSubmit={addStock}
          style={{ marginTop: '18px' }}
        >
          <div className="card-header-inline">
            <div>
              <h3>Agregar inventario adicional</h3>
              <p style={{ margin: '4px 0 0' }}>
                El nuevo ingreso se sumará al stock actual; no lo
                reemplazará.
              </p>
            </div>

            <button
              type="button"
              className="ghost-button"
              onClick={resetStockForm}
            >
              <X size={16} />
              Cerrar
            </button>
          </div>

          <div className="form-grid">
            <label>
              Producto
              <select
                value={stockForm.ingredient_id}
                onChange={(event) => {
                  const selected = items.find(
                    (item) =>
                      item.id === event.target.value,
                  );

                  setStockForm((current) => ({
                    ...current,
                    ingredient_id: event.target.value,
                    supplier:
                      selected?.supplier ||
                      current.supplier,
                  }));
                }}
                required
              >
                <option value="">
                  Selecciona un producto
                </option>

                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — stock actual:{' '}
                    {formatQuantity(item.stock_qty)}{' '}
                    {item.unit}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Cantidad que llega{' '}
              {selectedStockItem
                ? `(${selectedStockItem.unit})`
                : ''}
              <input
                type="number"
                min="0.01"
                step="0.1"
                value={stockForm.quantity}
                onChange={(event) =>
                  updateStockForm(
                    'quantity',
                    event.target.value,
                  )
                }
                required
              />
              <small className="field-help">
                Se sumará al stock que ya existe.
              </small>
            </label>

            <label>
              Nuevo precio por kilo ($) — opcional
              <input
                type="number"
                min="0"
                step="1"
                value={stockForm.price_per_kg}
                onChange={(event) =>
                  updateStockForm(
                    'price_per_kg',
                    event.target.value,
                  )
                }
                placeholder={
                  selectedStockItem
                    ? `Actual: ${money(
                        selectedStockItem.price_per_kg,
                      )}`
                    : ''
                }
              />
              <small className="field-help">
                Déjalo vacío para conservar el precio actual.
              </small>
            </label>

            <Input
              label="Proveedor"
              value={stockForm.supplier}
              onChange={(value) =>
                updateStockForm('supplier', value)
              }
            />

            <label style={{ gridColumn: '1 / -1' }}>
              Factura, lote u observación
              <textarea
                rows="3"
                value={stockForm.note}
                onChange={(event) =>
                  updateStockForm(
                    'note',
                    event.target.value,
                  )
                }
                placeholder="Ejemplo: Factura N.º 154, compra del 14/07/2026."
              />
            </label>
          </div>

          {selectedStockItem && (
            <div className="notice">
              Stock actual:{' '}
              <strong>
                {formatQuantity(
                  selectedStockItem.stock_qty,
                )}{' '}
                {selectedStockItem.unit}
              </strong>
              {' · '}
              Después del ingreso quedará en:{' '}
              <strong>
                {formatQuantity(
                  Number(
                    selectedStockItem.stock_qty || 0,
                  ) +
                    Number(stockForm.quantity || 0),
                )}{' '}
                {selectedStockItem.unit}
              </strong>
            </div>
          )}

          <button
            type="submit"
            className="primary-button"
            disabled={savingStock}
          >
            <PackagePlus size={16} />
            {savingStock
              ? 'Agregando inventario...'
              : 'Confirmar entrada de inventario'}
          </button>
        </form>
      )}

      <div className="toolbar">
        <button
          type="button"
          className={
            filter === 'todos' ? 'chip active' : 'chip'
          }
          onClick={() => setFilter('todos')}
        >
          Todos
        </button>

        <button
          type="button"
          className={
            filter === 'bajo_stock'
              ? 'chip active'
              : 'chip'
          }
          onClick={() => setFilter('bajo_stock')}
        >
          Bajo stock
        </button>
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Stock</th>
              <th>Mínimo</th>
              <th>Precio por kilo</th>
              <th>Proveedor</th>
              <th>Ingresado por</th>
              <th>Fecha de creación</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan="9">
                  Cargando inventario...
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan="9">
                  No hay productos para mostrar.
                </td>
              </tr>
            ) : (
              visible.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                  </td>

                  <td>
                    {formatQuantity(item.stock_qty)}{' '}
                    {item.unit || 'g'}
                  </td>

                  <td>
                    {formatQuantity(item.min_stock)}{' '}
                    {item.unit || 'g'}
                  </td>

                  <td>
                    {money(
                      item.price_per_kg ||
                        Number(item.unit_cost || 0) *
                          1000,
                    )}
                  </td>

                  <td>{item.supplier || '-'}</td>

                  <td>
                    <strong>
                      {item.creator?.full_name ||
                        item.creator?.email ||
                        'Usuario no identificado'}
                    </strong>

                    {item.creator?.full_name &&
                      item.creator?.email && (
                        <small
                          style={{
                            display: 'block',
                            marginTop: '3px',
                            opacity: 0.65,
                          }}
                        >
                          {item.creator.email}
                        </small>
                      )}
                  </td>

                  <td>
                    {formatDateTime(item.created_at)}
                  </td>

                  <td>
                    <span
                      className={
                        Number(item.stock_qty) <=
                        Number(item.min_stock)
                          ? 'badge danger'
                          : 'badge ok'
                      }
                    >
                      {Number(item.stock_qty) <=
                      Number(item.min_stock)
                        ? 'Bajo stock'
                        : 'Disponible'}
                    </span>
                  </td>

                  <td>
                    {canEdit && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '7px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <button
                          type="button"
                          className="mini-button"
                          onClick={() =>
                            openStockEntry(item)
                          }
                        >
                          <PackagePlus size={14} />
                          Agregar stock
                        </button>

                        <button
                          type="button"
                          className="mini-button"
                          onClick={() => edit(item)}
                        >
                          Editar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        className="card table-card"
        style={{ marginTop: '20px' }}
      >
        <div
          style={{
            padding: '4px 8px 18px',
          }}
        >
          <h3 style={{ margin: 0 }}>
            Historial de entradas de inventario
          </h3>
          <p style={{ margin: '6px 0 0' }}>
            Aquí puedes ver cuánto se agregó, quién lo ingresó y
            cuándo.
          </p>
        </div>

        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cantidad agregada</th>
              <th>Stock anterior</th>
              <th>Nuevo stock</th>
              <th>Proveedor</th>
              <th>Registrado por</th>
              <th>Fecha y hora</th>
              <th>Observación</th>
            </tr>
          </thead>

          <tbody>
            {movements.length === 0 ? (
              <tr>
                <td colSpan="8">
                  Todavía no hay entradas registradas.
                </td>
              </tr>
            ) : (
              movements.map((movement) => (
                <tr key={movement.id}>
                  <td>
                    <strong>
                      {movement.ingredient_name}
                    </strong>
                  </td>

                  <td>
                    +{formatQuantity(movement.quantity)}{' '}
                    {movement.unit || ''}
                  </td>

                  <td>
                    {formatQuantity(
                      movement.previous_stock,
                    )}{' '}
                    {movement.unit || ''}
                  </td>

                  <td>
                    <strong>
                      {formatQuantity(
                        movement.new_stock,
                      )}{' '}
                      {movement.unit || ''}
                    </strong>
                  </td>

                  <td>{movement.supplier || '-'}</td>

                  <td>
                    {movement.creator?.full_name ||
                      movement.creator?.email ||
                      'Usuario no identificado'}
                  </td>

                  <td>
                    {formatDateTime(
                      movement.created_at,
                    )}
                  </td>

                  <td>{movement.note || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString('es-CL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatDateTime(value) {
  if (!value) return '-';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  }).format(date);
}

function formatFileDate() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}_${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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