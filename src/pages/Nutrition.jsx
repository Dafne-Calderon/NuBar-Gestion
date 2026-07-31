import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { calculateNutrition, evaluateChileWarningSeals, number } from '../utils/calculations.js';

export default function Nutrition() {
  const [recipes, setRecipes] = useState([]);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { data, error } = await supabase.from('recipes').select('*, recipe_items(*, ingredients(*))').order('name');
    if (!error) {
      setRecipes(data || []);
      if (!selectedId && data?.length) setSelectedId(data[0].id);
    }
  }

  const recipe = useMemo(() => recipes.find((item) => item.id === selectedId), [recipes, selectedId]);
  const nutrition = useMemo(() => recipe ? calculateNutrition(recipe) : null, [recipe]);
  const seals = nutrition ? evaluateChileWarningSeals(nutrition.per100g) : [];

  return (
    <section>
      <div className="page-header">
        <div><h1>Tabla nutricional</h1><p>Cálculo por barrita y por 100 g usando los nutrientes ingresados en inventario.</p></div>
      </div>

      <div className="card">
        <label className="wide-select">Seleccionar receta
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {recipes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        {nutrition && (
          <>
            <div className="label-preview">
              <h2>INFORMACIÓN NUTRICIONAL</h2>
              <p>Porción: 1 barrita ({number(nutrition.perBar.weight)} g)</p>
              <table>
                <thead><tr><th>Nutriente</th><th>Por porción</th><th>Por 100 g</th></tr></thead>
                <tbody>
                  <Row label="Energía (kcal)" a={nutrition.perBar.kcal} b={nutrition.per100g.kcal} />
                  <Row label="Proteínas (g)" a={nutrition.perBar.protein} b={nutrition.per100g.protein} />
                  <Row label="Grasas totales (g)" a={nutrition.perBar.fat} b={nutrition.per100g.fat} />
                  <Row label="Grasas saturadas (g)" a={nutrition.perBar.satFat} b={nutrition.per100g.satFat} />
                  <Row label="Grasas trans (g)" a={nutrition.perBar.transFat} b={nutrition.per100g.transFat} />
                  <Row label="Carbohidratos disponibles (g)" a={nutrition.perBar.carbs} b={nutrition.per100g.carbs} />
                  <Row label="Azúcares totales (g)" a={nutrition.perBar.sugars} b={nutrition.per100g.sugars} />
                  <Row label="Fibra dietética (g)" a={nutrition.perBar.fiber} b={nutrition.per100g.fiber} />
                  <Row label="Sodio (mg)" a={nutrition.perBar.sodiumMg} b={nutrition.per100g.sodiumMg} />
                </tbody>
              </table>
            </div>

            <div className="seal-box">
              <h3>Pre-evaluación de sellos Chile</h3>
              {seals.length === 0 ? <span className="badge ok">Sin sellos según cálculo preliminar</span> : seals.map((seal) => <span key={seal} className="warning-seal">{seal}</span>)}
              <p className="muted">Resultado referencial. Para venta formal, valida fórmula, porción, ingredientes adicionados y rotulación con normativa vigente.</p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Row({ label, a, b }) {
  return <tr><td>{label}</td><td>{number(a, 1)}</td><td>{number(b, 1)}</td></tr>;
}
