import { useEffect, useState } from 'react';
import { Plus, RefreshCcw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { number } from '../utils/calculations.js';

export default function Waste() {
  const { user, profile } = useAuth();
  const [ingredients, setIngredients] = useState([]);
  const [wastes, setWastes] = useState([]);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    ingredient_id: '',
    qty: 0,
    reason: '',
    waste_date: new Date().toISOString().slice(0, 10),
  });

  // Solo ADMIN puede registrar mermas.
  const canEdit = profile?.role === 'admin';

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [{ data: ing, error: ingError }, { data: ws, error: wsError }] = await Promise.all([
      supabase.from('ingredients').select('*').order('name'),
      supabase.from('wastes').select('*, ingredients(name, unit)').order('created_at', { ascending: false }),
    ]);

    if (ingError || wsError) {
      setMessage(ingError?.message || wsError?.message);
      return;
    }

    setIngredients(ing || []);
    setWastes(ws || []);
  }

  async function registerWaste(e) {
    e.preventDefault();
    setMessage('');

    if (!canEdit) {
      setMessage('Solo el administrador puede registrar mermas.');
      return;
    }

    const ingredient = ingredients.find((item) => item.id === form.ingredient_id);
    const qty = Number(form.qty || 0);

    if (!ingredient || qty <= 0) {
      setMessage('Selecciona un ingrediente y una cantidad válida.');
      return;
    }

    if (!form.reason.trim()) {
      setMessage('Debes indicar el motivo de la merma.');
      return;
    }

    const { error: insertError } = await supabase.from('wastes').insert({
      ingredient_id: form.ingredient_id,
      qty,
      reason: form.reason.trim(),
      waste_date: form.waste_date,
      registered_by: user.id,
    });

    if (insertError) {
      setMessage(insertError.message);
      return;
    }

    const newStock = Math.max(0, Number(ingredient.stock_qty || 0) - qty);

    const { error: updateError } = await supabase
      .from('ingredients')
      .update({ stock_qty: newStock })
      .eq('id', ingredient.id);

    if (updateError) {
      setMessage(updateError.message);
      return;
    }

    setForm({
      ingredient_id: '',
      qty: 0,
      reason: '',
      waste_date: new Date().toISOString().slice(0, 10),
    });

    setMessage('Merma registrada y stock descontado correctamente.');
    await load();
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Control de mermas</h1>
          <p>El administrador registra pérdidas y el sistema descuenta automáticamente el stock.</p>
        </div>
        <button className="secondary-button" onClick={load}>
          <RefreshCcw size={16} /> Actualizar
        </button>
      </div>

      {message && <div className="notice">{message}</div>}

      {canEdit ? (
        <form className="card form-card" onSubmit={registerWaste}>
          <h3>Nueva merma</h3>
          <div className="form-grid">
            <label>
              Ingrediente
              <select value={form.ingredient_id} onChange={(e) => setForm({ ...form, ingredient_id: e.target.value })} required>
                <option value="">Seleccionar</option>
                {ingredients.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Cantidad perdida
              <input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </label>

            <label>
              Fecha
              <input type="date" value={form.waste_date} onChange={(e) => setForm({ ...form, waste_date: e.target.value })} />
            </label>

            <label>
              Motivo
              <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ej: vencimiento, error de producción, quiebre" />
            </label>
          </div>

          <button className="primary-button"><Plus size={16} /> Registrar merma</button>
        </form>
      ) : (
        <div className="notice">Tu usuario puede ver las mermas. Solo el administrador puede registrarlas.</div>
      )}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Ingrediente</th>
              <th>Cantidad</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {wastes.map((item) => (
              <tr key={item.id}>
                <td>{item.waste_date}</td>
                <td>{item.ingredients?.name}</td>
                <td>{number(item.qty)} {item.ingredients?.unit || 'g'}</td>
                <td>{item.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
