import { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  ExternalLink,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  ingredientPricePerKg,
  money,
  number,
} from '../utils/calculations.js';

const emptyRecipe = {
  name: '',
  description: '',
  bars_per_batch: 35,
  bar_weight_g: 60,
  sale_price: 0,
  active: true,
};

const emptyIngredientLine = {
  ingredient_id: '',
  grams_per_batch: '',
};

export default function Recipes() {
  const { user, profile } = useAuth();

  const [recipes, setRecipes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(emptyRecipe);
  const [ingredientLine, setIngredientLine] = useState(
    emptyIngredientLine,
  );
  const [simulationQty, setSimulationQty] = useState(35);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit = ['admin', 'produccion'].includes(
    profile?.role,
  );

  useEffect(() => {
    load();
  }, []);

  const selectedRecipe = useMemo(
    () =>
      recipes.find((recipe) => recipe.id === selectedId) ||
      null,
    [recipes, selectedId],
  );

  const selectedItems = selectedRecipe?.recipe_items || [];

  const availableIngredients = useMemo(() => {
    const usedIds = new Set(
      selectedItems.map((item) => item.ingredient_id),
    );

    return ingredients.filter(
      (ingredient) => !usedIds.has(ingredient.id),
    );
  }, [ingredients, selectedItems]);

  const simulation = useMemo(() => {
    if (!selectedRecipe) {
      return {
        rows: [],
        totalCost: 0,
        costPerBar: 0,
      };
    }

    const baseBars = Math.max(
      Number(selectedRecipe.bars_per_batch || 1),
      1,
    );
    const quantity = Math.max(
      Number(simulationQty || 0),
      0,
    );

    const rows = selectedItems.map((item) => {
      const ingredient = item.ingredients;
      const needed =
        (Number(item.grams_per_batch || 0) * quantity) /
        baseBars;
      const pricePerKg = ingredient
        ? ingredientPricePerKg(ingredient)
        : 0;
      const cost = (needed / 1000) * pricePerKg;
      const stock = Number(ingredient?.stock_qty || 0);

      return {
        id: item.id,
        name: ingredient?.name || 'Ingrediente',
        unit: ingredient?.unit || 'g',
        base: Number(item.grams_per_batch || 0),
        needed,
        stock,
        missing: Math.max(needed - stock, 0),
        cost,
      };
    });

    const totalCost = rows.reduce(
      (sum, row) => sum + row.cost,
      0,
    );

    return {
      rows,
      totalCost,
      costPerBar: quantity > 0 ? totalCost / quantity : 0,
    };
  }, [selectedRecipe, selectedItems, simulationQty]);

  async function load(preferredId = selectedId) {
    setLoading(true);
    setMessage('');

    const [recipesResult, ingredientsResult] = await Promise.all([
      supabase
        .from('recipes')
        .select('*, recipe_items(*, ingredients(*))')
        .order('name'),
      supabase.from('ingredients').select('*').order('name'),
    ]);

    setLoading(false);

    if (recipesResult.error || ingredientsResult.error) {
      setMessage(
        (recipesResult.error || ingredientsResult.error).message,
      );
      return;
    }

    const loadedRecipes = recipesResult.data || [];
    setRecipes(loadedRecipes);
    setIngredients(ingredientsResult.data || []);

    const nextSelected =
      loadedRecipes.find((recipe) => recipe.id === preferredId) ||
      loadedRecipes[0] ||
      null;

    if (nextSelected) {
      selectRecipe(nextSelected);
    } else {
      startNewRecipe();
    }
  }

  function selectRecipe(recipe) {
    setSelectedId(recipe.id);
    setForm({
      name: recipe.name || '',
      description: recipe.description || '',
      bars_per_batch: Number(recipe.bars_per_batch || 0),
      bar_weight_g: Number(recipe.bar_weight_g || 0),
      sale_price: Number(recipe.sale_price || 0),
      active: recipe.active !== false,
    });
    setSimulationQty(
      Math.max(Number(recipe.bars_per_batch || 1), 1),
    );
    setIngredientLine(emptyIngredientLine);
    setMessage('');
  }

  function startNewRecipe() {
    setSelectedId('');
    setForm(emptyRecipe);
    setSimulationQty(emptyRecipe.bars_per_batch);
    setIngredientLine(emptyIngredientLine);
    setMessage('');
  }

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveRecipe(event) {
    event.preventDefault();
    setMessage('');

    if (!canEdit) {
      setMessage(
        'Solo administración o producción puede modificar recetas.',
      );
      return;
    }

    if (!form.name.trim()) {
      setMessage('Debes ingresar el nombre de la receta.');
      return;
    }

    if (Number(form.bars_per_batch) <= 0) {
      setMessage(
        'La cantidad de barritas base debe ser mayor que cero.',
      );
      return;
    }

    setSaving(true);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      bars_per_batch: Number(form.bars_per_batch || 0),
      bar_weight_g: Number(form.bar_weight_g || 0),
      sale_price: Number(form.sale_price || 0),
      active: Boolean(form.active),
    };

    let savedId = selectedId;
    let error;

    if (selectedId) {
      ({ error } = await supabase
        .from('recipes')
        .update(payload)
        .eq('id', selectedId));
    } else {
      const result = await supabase
        .from('recipes')
        .insert({
          ...payload,
          created_by: user?.id || null,
        })
        .select('id')
        .single();

      error = result.error;
      savedId = result.data?.id || '';
    }

    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(
      selectedId
        ? 'Receta actualizada correctamente.'
        : 'Receta creada correctamente. Ahora agrega sus ingredientes.',
    );

    await load(savedId);
  }

  async function deleteRecipe() {
    if (!canEdit || !selectedRecipe) return;

    const confirmed = window.confirm(
      `¿Eliminar la receta “${selectedRecipe.name}”? También se eliminará su composición.`,
    );

    if (!confirmed) return;

    setMessage('');

    const { error } = await supabase
      .from('recipes')
      .delete()
      .eq('id', selectedRecipe.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Receta eliminada correctamente.');
    await load('');
  }

  async function addIngredient(event) {
    event.preventDefault();
    setMessage('');

    if (!canEdit || !selectedRecipe) return;

    if (!ingredientLine.ingredient_id) {
      setMessage('Selecciona un ingrediente.');
      return;
    }

    if (Number(ingredientLine.grams_per_batch) <= 0) {
      setMessage(
        'La cantidad del ingrediente debe ser mayor que cero.',
      );
      return;
    }

    const { error } = await supabase
      .from('recipe_items')
      .insert({
        recipe_id: selectedRecipe.id,
        ingredient_id: ingredientLine.ingredient_id,
        grams_per_batch: Number(
          ingredientLine.grams_per_batch,
        ),
      });

    if (error) {
      setMessage(error.message);
      return;
    }

    setIngredientLine(emptyIngredientLine);
    setMessage('Ingrediente agregado a la receta.');
    await load(selectedRecipe.id);
  }

  async function updateIngredientAmount(itemId, value) {
    if (!canEdit) return;

    const amount = Number(value || 0);

    if (amount <= 0) {
      setMessage(
        'La cantidad del ingrediente debe ser mayor que cero.',
      );
      return;
    }

    const { error } = await supabase
      .from('recipe_items')
      .update({ grams_per_batch: amount })
      .eq('id', itemId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Cantidad del ingrediente actualizada.');
    await load(selectedRecipe.id);
  }

  async function removeIngredient(item) {
    if (!canEdit) return;

    const confirmed = window.confirm(
      `¿Quitar ${item.ingredients?.name || 'este ingrediente'} de la receta?`,
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from('recipe_items')
      .delete()
      .eq('id', item.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Ingrediente eliminado de la receta.');
    await load(selectedRecipe.id);
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Recetas</h1>
          <p>
            Define la composición técnica de cada barrita. La
            producción y el descuento de inventario se realizan en
            Plan de producción.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '9px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={() => load()}
            disabled={loading}
          >
            <RefreshCcw size={16} />
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>

          {canEdit && (
            <button
              type="button"
              className="primary-button"
              onClick={startNewRecipe}
            >
              <Plus size={16} />
              Nueva receta
            </button>
          )}
        </div>
      </div>

      {message && <div className="notice">{message}</div>}

      <div className="notice" style={{ marginBottom: '18px' }}>
        <span>
          La fabricación se movió a una sección especializada para
          que pueda tomar automáticamente los pedidos por fecha,
          recomendar cantidades y descontar inventario.
        </span>

        <Link
          to="/produccion-plan"
          className="secondary-button"
          style={{ textDecoration: 'none' }}
        >
          <ExternalLink size={16} />
          Ir al Plan de producción
        </Link>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 0.75fr) minmax(0, 2fr)',
          gap: '18px',
          alignItems: 'start',
        }}
      >
        <aside className="card" style={{ padding: '16px' }}>
          <h3 style={{ marginTop: 0 }}>Recetas registradas</h3>

          <div style={{ display: 'grid', gap: '8px' }}>
            {recipes.length === 0 ? (
              <p>No hay recetas registradas.</p>
            ) : (
              recipes.map((recipe) => (
                <button
                  key={recipe.id}
                  type="button"
                  className={
                    selectedId === recipe.id
                      ? 'chip active'
                      : 'chip'
                  }
                  onClick={() => selectRecipe(recipe)}
                  style={{
                    width: '100%',
                    justifyContent: 'space-between',
                    textAlign: 'left',
                  }}
                >
                  <span>{recipe.name}</span>
                  <small>
                    {number(recipe.bars_per_batch, 0)} barras
                  </small>
                </button>
              ))
            )}
          </div>
        </aside>

        <div style={{ display: 'grid', gap: '18px' }}>
          <form className="card form-card" onSubmit={saveRecipe}>
            <div className="card-header-inline">
              <div>
                <h3>
                  {selectedId
                    ? 'Editar datos de la receta'
                    : 'Crear nueva receta'}
                </h3>
                <p style={{ margin: '5px 0 0' }}>
                  Estos datos definen la base utilizada para todos los
                  cálculos de producción.
                </p>
              </div>

              {selectedId && canEdit && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={startNewRecipe}
                >
                  <X size={16} />
                  Cancelar edición
                </button>
              )}
            </div>

            <div className="form-grid">
              <Input
                label="Nombre"
                value={form.name}
                onChange={(value) => updateForm('name', value)}
                disabled={!canEdit}
                required
              />

              <Input
                label="Barritas base"
                type="number"
                min="1"
                step="1"
                value={form.bars_per_batch}
                onChange={(value) =>
                  updateForm('bars_per_batch', value)
                }
                disabled={!canEdit}
              />

              <Input
                label="Peso barrita (g)"
                type="number"
                min="0"
                step="0.1"
                value={form.bar_weight_g}
                onChange={(value) =>
                  updateForm('bar_weight_g', value)
                }
                disabled={!canEdit}
              />

              <Input
                label="Precio de venta"
                type="number"
                min="0"
                step="1"
                value={form.sale_price}
                onChange={(value) =>
                  updateForm('sale_price', value)
                }
                disabled={!canEdit}
              />

              <label
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '8px',
                  paddingTop: '24px',
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(form.active)}
                  onChange={(event) =>
                    updateForm('active', event.target.checked)
                  }
                  disabled={!canEdit}
                  style={{ width: 'auto' }}
                />
                Receta activa
              </label>

              <label style={{ gridColumn: '1 / -1' }}>
                Descripción
                <textarea
                  rows="3"
                  value={form.description}
                  onChange={(event) =>
                    updateForm('description', event.target.value)
                  }
                  disabled={!canEdit}
                />
              </label>
            </div>

            {canEdit && (
              <div
                style={{
                  display: 'flex',
                  gap: '9px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  <Save size={16} />
                  {saving ? 'Guardando...' : 'Guardar receta'}
                </button>

                {selectedRecipe && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={deleteRecipe}
                    style={{ color: '#9d3f2f' }}
                  >
                    <Trash2 size={16} />
                    Eliminar receta
                  </button>
                )}
              </div>
            )}
          </form>

          {selectedRecipe && (
            <div className="card form-card">
              <div className="card-header-inline">
                <div>
                  <h3>Ingredientes de la receta</h3>
                  <p style={{ margin: '5px 0 0' }}>
                    Cantidades utilizadas para producir{' '}
                    {number(selectedRecipe.bars_per_batch, 0)}
                    {' '}barritas base.
                  </p>
                </div>
              </div>

              {canEdit && (
                <form
                  onSubmit={addIngredient}
                  className="form-grid"
                  style={{ marginBottom: '16px' }}
                >
                  <label>
                    Ingrediente
                    <select
                      value={ingredientLine.ingredient_id}
                      onChange={(event) =>
                        setIngredientLine((current) => ({
                          ...current,
                          ingredient_id: event.target.value,
                        }))
                      }
                    >
                      <option value="">
                        Selecciona un ingrediente
                      </option>

                      {availableIngredients.map((ingredient) => (
                        <option
                          key={ingredient.id}
                          value={ingredient.id}
                        >
                          {ingredient.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Input
                    label="Cantidad por lote base (g)"
                    type="number"
                    min="0.001"
                    step="0.1"
                    value={ingredientLine.grams_per_batch}
                    onChange={(value) =>
                      setIngredientLine((current) => ({
                        ...current,
                        grams_per_batch: value,
                      }))
                    }
                  />

                  <div style={{ paddingTop: '24px' }}>
                    <button
                      type="submit"
                      className="secondary-button"
                      disabled={availableIngredients.length === 0}
                    >
                      <Plus size={16} />
                      Agregar ingrediente
                    </button>
                  </div>
                </form>
              )}

              <div className="card table-card compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Ingrediente</th>
                      <th>Cantidad base</th>
                      <th>Stock actual</th>
                      <th>Precio por kilo</th>
                      <th>Acción</th>
                    </tr>
                  </thead>

                  <tbody>
                    {selectedItems.length === 0 ? (
                      <tr>
                        <td colSpan="5">
                          La receta todavía no tiene ingredientes.
                        </td>
                      </tr>
                    ) : (
                      selectedItems.map((item) => (
                        <RecipeIngredientRow
                          key={item.id}
                          item={item}
                          canEdit={canEdit}
                          onSave={updateIngredientAmount}
                          onDelete={removeIngredient}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </section>
  );
}

function RecipeIngredientRow({
  item,
  canEdit,
  onSave,
  onDelete,
}) {
  const [amount, setAmount] = useState(
    item.grams_per_batch,
  );

  useEffect(() => {
    setAmount(item.grams_per_batch);
  }, [item.grams_per_batch]);

  return (
    <tr>
      <td>
        <strong>{item.ingredients?.name || 'Ingrediente'}</strong>
      </td>

      <td>
        {canEdit ? (
          <div
            style={{
              display: 'flex',
              gap: '7px',
              alignItems: 'center',
            }}
          >
            <input
              type="number"
              min="0.001"
              step="0.1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              style={{ maxWidth: '135px' }}
            />
            <span>g</span>
          </div>
        ) : (
          `${number(item.grams_per_batch, 1)} g`
        )}
      </td>

      <td>
        {number(item.ingredients?.stock_qty, 1)}{' '}
        {item.ingredients?.unit || 'g'}
      </td>

      <td>
        {money(
          item.ingredients
            ? ingredientPricePerKg(item.ingredients)
            : 0,
        )}
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
              onClick={() => onSave(item.id, amount)}
              disabled={
                Number(amount) === Number(item.grams_per_batch)
              }
            >
              <Save size={14} />
              Guardar
            </button>

            <button
              type="button"
              className="mini-button"
              onClick={() => onDelete(item)}
              style={{ color: '#9d3f2f' }}
            >
              <Trash2 size={14} />
              Quitar
            </button>
          </div>
        )}
      </td>
    </tr>
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