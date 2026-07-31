import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Save, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  calculateIngredientBreakdown,
  calculateProfessionalCosts,
  ingredientPricePerKg,
  isLegacyInflatedIngredientPrice,
  money,
  number,
} from '../utils/calculations.js';

const editableFields = [
  'sale_price', 'packaging_cost', 'label_cost', 'labor_cost', 'energy_cost',
  'transport_cost', 'advertising_cost', 'operational_cost', 'other_cost',
  'waste_percent', 'commission_percent', 'desired_margin_percent', 'vat_percent',
];

const fieldGroups = [
  ['Costos adicionales por barrita', [
    ['packaging_cost', 'Envase'], ['label_cost', 'Etiqueta'], ['labor_cost', 'Mano de obra'],
    ['energy_cost', 'Gas / electricidad'], ['transport_cost', 'Transporte'], ['advertising_cost', 'Publicidad'],
    ['operational_cost', 'Gastos operacionales'], ['other_cost', 'Otros costos'],
  ]],
  ['Porcentajes y precio', [
    ['waste_percent', 'Merma (%)'], ['commission_percent', 'Comisión de venta (%)'],
    ['desired_margin_percent', 'Margen deseado (%)'], ['vat_percent', 'IVA (%)'], ['sale_price', 'Precio de venta actual'],
  ]],
];

function initialRecipeForm(recipe) {
  return Object.fromEntries(
    editableFields.map((field) => [field, recipe[field] ?? (field === 'vat_percent' ? 19 : 0)]),
  );
}

