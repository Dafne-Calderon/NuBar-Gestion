-- NüBar Gestión - Base de datos Supabase

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text unique not null,
  role text not null default 'usuario' check (role in ('admin', 'produccion', 'ventas', 'usuario')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) not like '%@nubar.cl' then
    raise exception 'Solo se permiten correos corporativos @nubar.cl';
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    lower(new.email),
    'usuario'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'g',
  stock_qty numeric not null default 0,
  min_stock numeric not null default 0,
  unit_cost numeric not null default 0,
  price_per_kg numeric not null default 0,
  supplier text,
  kcal_100g numeric not null default 0,
  protein_100g numeric not null default 0,
  carbs_100g numeric not null default 0,
  sugars_100g numeric not null default 0,
  fat_100g numeric not null default 0,
  sat_fat_100g numeric not null default 0,
  trans_fat_100g numeric not null default 0,
  fiber_100g numeric not null default 0,
  sodium_mg_100g numeric not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

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

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  bars_per_batch numeric not null default 35,
  bar_weight_g numeric not null default 60,
  sale_price numeric not null default 0,
  packaging_cost numeric not null default 0,
  label_cost numeric not null default 0,
  labor_cost numeric not null default 0,
  energy_cost numeric not null default 0,
  transport_cost numeric not null default 0,
  advertising_cost numeric not null default 0,
  operational_cost numeric not null default 0,
  other_cost numeric not null default 0,
  waste_percent numeric not null default 0,
  commission_percent numeric not null default 0,
  desired_margin_percent numeric not null default 30,
  vat_percent numeric not null default 19,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  grams_per_batch numeric not null default 0,
  unique(recipe_id, ingredient_id)
);

create table if not exists public.wastes (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id),
  qty numeric not null,
  reason text not null,
  waste_date date not null default current_date,
  registered_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references public.recipes(id),
  quantity_bars integer not null default 0,
  customer text not null,
  delivery_date timestamptz not null,
  address text not null,
  notes text,
  status text not null default 'pendiente' check (status in ('pendiente', 'en_produccion', 'entregado', 'cancelado')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.production_logs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id),
  quantity_bars integer not null,
  produced_at timestamptz not null default now(),
  notes text,
  registered_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.wastes enable row level security;
alter table public.orders enable row level security;
alter table public.production_logs enable row level security;

