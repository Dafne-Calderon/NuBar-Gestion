import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, ChefHat, Package } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';

export default function Dashboard() {
  const [stats, setStats] = useState({ ingredients: 0, recipes: 0, lowStock: 0, orders: 0 });
  const [lowItems, setLowItems] = useState([]);
  const [orders, setOrders] = useState([]);

  useEffect(() => { load(); }, []);

  async function count(table) {
    const { count: total } = await supabase.from(table).select('*', { count: 'exact', head: true });
    return total || 0;
  }

  async function load() {
    const [ingredients, recipes, ordersCount] = await Promise.all([
      count('ingredients'),
      count('recipes'),
      count('orders'),
    ]);

    const { data: inv } = await supabase.from('ingredients').select('*').order('name');
    const low = (inv || []).filter((item) => Number(item.stock_qty) <= Number(item.min_stock));
    setLowItems(low.slice(0, 6));

    const { data: nextOrders } = await supabase
      .from('orders')
      .select('*, recipes(name)')
      .gte('delivery_date', new Date().toISOString())
      .order('delivery_date', { ascending: true })
      .limit(5);

    setOrders(nextOrders || []);
    setStats({ ingredients, recipes, lowStock: low.length, orders: ordersCount });
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Resumen general de producción, inventario, recetas y entregas.</p>
        </div>
      </div>

      <div className="stats-grid">
        <Stat icon={Package} label="Ingredientes" value={stats.ingredients} />
        <Stat icon={ChefHat} label="Recetas activas" value={stats.recipes} />
        <Stat icon={AlertTriangle} label="Bajo stock" value={stats.lowStock} danger={stats.lowStock > 0} />
        <Stat icon={CalendarDays} label="Pedidos" value={stats.orders} />
      </div>

      <div className="two-columns">
        <div className="card">
          <h3>Ingredientes bajo stock</h3>
          {lowItems.length === 0 ? <p className="muted">No hay alertas de stock.</p> : (
            <table>
              <thead><tr><th>Ingrediente</th><th>Stock</th><th>Mínimo</th></tr></thead>
              <tbody>{lowItems.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.stock_qty} g</td><td>{item.min_stock} g</td></tr>)}</tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>Próximas entregas</h3>
          {orders.length === 0 ? <p className="muted">No hay entregas próximas.</p> : (
            <table>
              <thead><tr><th>Cliente</th><th>Receta</th><th>Fecha</th></tr></thead>
              <tbody>{orders.map((order) => <tr key={order.id}><td>{order.customer}</td><td>{order.recipes?.name}</td><td>{new Date(order.delivery_date).toLocaleString('es-CL')}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ icon: Icon, label, value, danger }) {
  return <div className={`stat-card ${danger ? 'danger' : ''}`}><Icon size={24} /><span>{label}</span><strong>{value}</strong></div>;
}
