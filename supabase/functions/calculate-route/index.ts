const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return json({
        error: 'Falta configurar GOOGLE_MAPS_API_KEY en los secretos de Supabase.',
      }, 503);
    }

    const { origin, destination } = await request.json();
    if (!origin?.trim() || !destination?.trim()) {
      return json({ error: 'Debes indicar dirección de origen y destino.' }, 400);
    }

    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: { address: origin.trim() },
        destination: { address: destination.trim() },
        travelMode: 'TWO_WHEELER',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: false,
        languageCode: 'es-419',
        regionCode: 'CL',
        units: 'METRIC',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return json({
        error: data?.error?.message || 'Google Maps no pudo calcular la ruta.',
        details: data?.error || data,
      }, response.status);
    }

    const route = data?.routes?.[0];
    if (!route?.distanceMeters) {
      return json({ error: 'No se encontró una ruta para esas direcciones.' }, 404);
    }

    const durationSeconds = Number(String(route.duration || '0s').replace('s', '')) || 0;
    return json({
      distance_km: Math.round((route.distanceMeters / 1000) * 10) / 10,
      duration_minutes: Math.round(durationSeconds / 60),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado al calcular la ruta.' }, 500);
  }
});