-- Reiniciar políticas si ya existían
DO $$
DECLARE r record;
BEGIN
  FOR r IN (
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','ingredients','recipes','recipe_items','wastes','orders','production_logs')
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

create policy "profiles_select_authenticated" on public.profiles
for select to authenticated using (true);

create policy "profiles_update_admin_only" on public.profiles
for update to authenticated using (public.is_admin())
with check (public.is_admin());

create policy "ingredients_select_authenticated" on public.ingredients
for select to authenticated using (true);

create policy "ingredients_write_admin_produccion" on public.ingredients
for all to authenticated
using (public.user_role() in ('admin','produccion'))
with check (public.user_role() in ('admin','produccion'));

create policy "recipes_select_authenticated" on public.recipes
for select to authenticated using (true);

create policy "recipes_write_admin_produccion" on public.recipes
for all to authenticated
using (public.user_role() in ('admin','produccion'))
with check (public.user_role() in ('admin','produccion'));

create policy "recipe_items_select_authenticated" on public.recipe_items
for select to authenticated using (true);

create policy "recipe_items_write_admin_produccion" on public.recipe_items
for all to authenticated
using (public.user_role() in ('admin','produccion'))
with check (public.user_role() in ('admin','produccion'));

create policy "wastes_select_authenticated" on public.wastes
for select to authenticated using (true);

create policy "wastes_write_admin_produccion" on public.wastes
for insert to authenticated
with check (public.user_role() in ('admin','produccion'));

create policy "orders_select_authenticated" on public.orders
for select to authenticated using (true);

create policy "orders_write_admin_ventas_produccion" on public.orders
for all to authenticated
using (public.user_role() in ('admin','ventas','produccion'))
with check (public.user_role() in ('admin','ventas','produccion'));

create policy "production_select_authenticated" on public.production_logs
for select to authenticated using (true);

create policy "production_write_admin_produccion" on public.production_logs
for insert to authenticated
with check (public.user_role() in ('admin','produccion'));

-- Datos de ejemplo. Puedes borrarlos si deseas empezar desde cero.
insert into public.ingredients
(name, unit, stock_qty, min_stock, unit_cost, price_per_kg, supplier, kcal_100g, protein_100g, carbs_100g, sugars_100g, fat_100g, sat_fat_100g, trans_fat_100g, fiber_100g, sodium_mg_100g)
values
('Maní', 'g', 10000, 2000, 4.2, 4200, 'Proveedor base', 567, 25.8, 16.1, 4.7, 49.2, 6.8, 0, 8.5, 18),
('Dátiles', 'g', 5000, 1000, 6.5, 6500, 'Proveedor base', 282, 2.5, 75, 63.4, 0.4, 0.03, 0, 8, 2),
('Avena', 'g', 8000, 1500, 2.1, 2100, 'Proveedor base', 389, 16.9, 66.3, 0.9, 6.9, 1.2, 0, 10.6, 2),
('Semillas de zapallo', 'g', 3000, 500, 7.8, 7800, 'Proveedor base', 559, 30.2, 10.7, 1.4, 49, 8.7, 0, 6, 7),
('Cranberry', 'g', 3000, 500, 8.5, 8500, 'Proveedor base', 325, 0.1, 82, 65, 1.4, 0.1, 0, 5.3, 3),
('Aceite de coco', 'g', 1000, 200, 6.0, 6000, 'Proveedor base', 892, 0, 0, 0, 99, 82.5, 0, 0, 0),
('Chocolate cobertura', 'g', 7000, 1000, 5.9, 5900, 'Proveedor base', 535, 5, 58, 48, 32, 19, 0, 4, 40)
on conflict do nothing;

-- Receta base de ejemplo: NüBar Clásica, 35 barritas
with new_recipe as (
  insert into public.recipes (name, description, bars_per_batch, bar_weight_g, sale_price)
  values ('NüBar Clásica', 'Receta base de maní, dátiles, avena, semillas, cranberry y chocolate.', 35, 60, 1800)
  returning id
)
insert into public.recipe_items (recipe_id, ingredient_id, grams_per_batch)
select new_recipe.id, ingredients.id,
  case ingredients.name
    when 'Maní' then 900
    when 'Dátiles' then 300
    when 'Avena' then 300
    when 'Semillas de zapallo' then 60
    when 'Cranberry' then 60
    when 'Aceite de coco' then 5
    when 'Chocolate cobertura' then 500
  end
from new_recipe, public.ingredients
where ingredients.name in ('Maní','Dátiles','Avena','Semillas de zapallo','Cranberry','Aceite de coco','Chocolate cobertura')
on conflict do nothing;


update public.profiles
set role = 'admin'
where email = 'admin@nubar.cl';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) not like '%@nubar.cl'
     and lower(new.email) not like '%@gmail.com' then
    raise exception 'Solo se permiten correos @gmail.com para pruebas o @nubar.cl corporativo';
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    lower(new.email),
    'usuario'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- =====================================================
-- NÜBAR GESTIÓN - POLÍTICAS ADMIN
-- Admin puede agregar/modificar inventario, recetas,
-- mermas, pedidos y marcar entregas como listas.
-- =====================================================

-- 1. Función para obtener el rol del usuario actual
create or replace function public.user_role()
returns text
language sql
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

-- 2. Activar RLS en tablas principales
alter table public.profiles enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.wastes enable row level security;
alter table public.orders enable row level security;

-- 3. Eliminar políticas anteriores si existen
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_admin_update" on public.profiles;

drop policy if exists "ingredients_select_authenticated" on public.ingredients;
drop policy if exists "ingredients_admin_insert" on public.ingredients;
drop policy if exists "ingredients_admin_update" on public.ingredients;
drop policy if exists "ingredients_admin_delete" on public.ingredients;

drop policy if exists "recipes_select_authenticated" on public.recipes;
drop policy if exists "recipes_admin_insert" on public.recipes;
drop policy if exists "recipes_admin_update" on public.recipes;
drop policy if exists "recipes_admin_delete" on public.recipes;

drop policy if exists "recipe_items_select_authenticated" on public.recipe_items;
drop policy if exists "recipe_items_admin_insert" on public.recipe_items;
drop policy if exists "recipe_items_admin_update" on public.recipe_items;
drop policy if exists "recipe_items_admin_delete" on public.recipe_items;

drop policy if exists "wastes_select_authenticated" on public.wastes;
drop policy if exists "wastes_admin_insert" on public.wastes;
drop policy if exists "wastes_admin_update" on public.wastes;
drop policy if exists "wastes_admin_delete" on public.wastes;

