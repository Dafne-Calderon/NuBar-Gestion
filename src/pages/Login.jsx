import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock, Mail, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';

const allowedDomains = ['@gmail.com', '@nubar.cl'];

function isAllowedEmail(email) {
  const cleanEmail = email.trim().toLowerCase();
  return allowedDomains.some((domain) => cleanEmail.endsWith(domain));
}

export default function Login() {
  const { user } = useAuth();
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  function validateEmail() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setMessage('Debes ingresar un correo.');
      return false;
    }

    if (!isAllowedEmail(cleanEmail)) {
      setMessage('Por ahora puedes usar Gmail para pruebas. Después se dejará solo @nubar.cl.');
      return false;
    }

    if (password.length < 6) {
      setMessage('La contraseña debe tener mínimo 6 caracteres.');
      return false;
    }

    if (mode === 'signup' && !fullName.trim()) {
      setMessage('Debes ingresar el nombre completo.');
      return false;
    }

    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage('');

    if (!validateEmail()) return;

    setLoading(true);

    const cleanEmail = email.trim().toLowerCase();

    const action =
      mode === 'login'
        ? supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          })
        : supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: {
                full_name: fullName.trim(),
              },
            },
          });

    const { error } = await action;

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    if (mode === 'signup') {
      setMessage('Cuenta creada correctamente. Revisa tu correo si Supabase solicita confirmación.');
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="hero-pill">
          <Sparkles size={17} /> Producción · Inventario · Nutrición
        </div>

        <h1>NüBar Gestión</h1>

        <p>
          Control interno elegante para recetas, costos, mermas, inventario,
          pedidos y etiquetas nutricionales.
        </p>
      </section>

      <form className="login-card" onSubmit={handleSubmit}>
        <img src="/logo-nubar.svg" alt="NüBar" className="login-logo" />

        <h2>{mode === 'login' ? 'Iniciar sesión' : 'Crear usuario'}</h2>

        <p>
          Acceso temporal con <strong>Gmail</strong>. Luego se usará correo
          corporativo <strong>@nubar.cl</strong>.
        </p>

        {mode === 'signup' && (
          <label>
            Nombre completo
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej: Juan Perez"
            />
          </label>
        )}

        <label>
          Correo
          <div className="input-icon">
            <Mail size={17} />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nubar.gestion@gmail.com"
            />
          </div>
        </label>

        <label>
          Contraseña
          <div className="input-icon">
            <Lock size={17} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
            />
          </div>
        </label>

        {message && <div className="notice">{message}</div>}

        <button className="primary-button" disabled={loading}>
          {loading
            ? 'Procesando...'
            : mode === 'login'
              ? 'Entrar'
              : 'Crear cuenta'}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMessage('');
            setMode(mode === 'login' ? 'signup' : 'login');
          }}
        >
          {mode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo cuenta'}
        </button>
      </form>
    </div>
  );
}