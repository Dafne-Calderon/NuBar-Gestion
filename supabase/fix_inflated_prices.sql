-- Corrección puntual para instalaciones donde el precio por kilo fue multiplicado por 1.000.
-- Puedes ejecutar el SELECT primero para revisar qué ingredientes serán corregidos.

select
  id,
  name,
  price_per_kg as precio_inflado,
  unit_cost as precio_real_por_kilo_detectado
from public.ingredients
where price_per_kg >= 1000000
  and unit_cost >= 100
  and unit_cost < 1000000
  and abs(price_per_kg - (unit_cost * 1000)) <= greatest(1, price_per_kg * 0.000001);

update public.ingredients
set price_per_kg = unit_cost,
    unit_cost = unit_cost / 1000
where price_per_kg >= 1000000
  and unit_cost >= 100
  and unit_cost < 1000000
  and abs(price_per_kg - (unit_cost * 1000)) <= greatest(1, price_per_kg * 0.000001);