drop policy if exists "orders_select_authenticated" on public.orders;
drop policy if exists "orders_admin_insert" on public.orders;
drop policy if exists "orders_admin_update" on public.orders;
drop policy if exists "orders_admin_delete" on public.orders;

-- 4. Políticas para perfiles
create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.user_role() = 'admin'
);

create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

-- 5. Inventario / ingredientes
create policy "ingredients_select_authenticated"
on public.ingredients
for select
to authenticated
using (true);

create policy "ingredients_admin_insert"
on public.ingredients
for insert
to authenticated
with check (public.user_role() = 'admin');

create policy "ingredients_admin_update"
on public.ingredients
for update
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

create policy "ingredients_admin_delete"
on public.ingredients
for delete
to authenticated
using (public.user_role() = 'admin');

-- 6. Recetas
create policy "recipes_select_authenticated"
on public.recipes
for select
to authenticated
using (true);

create policy "recipes_admin_insert"
on public.recipes
for insert
to authenticated
with check (public.user_role() = 'admin');

create policy "recipes_admin_update"
on public.recipes
for update
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

create policy "recipes_admin_delete"
on public.recipes
for delete
to authenticated
using (public.user_role() = 'admin');

-- 7. Ingredientes de recetas
create policy "recipe_items_select_authenticated"
on public.recipe_items
for select
to authenticated
using (true);

create policy "recipe_items_admin_insert"
on public.recipe_items
for insert
to authenticated
with check (public.user_role() = 'admin');

create policy "recipe_items_admin_update"
on public.recipe_items
for update
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

create policy "recipe_items_admin_delete"
on public.recipe_items
for delete
to authenticated
using (public.user_role() = 'admin');

-- 8. Mermas
create policy "wastes_select_authenticated"
on public.wastes
for select
to authenticated
using (true);

create policy "wastes_admin_insert"
on public.wastes
for insert
to authenticated
with check (public.user_role() = 'admin');

create policy "wastes_admin_update"
on public.wastes
for update
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

create policy "wastes_admin_delete"
on public.wastes
for delete
to authenticated
using (public.user_role() = 'admin');

-- 9. Pedidos y entregas
create policy "orders_select_authenticated"
on public.orders
for select
to authenticated
using (true);

create policy "orders_admin_insert"
on public.orders
for insert
to authenticated
with check (public.user_role() = 'admin');

create policy "orders_admin_update"
on public.orders
for update
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

create policy "orders_admin_delete"
on public.orders
for delete
to authenticated
using (public.user_role() = 'admin');

-- 10. Asegurar permisos base
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select on public.ingredients to authenticated;
grant select on public.recipes to authenticated;
grant select on public.recipe_items to authenticated;
grant select on public.wastes to authenticated;
grant select on public.orders to authenticated;

grant insert, update, delete on public.ingredients to authenticated;
grant insert, update, delete on public.recipes to authenticated;
grant insert, update, delete on public.recipe_items to authenticated;
grant insert, update, delete on public.wastes to authenticated;
grant insert, update, delete on public.orders to authenticated;
grant update on public.profiles to authenticated;

update public.profiles
set role = 'admin'
where email = 'nubarcontacto@gmail.com';


-- =====================================================
-- NÜBAR: PRODUCCIÓN CON DESCUENTO AUTOMÁTICO DE INVENTARIO
-- Ejecutar una vez en Supabase > SQL Editor.
-- =====================================================

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id),
  movement_type text not null check (movement_type in ('entrada','produccion','merma','ajuste')),
  quantity numeric not null check (quantity > 0),
  previous_stock numeric not null,
  new_stock numeric not null,
  recipe_id uuid references public.recipes(id),
  production_id uuid references public.production_logs(id) on delete set null,
  notes text,
  registered_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.inventory_movements enable row level security;

drop policy if exists "inventory_movements_select_authenticated" on public.inventory_movements;
create policy "inventory_movements_select_authenticated"
on public.inventory_movements
for select to authenticated
using (true);

grant select on public.inventory_movements to authenticated;

