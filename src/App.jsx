import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import Recipes from './pages/Recipes.jsx';
import Costs from './pages/Costs.jsx';
import Nutrition from './pages/Nutrition.jsx';
import Waste from './pages/Waste.jsx';
import CalendarOrders from './pages/CalendarOrders.jsx';
import Users from './pages/Users.jsx';
import WholesaleSales from './pages/WholesaleSales.jsx';
import ProductionForecast from './pages/ProductionForecast.jsx';
import DeliveryRoutes from './pages/DeliveryRoutes.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="screen-loader">Cargando NüBar Gestión...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="inventario" element={<Inventory />} />
        <Route path="recetas" element={<Recipes />} />
        <Route path="costos" element={<Costs />} />
        <Route path="nutricion" element={<Nutrition />} />
        <Route path="mermas" element={<Waste />} />
        <Route path="calendario" element={<CalendarOrders />} />
        <Route path="usuarios" element={<Users />} />
        <Route path="/mayoristas" element={<WholesaleSales />} />
        <Route path="/produccion-plan" element={<ProductionForecast />} />
        <Route path="/rutas-delivery" element={<DeliveryRoutes />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
