import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const allowedRoles = new Set([
  'admin',
  'produccion',
  'ventas',
  'usuario',
]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Método no permitido.' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization');

    if (!supabaseUrl || !serviceRoleKey) {
      return json(
        {
          ok: false,
          error: 'Faltan variables internas de Supabase en la función.',
        },
        500
      );
    }

    if (!authorization?.startsWith('Bearer ')) {
      return json(
        { ok: false, error: 'Debes iniciar sesión para realizar esta acción.' },
        401
      );
    }

    const accessToken = authorization.replace('Bearer ', '').trim();

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user: caller },
      error: callerError,
    } = await admin.auth.getUser(accessToken);

    if (callerError || !caller) {
      return json(
        { ok: false, error: 'La sesión no es válida o expiró.' },
        401
      );
    }

    const { data: callerProfile, error: callerProfileError } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', caller.id)
      .maybeSingle();

    if (callerProfileError || callerProfile?.role !== 'admin') {
      return json(
        {
          ok: false,
          error: 'Solo un administrador puede gestionar usuarios.',
        },
        403
      );
    }

    const body = await request.json();
    const action = String(body?.action || '');

    if (action === 'create') {
      const fullName = String(body?.fullName || '').trim();
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      const role = String(body?.role || 'usuario');

      if (!fullName) {
        return json({ ok: false, error: 'Ingresa el nombre del usuario.' }, 400);
      }

      if (!email) {
        return json({ ok: false, error: 'Ingresa un correo válido.' }, 400);
      }

      if (
        !email.endsWith('@nubar.cl') &&
        !email.endsWith('@gmail.com')
      ) {
        return json(
          {
            ok: false,
            error:
              'Solo se permiten correos @nubar.cl o @gmail.com para pruebas.',
          },
          400
        );
      }

      if (password.length < 8) {
        return json(
          {
            ok: false,
            error: 'La contraseña debe tener al menos 8 caracteres.',
          },
          400
        );
      }

      if (!allowedRoles.has(role)) {
        return json({ ok: false, error: 'El rol seleccionado no es válido.' }, 400);
      }

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
          },
        });

      if (createError || !created.user) {
        return json(
          {
            ok: false,
            error:
              createError?.message ||
              'No fue posible crear el usuario en Supabase Auth.',
          },
          400
        );
      }

      const { error: profileError } = await admin
        .from('profiles')
        .update({
          full_name: fullName,
          role,
        })
        .eq('id', created.user.id);

      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);

        return json(
          {
            ok: false,
            error: `El usuario no pudo guardarse en perfiles: ${profileError.message}`,
          },
          400
        );
      }

      return json({
        ok: true,
        message: 'Usuario creado correctamente.',
        user: {
          id: created.user.id,
          email,
          fullName,
          role,
        },
      });
    }

    if (action === 'update_role') {
      const userId = String(body?.userId || '');
      const role = String(body?.role || '');

      if (!userId || !allowedRoles.has(role)) {
        return json(
          { ok: false, error: 'Usuario o rol inválido.' },
          400
        );
      }

      if (userId === caller.id && role !== 'admin') {
        return json(
          {
            ok: false,
            error:
              'No puedes quitarte el rol de administrador a ti misma desde esta pantalla.',
          },
          400
        );
      }

      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('id, role')
        .eq('id', userId)
        .maybeSingle();

      if (targetError || !target) {
        return json({ ok: false, error: 'El usuario no existe.' }, 404);
      }

      if (target.role === 'admin' && role !== 'admin') {
        const { count } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin');

        if ((count || 0) <= 1) {
          return json(
            {
              ok: false,
              error: 'Debe quedar al menos una cuenta administradora.',
            },
            400
          );
        }
      }

      const { error: updateError } = await admin
        .from('profiles')
        .update({ role })
        .eq('id', userId);

      if (updateError) {
        return json({ ok: false, error: updateError.message }, 400);
      }

      return json({ ok: true, message: 'Rol actualizado correctamente.' });
    }

    if (action === 'delete') {
      const userId = String(body?.userId || '');

      if (!userId) {
        return json({ ok: false, error: 'Falta identificar al usuario.' }, 400);
      }

      if (userId === caller.id) {
        return json(
          {
            ok: false,
            error: 'No puedes eliminar tu propia cuenta.',
          },
          400
        );
      }

      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('id', userId)
        .maybeSingle();

      if (targetError || !target) {
        return json({ ok: false, error: 'El usuario no existe.' }, 404);
      }

      if (target.role === 'admin') {
        const { count } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin');

        if ((count || 0) <= 1) {
          return json(
            {
              ok: false,
              error: 'No puedes eliminar la única cuenta administradora.',
            },
            400
          );
        }
      }

      // Eliminación lógica en Auth para evitar errores por registros históricos.
      // Después se quita el perfil para que desaparezca del panel.
      const { error: deleteAuthError } =
        await admin.auth.admin.deleteUser(userId, true);

      if (deleteAuthError) {
        return json(
          {
            ok: false,
            error: `No fue posible desactivar la cuenta: ${deleteAuthError.message}`,
          },
          400
        );
      }

      const { error: deleteProfileError } = await admin
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (deleteProfileError) {
        return json(
          {
            ok: false,
            error: `La cuenta fue desactivada, pero el perfil no pudo ocultarse: ${deleteProfileError.message}`,
          },
          400
        );
      }

      return json({
        ok: true,
        message: 'Usuario eliminado correctamente.',
      });
    }

    return json({ ok: false, error: 'Acción no reconocida.' }, 400);
  } catch (error) {
    console.error(error);

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Ocurrió un error inesperado.',
      },
      500
    );
  }
});
