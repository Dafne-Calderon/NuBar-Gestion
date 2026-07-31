import { useEffect, useState } from 'react';
import { Save, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';

const initialForm = {
  fullName: '',
  email: '',
  password: '',
  role: 'usuario',
};

export default function Users() {
  const { profile, user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  async function load() {
    setLoading(true);
    setMessage('');

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setUsers(data || []);
  }

  async function invokeAdminUsers(body) {
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body,
    });

    if (error) {
      let detail = error.message || 'No fue posible completar la operación.';

      try {
        if (error.context && typeof error.context.json === 'function') {
          const payload = await error.context.json();
          detail = payload?.error || detail;
        }
      } catch {
        // Se conserva el mensaje original.
      }

      throw new Error(detail);
    }

    if (!data?.ok) {
      throw new Error(data?.error || 'No fue posible completar la operación.');
    }

    return data;
  }

  async function createUser(event) {
    event.preventDefault();
    setMessage('');

    if (!isAdmin) {
      setMessage('Solo el administrador puede crear usuarios.');
      return;
    }

    if (!form.fullName.trim()) {
      setMessage('Ingresa el nombre del usuario.');
      return;
    }

    if (form.password.length < 8) {
      setMessage('La contraseña temporal debe tener al menos 8 caracteres.');
      return;
    }

    setCreating(true);

    try {
      await invokeAdminUsers({
        action: 'create',
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        role: form.role,
      });

      setForm(initialForm);
      setMessage('Usuario creado correctamente. Ya puede iniciar sesión.');
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setCreating(false);
    }
  }

  async function updateRole(id, role) {
    setMessage('');

    try {
      await invokeAdminUsers({
        action: 'update_role',
        userId: id,
        role,
      });

      setMessage('Rol actualizado correctamente.');
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteUser(user) {
    setMessage('');

    if (user.id === currentUser?.id) {
      setMessage('No puedes eliminar tu propia cuenta mientras estás usando el sistema.');
      return;
    }

    const confirmed = window.confirm(
      `¿Eliminar a ${user.full_name || user.email}? Esta persona ya no podrá iniciar sesión.`
    );

    if (!confirmed) return;

    try {
      await invokeAdminUsers({
        action: 'delete',
        userId: user.id,
      });

      setMessage('Usuario eliminado correctamente.');
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (!isAdmin) {
    return (
      <div className="card">
        <h2>Acceso restringido</h2>
        <p>Solo administradores pueden gestionar usuarios.</p>
      </div>
    );
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Usuarios y permisos</h1>
          <p>Crea usuarios, asigna sus roles y elimina las cuentas que ya no utilizarán el sistema.</p>
        </div>
      </div>

      <form className="card form-card" onSubmit={createUser}>
        <h3>Crear nuevo usuario</h3>

        <div className="form-grid">
          <label>
            Nombre completo
            <input
              type="text"
              value={form.fullName}
              onChange={(event) =>
                setForm({ ...form, fullName: event.target.value })
              }
              placeholder="Ejemplo: Camila Pérez"
              required
            />
          </label>

          <label>
            Correo
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              placeholder="usuario@nubar.cl"
              required
            />
          </label>

          <label>
            Contraseña temporal
            <input
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
              placeholder="Mínimo 8 caracteres"
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>

          <label>
            Rol
            <select
              value={form.role}
              onChange={(event) =>
                setForm({ ...form, role: event.target.value })
              }
            >
              <option value="admin">Administrador</option>
              <option value="produccion">Producción</option>
              <option value="ventas">Ventas</option>
              <option value="usuario">Usuario</option>
            </select>
          </label>
        </div>

        <button className="primary-button" disabled={creating}>
          <UserPlus size={17} />
          {creating ? 'Creando usuario...' : 'Crear usuario'}
        </button>
      </form>

      {message && <div className="notice">{message}</div>}

      <div className="card table-card">
        {loading ? (
          <p>Cargando usuarios...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan="4">No hay usuarios registrados.</td>
                </tr>
              ) : (
                users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isCurrentUser={user.id === currentUser?.id}
                    onSave={updateRole}
                    onDelete={deleteUser}
                  />
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function UserRow({ user, isCurrentUser, onSave, onDelete }) {
  const [role, setRole] = useState(user.role);

  useEffect(() => {
    setRole(user.role);
  }, [user.role]);

  return (
    <tr>
      <td>
        <strong>{user.full_name || 'Sin nombre'}</strong>
        {isCurrentUser && (
          <small style={{ display: 'block', opacity: 0.65 }}>
            Tu cuenta
          </small>
        )}
      </td>

      <td>{user.email}</td>

      <td>
        <select
          className="table-input"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          disabled={isCurrentUser}
          title={
            isCurrentUser
              ? 'Por seguridad no puedes cambiar el rol de tu propia cuenta.'
              : 'Selecciona un rol'
          }
        >
          <option value="admin">admin</option>
          <option value="produccion">producción</option>
          <option value="ventas">ventas</option>
          <option value="usuario">usuario</option>
        </select>
      </td>

      <td>
        <div
          style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            className="mini-button"
            onClick={() => onSave(user.id, role)}
            disabled={isCurrentUser || role === user.role}
          >
            <Save size={14} />
            Guardar
          </button>

          <button
            type="button"
            className="mini-button"
            onClick={() => onDelete(user)}
            disabled={isCurrentUser}
            style={{
              background: isCurrentUser ? undefined : '#fff1ec',
              color: isCurrentUser ? undefined : '#9d3f2f',
            }}
          >
            <Trash2 size={14} />
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  );
}
