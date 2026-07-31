import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  ChefHat,
  ClipboardList,
  DollarSign,
  Factory,
  Handshake,
  LogOut,
  Package,
  Route as RouteIcon,
  Scale,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';

const nav = [
  {
    to: '/',
    label: 'Dashboard',
    icon: BarChart3,
  },
  {
    to: '/inventario',
    label: 'Inventario',
    icon: Package,
  },
  {
    to: '/recetas',
    label: 'Recetas',
    icon: ChefHat,
  },
  {
    to: '/costos',
    label: 'Costos y margen',
    icon: DollarSign,
  },
  {
    to: '/nutricion',
    label: 'Tabla nutricional',
    icon: ClipboardList,
  },
  {
    to: '/mermas',
    label: 'Mermas',
    icon: Scale,
  },
  {
    to: '/calendario',
    label: 'Pedidos y entregas',
    icon: CalendarDays,
  },
  {
    to: '/mayoristas',
    label: 'Ventas mayoristas',
    icon: Handshake,
  },
  {
    to: '/produccion-plan',
    label: 'Plan de producción',
    icon: Factory,
  },
  {
    to: '/rutas-delivery',
    label: 'Rutas delivery',
    icon: RouteIcon,
  },

  {
    to: '/usuarios',
    label: 'Usuarios',
    icon: UsersRound,
    adminOnly: true,
  },
];

export default function Layout() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const isAdmin = profile?.role === 'admin';

  async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Error al cerrar sesión:', error.message);
      return;
    }

    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <img src="/logo-nubar.svg" alt="NüBar Gestión" />
          <span>Gestión Interna</span>
        </div>

        <nav className="nav-list">
          {nav
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `nav-item ${isActive ? 'active' : ''}`
                  }
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
        </nav>

        <div className="profile-card">
          <ShieldCheck size={18} />

          <div>
            <strong>{profile?.full_name || 'Usuario NüBar'}</strong>

            <small>
              {profile?.role || 'usuario'}
              {profile?.email ? ` · ${profile.email}` : ''}
            </small>
          </div>
        </div>

        <button
          type="button"
          className="ghost-button"
          onClick={logout}
        >
          <LogOut size={17} />
          <span>Cerrar sesión</span>
        </button>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}