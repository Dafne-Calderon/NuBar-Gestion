-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Agrega precio por kilo y costos profesionales por receta.
-- También corrige la migración antigua que podía multiplicar el precio por 1.000.

alter table public.ingredients
  add column if not exists price_per_kg numeric not null default 0;

-- Corrección segura para datos heredados con este patrón:
-- unit_cost = precio real por kilo y price_per_kg = unit_cost * 1.000.
update public.ingredients
set price_per_kg = unit_cost,
    unit_cost = unit_cost / 1000
where price_per_kg >= 1000000
  and unit_cost >= 100
  and unit_cost < 1000000
  and abs(price_per_kg - (unit_cost * 1000)) <= greatest(1, price_per_kg * 0.000001);

-- Migra registros donde aún no existe precio por kilo.
-- Valores menores a $100 suelen corresponder al antiguo costo por gramo.
-- Valores desde $100 se interpretan como precio por kilo ingresado por el usuario.
update public.ingredients
set price_per_kg = case
  when unit_cost >= 100 then unit_cost
  else unit_cost * 1000
end
where price_per_kg = 0
  and unit_cost > 0;

-- Mantiene el costo por gramo como dato derivado del precio por kilo.
update public.ingredients
set unit_cost = price_per_kg / 1000
where price_per_kg > 0;

create or replace function public.sync_ingredient_price_units()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.price_per_kg := greatest(coalesce(new.price_per_kg, 0), 0);
  new.unit_cost := new.price_per_kg / 1000;
  return new;
end;
$$;

drop trigger if exists ingredients_sync_price_units on public.ingredients;
create trigger ingredients_sync_price_units
before insert or update of price_per_kg on public.ingredients
for each row execute function public.sync_ingredient_price_units();

alter table public.recipes
  add column if not exists packaging_cost numeric not null default 0,
  add column if not exists label_cost numeric not null default 0,
  add column if not exists labor_cost numeric not null default 0,
  add column if not exists energy_cost numeric not null default 0,
  add column if not exists transport_cost numeric not null default 0,
  add column if not exists advertising_cost numeric not null default 0,
  add column if not exists operational_cost numeric not null default 0,
  add column if not exists other_cost numeric not null default 0,
  add column if not exists waste_percent numeric not null default 0,
  add column if not exists commission_percent numeric not null default 0,
  add column if not exists desired_margin_percent numeric not null default 30,
  add column if not exists vat_percent numeric not null default 19;