export default function Costs() {
  const { profile } = useAuth();
  const [recipes, setRecipes] = useState([]);
  const [forms, setForms] = useState({});
  const [ingredientPrices, setIngredientPrices] = useState({});
  const [detectedPrices, setDetectedPrices] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [message, setMessage] = useState('');
  const [savingId, setSavingId] = useState(null);
  const canEdit = ['admin', 'produccion'].includes(profile?.role);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data, error } = await supabase
      .from('recipes')
      .select('*, recipe_items(*, ingredients(*))')
      .order('name');

    if (error) return setMessage(error.message);

    const loaded = data || [];
    setRecipes(loaded);
    setForms(Object.fromEntries(loaded.map((recipe) => [recipe.id, initialRecipeForm(recipe)])));

    const prices = {};
    const detected = {};
    loaded.forEach((recipe) => {
      (recipe.recipe_items || []).forEach((item) => {
        if (!item.ingredients) return;
        const correctedPrice = ingredientPricePerKg(item.ingredients);
        prices[item.ingredients.id] = correctedPrice;
        if (isLegacyInflatedIngredientPrice(item.ingredients)) {
          detected[item.ingredients.id] = {
            id: item.ingredients.id,
            name: item.ingredients.name,
            correctedPrice,
          };
        }
      });
    });
    setIngredientPrices(prices);
    setDetectedPrices(detected);
  }

  function draftRecipe(recipe) {
    return {
      ...recipe,
      ...(forms[recipe.id] || {}),
      recipe_items: (recipe.recipe_items || []).map((item) => ({
        ...item,
        ingredients: item.ingredients
          ? { ...item.ingredients, price_per_kg: Number(ingredientPrices[item.ingredients.id] ?? ingredientPricePerKg(item.ingredients)), unit_cost: Number(ingredientPrices[item.ingredients.id] ?? ingredientPricePerKg(item.ingredients)) / 1000 }
          : item.ingredients,
      })),
    };
  }

  function update(recipeId, field, value) {
    setForms((current) => ({
      ...current,
      [recipeId]: { ...current[recipeId], [field]: value },
    }));
  }

  function updateIngredientPrice(ingredientId, value) {
    setIngredientPrices((current) => ({ ...current, [ingredientId]: value }));
  }

  async function repairDetectedIngredientPrices() {
    if (!canEdit || Object.keys(detectedPrices).length === 0) return;

    setMessage('');
    setSavingId('repair-prices');

    try {
      for (const ingredient of Object.values(detectedPrices)) {
        const { error } = await supabase
          .from('ingredients')
          .update({
            price_per_kg: ingredient.correctedPrice,
            unit_cost: ingredient.correctedPrice / 1000,
          })
          .eq('id', ingredient.id);
        if (error) throw error;
      }

      setMessage(`Se corrigieron ${Object.keys(detectedPrices).length} precios que estaban multiplicados por 1.000.`);
      await load();
    } catch (error) {
      setMessage(error.message || 'No fue posible corregir los precios detectados.');
    } finally {
      setSavingId(null);
    }
  }

  async function save(recipe) {
    setMessage('');
    setSavingId(recipe.id);

    const payload = Object.fromEntries(
      editableFields.map((field) => [field, Number(forms[recipe.id]?.[field] || 0)]),
    );

    const uniqueIngredients = new Map();
    (recipe.recipe_items || []).forEach((item) => {
      if (item.ingredients?.id) uniqueIngredients.set(item.ingredients.id, item.ingredients);
    });

    try {
      const { error: recipeError } = await supabase.from('recipes').update(payload).eq('id', recipe.id);
      if (recipeError) throw recipeError;

      for (const ingredient of uniqueIngredients.values()) {
        const pricePerKg = Number(ingredientPrices[ingredient.id] || 0);
        const { error: ingredientError } = await supabase
          .from('ingredients')
          .update({ price_per_kg: pricePerKg, unit_cost: pricePerKg / 1000 })
          .eq('id', ingredient.id);
        if (ingredientError) throw ingredientError;
      }

      setMessage(`Costos, precios por kilo y margen de ${recipe.name} guardados correctamente.`);
      await load();
    } catch (error) {
      setMessage(error.message || 'No fue posible guardar los costos.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Costos y margen</h1>
          <p>Edita aquí los precios por kilo, costos adicionales, porcentajes y precio de venta. El costo por barrita se recalcula automáticamente.</p>
        </div>
      </div>

      {!canEdit && <div className="notice">Tu perfil puede consultar los costos, pero solo administración y producción pueden modificarlos.</div>}
      {message && <div className="notice">{message}</div>}

      {Object.keys(detectedPrices).length > 0 && (
        <div className="notice cost-unit-warning">
          <div>
            <AlertTriangle size={18} />
            <span>
              Detectamos {Object.keys(detectedPrices).length} precio(s) heredado(s) multiplicado(s) por 1.000.
              El cálculo ya está usando el valor correcto por kilo para no inflar el costo.
            </span>
          </div>
          {canEdit && (
            <button
              className="secondary-button"
              onClick={repairDetectedIngredientPrices}
              disabled={savingId === 'repair-prices'}
            >
              <Wrench size={16} />
              {savingId === 'repair-prices' ? 'Corrigiendo...' : 'Guardar corrección'}
            </button>
          )}
        </div>
      )}

      <div className="cost-cards">
        {recipes.map((recipe) => {
          const draft = draftRecipe(recipe);
          const costs = calculateProfessionalCosts(draft);
          const breakdown = calculateIngredientBreakdown(draft);
          const open = expanded === recipe.id;

          return (
            <article className="card cost-card" key={recipe.id}>
              <div className="cost-card-heading">
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <h2 style={{ margin: 0 }}>{recipe.name}</h2>
                    <span
                      title="Precio de venta actual"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '5px 11px',
                        borderRadius: '999px',
                        background: '#f4e4cf',
                        color: '#7c4a27',
                        fontSize: '0.86rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Venta: {money(Number(draft.sale_price || 0))}
                    </span>
                  </div>

                  <small>
                    {number(recipe.bars_per_batch, 0)} barritas por lote ·{' '}
                    {number(recipe.bar_weight_g, 1)} g cada una
                  </small>
                </div>
                <button type="button" className="secondary-button" onClick={() => setExpanded(open ? null : recipe.id)}>
                  {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {open ? 'Ocultar edición' : 'Editar costos y margen'}
                </button>
              </div>
              <div className="cost-kpis">
                <CostKpi label="Ingredientes por barra" value={money(costs.ingredientsPerBar)} />
                <CostKpi label="Adicionales por barra" value={money(costs.additionalPerBar)} />
                <CostKpi label="Costo real por barra" value={money(costs.totalCostPerBar)} emphasis />
                <CostKpi label="Precio sugerido con IVA" value={money(costs.suggestedPriceWithVat)} />
                <CostKpi label="Utilidad por barra" value={money(costs.profitPerBar)} className={costs.profitPerBar >= 0 ? 'positive' : 'negative'} />
                <CostKpi label="Margen actual" value={`${number(costs.marginPercent, 1)}%`} className={costs.marginPercent >= Number(draft.desired_margin_percent || 0) ? 'positive' : 'negative'} />
              </div>

              {open && (
                <div className="cost-detail">
                  <div>
                    <h3>Precios de ingredientes y costo del lote</h3>
                    <p className="section-help">Modifica el precio por kilo. El costo del lote y el costo por barrita se actualizan al instante.</p>
                    <div className="card table-card compact-table">
                      <table>
                        <thead><tr><th>Ingrediente</th><th>Cantidad</th><th>Precio por kilo</th><th>Costo lote</th></tr></thead>
                        <tbody>
                          {breakdown.map((item) => (
                            <tr key={item.id}>
                              <td>{item.name}</td>
                              <td>{number(item.grams, 1)} g</td>
                              <td>
                                <div className="money-input-cell">
                                  <span>$</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={ingredientPrices[item.ingredientId] ?? item.pricePerKg ?? 0}
                                    onChange={(e) => updateIngredientPrice(item.ingredientId, e.target.value)}
                                    disabled={!canEdit}
                                    aria-label={`Precio por kilo de ${item.name}`}
                                  />
                                </div>
                              </td>
                              <td>{money(item.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot><tr><td colSpan="3"><strong>Total ingredientes del lote</strong></td><td><strong>{money(costs.ingredientsBatch)}</strong></td></tr></tfoot>
                      </table>
                    </div>
                  </div>

                  {fieldGroups.map(([title, fields]) => (
                    <div key={title}>
                      <h3>{title}</h3>
                      <div className="form-grid cost-form-grid">
                        {fields.map(([field, label]) => (
                          <label key={field}>
                            {label}
                            <input
                              type="number"
                              min="0"
                              step={field.includes('percent') ? '0.1' : '1'}
                              value={forms[recipe.id]?.[field] ?? 0}
                              onChange={(e) => update(recipe.id, field, e.target.value)}
                              disabled={!canEdit}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="cost-formula">
                    <strong>Fórmula aplicada</strong>
                    <span>Cada ingrediente: gramos usados ÷ 1.000 × precio por kilo. Luego se suman los costos adicionales, merma y comisión.</span>
                    <span>El precio sugerido protege el margen deseado y luego agrega el IVA.</span>
                  </div>

                  {canEdit && (
                    <button type="button" className="primary-button" onClick={() => save(recipe)} disabled={savingId === recipe.id}>
                      <Save size={16} /> {savingId === recipe.id ? 'Guardando...' : 'Guardar costos y margen'}
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CostKpi({ label, value, emphasis = false, className = '' }) {
  return <div className={`cost-kpi ${emphasis ? 'emphasis' : ''} ${className}`}><span>{label}</span><strong>{value}</strong></div>;
}