create or replace function public.produce_recipe(
  p_recipe_id uuid,
  p_quantity_bars integer,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe public.recipes%rowtype;
  v_production_id uuid;
  v_item record;
  v_needed numeric;
  v_previous numeric;
  v_new numeric;
  v_shortages jsonb := '[]'::jsonb;
  v_consumption jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para registrar una producción.';
  end if;

  if coalesce(public.user_role(), '') not in ('admin', 'produccion') then
    raise exception 'No tienes permisos para registrar producción.';
  end if;

  if p_quantity_bars is null or p_quantity_bars <= 0 then
    raise exception 'La cantidad de barritas debe ser mayor que cero.';
  end if;

  select * into v_recipe
  from public.recipes
  where id = p_recipe_id and active = true;

  if not found then
    raise exception 'La receta no existe o está inactiva.';
  end if;

  if coalesce(v_recipe.bars_per_batch, 0) <= 0 then
    raise exception 'La receta tiene una cantidad base inválida.';
  end if;

  if not exists (
    select 1 from public.recipe_items where recipe_id = p_recipe_id
  ) then
    raise exception 'La receta no tiene ingredientes configurados.';
  end if;

  -- Bloquea las filas de ingredientes para evitar descuentos simultáneos incorrectos.
  perform i.id
  from public.ingredients i
  join public.recipe_items ri on ri.ingredient_id = i.id
  where ri.recipe_id = p_recipe_id
  order by i.id
  for update of i;

  -- Primero valida todo el stock. Si falta algo, no descuenta ningún ingrediente.
  for v_item in
    select
      ri.ingredient_id,
      ri.grams_per_batch,
      i.name,
      i.unit,
      i.stock_qty
    from public.recipe_items ri
    join public.ingredients i on i.id = ri.ingredient_id
    where ri.recipe_id = p_recipe_id
    order by i.name
  loop
    v_needed := round((v_item.grams_per_batch * p_quantity_bars::numeric / v_recipe.bars_per_batch), 3);

    if v_needed <= 0 then
      continue;
    end if;

    if v_item.stock_qty < v_needed then
      v_shortages := v_shortages || jsonb_build_array(jsonb_build_object(
        'ingredient_id', v_item.ingredient_id,
        'name', v_item.name,
        'needed', v_needed,
        'stock', v_item.stock_qty,
        'missing', v_needed - v_item.stock_qty,
        'unit', v_item.unit
      ));
    end if;
  end loop;

  if jsonb_array_length(v_shortages) > 0 then
    return jsonb_build_object(
      'success', false,
      'message', 'Inventario insuficiente para completar la producción.',
      'shortages', v_shortages
    );
  end if;

  insert into public.production_logs (
    recipe_id,
    quantity_bars,
    notes,
    registered_by
  ) values (
    p_recipe_id,
    p_quantity_bars,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning id into v_production_id;

  -- Descuenta el inventario y deja trazabilidad por cada ingrediente.
  for v_item in
    select
      ri.ingredient_id,
      ri.grams_per_batch,
      i.name,
      i.unit,
      i.stock_qty
    from public.recipe_items ri
    join public.ingredients i on i.id = ri.ingredient_id
    where ri.recipe_id = p_recipe_id
    order by i.name
  loop
    v_needed := round((v_item.grams_per_batch * p_quantity_bars::numeric / v_recipe.bars_per_batch), 3);

    if v_needed <= 0 then
      continue;
    end if;

    v_previous := v_item.stock_qty;
    v_new := v_previous - v_needed;

    update public.ingredients
    set stock_qty = v_new
    where id = v_item.ingredient_id;

    insert into public.inventory_movements (
      ingredient_id,
      movement_type,
      quantity,
      previous_stock,
      new_stock,
      recipe_id,
      production_id,
      notes,
      registered_by
    ) values (
      v_item.ingredient_id,
      'produccion',
      v_needed,
      v_previous,
      v_new,
      p_recipe_id,
      v_production_id,
      'Producción de ' || p_quantity_bars || ' barritas de ' || v_recipe.name,
      auth.uid()
    );

    v_consumption := v_consumption || jsonb_build_array(jsonb_build_object(
      'ingredient_id', v_item.ingredient_id,
      'name', v_item.name,
      'used', v_needed,
      'previous_stock', v_previous,
      'new_stock', v_new,
      'unit', v_item.unit
    ));
  end loop;

  return jsonb_build_object(
    'success', true,
    'message', 'Producción registrada e inventario actualizado.',
    'production_id', v_production_id,
    'recipe_name', v_recipe.name,
    'quantity_bars', p_quantity_bars,
    'consumption', v_consumption
  );
end;
$$;

revoke all on function public.produce_recipe(uuid, integer, text) from public;
grant execute on function public.produce_recipe(uuid, integer, text) to authenticated;

