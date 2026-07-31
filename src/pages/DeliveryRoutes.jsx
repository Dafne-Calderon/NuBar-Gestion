import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  RefreshCcw,
  Route,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';

function todayInput() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}`;
}

function dayRange(value) {
  const [year, month, day] = value.split('-').map(Number);

  const start = new Date(
    year,
    month - 1,
    day,
    0,
    0,
    0,
    0,
  );

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DeliveryRoutes() {
  const [deliveryDate, setDeliveryDate] =
    useState(todayInput());
  const [commune, setCommune] = useState('todas');
  const [stops, setStops] = useState([]);
  const [orderedIds, setOrderedIds] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    load();
  }, [deliveryDate]);

  async function load() {
    setLoading(true);
    setMessage('');

    const range = dayRange(deliveryDate);

    const [regularResult, wholesaleResult] =
      await Promise.all([
        supabase
          .from('orders')
          .select(
            'id, customer, address, commune, delivery_date, status, quantity_bars, recipes(name)',
          )
          .gte(
            'delivery_date',
            range.start.toISOString(),
          )
          .lt(
            'delivery_date',
            range.end.toISOString(),
          )
          .not(
            'status',
            'in',
            '("cancelado","entregado")',
          ),

        supabase
          .from('wholesale_orders')
          .select(
            'id, customer, address, commune, delivery_date, status, total_units',
          )
          .gte(
            'delivery_date',
            range.start.toISOString(),
          )
          .lt(
            'delivery_date',
            range.end.toISOString(),
          )
          .not(
            'status',
            'in',
            '("cancelado","entregado")',
          ),
      ]);

    setLoading(false);

    if (regularResult.error || wholesaleResult.error) {
      const error =
        regularResult.error || wholesaleResult.error;

      setMessage(
        /wholesale_orders/i.test(error.message)
          ? 'Falta instalar el módulo mayorista en Supabase.'
          : error.message,
      );
      return;
    }

    const normalStops = (regularResult.data || []).map(
      (order) => ({
        id: `normal-${order.id}`,
        source: 'Pedido normal',
        customer: order.customer,
        address: order.address,
        commune: order.commune || '',
        delivery_date: order.delivery_date,
        detail: `${order.quantity_bars} ${
          order.recipes?.name || 'barritas'
        }`,
      }),
    );

    const wholesaleStops = (
      wholesaleResult.data || []
    ).map((order) => ({
      id: `wholesale-${order.id}`,
      source: 'Mayorista',
      customer: order.customer,
      address: order.address,
      commune: order.commune || '',
      delivery_date: order.delivery_date,
      detail: `${order.total_units} unidades`,
    }));

    const loadedStops = [
      ...normalStops,
      ...wholesaleStops,
    ]
      .filter((stop) => stop.address?.trim())
      .sort((a, b) => {
        const communeCompare = a.commune.localeCompare(
          b.commune,
          'es',
        );

        if (communeCompare !== 0) {
          return communeCompare;
        }

        return (
          new Date(a.delivery_date).getTime() -
          new Date(b.delivery_date).getTime()
        );
      });

    setStops(loadedStops);
    setOrderedIds(loadedStops.map((stop) => stop.id));
  }

  const communes = useMemo(
    () =>
      [
        ...new Set(
          stops
            .map((stop) => stop.commune)
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, 'es')),
    [stops],
  );

  const visibleStops = useMemo(() => {
    const byId = Object.fromEntries(
      stops.map((stop) => [stop.id, stop]),
    );

    return orderedIds
      .map((id) => byId[id])
      .filter(Boolean)
      .filter(
        (stop) =>
          commune === 'todas' ||
          stop.commune === commune,
      );
  }, [stops, orderedIds, commune]);

  function moveStop(id, direction) {
    setOrderedIds((current) => {
      const index = current.indexOf(id);

      if (index < 0) {
        return current;
      }

      const nextIndex =
        direction === 'up' ? index - 1 : index + 1;

      if (
        nextIndex < 0 ||
        nextIndex >= current.length
      ) {
        return current;
      }

      const copy = [...current];
      [copy[index], copy[nextIndex]] = [
        copy[nextIndex],
        copy[index],
      ];

      return copy;
    });
  }

  function orderByTime() {
    const sorted = [...stops].sort(
      (a, b) =>
        new Date(a.delivery_date).getTime() -
        new Date(b.delivery_date).getTime(),
    );

    setOrderedIds(sorted.map((stop) => stop.id));
    setMessage('Entregas ordenadas por horario.');
  }

  function orderByCommuneAndTime() {
    const sorted = [...stops].sort((a, b) => {
      const communeCompare = a.commune.localeCompare(
        b.commune,
        'es',
      );

      if (communeCompare !== 0) {
        return communeCompare;
      }

      return (
        new Date(a.delivery_date).getTime() -
        new Date(b.delivery_date).getTime()
      );
    });

    setOrderedIds(sorted.map((stop) => stop.id));
    setMessage(
      'Entregas agrupadas por comuna y ordenadas por horario.',
    );
  }

  async function copyRoute() {
    if (visibleStops.length === 0) {
      setMessage('No hay direcciones para copiar.');
      return;
    }

    const routeText = visibleStops
      .map(
        (stop, index) =>
          `${index + 1}. ${stop.customer}\n` +
          `   ${stop.address}\n` +
          `   ${stop.commune || 'Sin comuna'} · ${formatTime(
            stop.delivery_date,
          )}\n` +
          `   ${stop.detail}`,
      )
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(routeText);
      setMessage(
        'Listado de reparto copiado correctamente.',
      );
    } catch {
      setMessage(
        'No fue posible copiar automáticamente el listado.',
      );
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Planificación de delivery</h1>
          <p>
            Agrupa las entregas por día y comuna y organiza
            manualmente el orden de reparto.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={load}
          disabled={loading}
        >
          <RefreshCcw size={16} />
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {message && (
        <div className="notice">{message}</div>
      )}

      <div className="card form-card">
        <div className="form-grid">
          <label>
            Día de reparto
            <input
              type="date"
              value={deliveryDate}
              onChange={(event) =>
                setDeliveryDate(event.target.value)
              }
            />
          </label>

          <label>
            Comuna / sector
            <select
              value={commune}
              onChange={(event) =>
                setCommune(event.target.value)
              }
            >
              <option value="todas">
                Todas las comunas
              </option>

              {communes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '9px',
            flexWrap: 'wrap',
            marginTop: '16px',
          }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={orderByCommuneAndTime}
          >
            <Route size={16} />
            Ordenar por comuna
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={orderByTime}
          >
            Ordenar por horario
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={copyRoute}
          >
            <ClipboardCopy size={16} />
            Copiar listado de reparto
          </button>
        </div>
      </div>

      <div
        className="card table-card"
        style={{ marginTop: '18px' }}
      >
        <table>
          <thead>
            <tr>
              <th>Orden</th>
              <th>Hora</th>
              <th>Cliente</th>
              <th>Dirección</th>
              <th>Comuna</th>
              <th>Pedido</th>
              <th>Tipo</th>
              <th>Mover</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8">
                  Cargando entregas...
                </td>
              </tr>
            ) : visibleStops.length === 0 ? (
              <tr>
                <td colSpan="8">
                  No hay entregas para este día y comuna.
                </td>
              </tr>
            ) : (
              visibleStops.map((stop, index) => (
                <tr key={stop.id}>
                  <td>
                    <strong>{index + 1}</strong>
                  </td>

                  <td>
                    {formatTime(stop.delivery_date)}
                  </td>

                  <td>
                    <strong>{stop.customer}</strong>
                  </td>

                  <td>{stop.address}</td>
                  <td>{stop.commune || '-'}</td>
                  <td>{stop.detail}</td>
                  <td>{stop.source}</td>

                  <td>
                    <div
                      style={{
                        display: 'flex',
                        gap: '7px',
                      }}
                    >
                      <button
                        type="button"
                        className="mini-button"
                        onClick={() =>
                          moveStop(stop.id, 'up')
                        }
                        title="Subir"
                      >
                        <ArrowUp size={14} />
                      </button>

                      <button
                        type="button"
                        className="mini-button"
                        onClick={() =>
                          moveStop(stop.id, 'down')
                        }
                        title="Bajar"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </section>
  );
}