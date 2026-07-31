-- =============================================================
-- NÜBAR: STOCK DE BARRITAS, VENDEDORES, PEDIDOS Y DELIVERY
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
-- Requiere haber ejecutado schema.sql y production_inventory.sql.
-- =============================================================

create extension if not exists pgcrypto;

-- 1) Configuración profesional de delivery.
create table if not exists public.sales_settings (
  id smallint primary key default 1 check (id = 1),
  fuel_price_per_liter numeric not null default 1300 check (fuel_price_per_liter >= 0),
  vehicle_km_per_liter numeric not null default 30 check (vehicle_km_per_liter > 0),
  maintenance_cost_per_km numeric not null default 50 check (maintenance_cost_per_km >= 0),
  delivery_base_fee numeric not null default 1000 check (delivery_base_fee >= 0),
  minimum_delivery_fee numeric not null default 2000 check (minimum_delivery_fee >= 0),
  delivery_margin_percent numeric not null default 20 check (delivery_margin_percent >= 0),
  round_trip boolean not null default true,
  auto_split_production boolean not null default true,
  origin_address text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.sales_settings (id)
values (1)
on conflict (id) do nothing;

-- 2) Vendedores. Se pueden crear ahora o más adelante.
create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  user_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 3) Comunas/sectores y día asignado de reparto (lunes a viernes).
create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  commune text not null unique,
  weekday smallint not null check (weekday between 1 and 5),
  default_distance_km numeric not null default 0 check (default_distance_km >= 0),
  base_fee_override numeric check (base_fee_override is null or base_fee_override >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 4) Stock de producto terminado en bodega y por vendedor.
create table if not exists public.finished_goods_inventory (
  recipe_id uuid primary key references public.recipes(id) on delete cascade,
  warehouse_bars integer not null default 0 check (warehouse_bars >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_inventory (
  seller_id uuid not null references public.sellers(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  available_bars integer not null default 0 check (available_bars >= 0),
  updated_at timestamptz not null default now(),
  primary key (seller_id, recipe_id)
);

-- 5) Más información para pedidos y estados reales.
alter table public.orders
  add column if not exists seller_id uuid references public.sellers(id) on delete set null,
  add column if not exists commune text,
  add column if not exists distance_km numeric not null default 0,
  add column if not exists delivery_fee numeric not null default 0,
  add column if not exists stock_source text not null default 'warehouse',
  add column if not exists stock_deducted boolean not null default false,
  add column if not exists ready_at timestamptz,
  add column if not exists delivered_at timestamptz;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('pendiente', 'en_produccion', 'listo', 'entregado', 'cancelado'));

alter table public.orders drop constraint if exists orders_stock_source_check;
alter table public.orders
  add constraint orders_stock_source_check
  check (stock_source in ('warehouse', 'seller'));

alter table public.orders drop constraint if exists orders_distance_km_check;
alter table public.orders
  add constraint orders_distance_km_check check (distance_km >= 0);

alter table public.orders drop constraint if exists orders_delivery_fee_check;
alter table public.orders
  add constraint orders_delivery_fee_check check (delivery_fee >= 0);

-- Los pedidos anteriores se consideran ya rebajados al crear el saldo inicial.
update public.orders
set stock_source = 'warehouse',
    stock_deducted = (status <> 'cancelado')
where seller_id is null;

-- 6) Trazabilidad del stock de barritas.
create table if not exists public.finished_goods_movements (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  seller_id uuid references public.sellers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  production_id uuid references public.production_logs(id) on delete set null,
  movement_type text not null check (movement_type in ('produccion','distribucion','pedido','reposicion','ajuste')),
  quantity integer not null check (quantity > 0),
  previous_stock integer not null,
  new_stock integer not null,
  notes text,
  registered_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 7) Saldos iniciales: producciones históricas menos pedidos no cancelados.
insert into public.finished_goods_inventory (recipe_id, warehouse_bars)
select
  r.id,
  greatest(
    coalesce((select sum(pl.quantity_bars) from public.production_logs pl where pl.recipe_id = r.id), 0)
    - coalesce((select sum(o.quantity_bars) from public.orders o where o.recipe_id = r.id and o.status <> 'cancelado'), 0),
    0
  )::integer
from public.recipes r
on conflict (recipe_id) do nothing;

-- =============================================================
-- CÁLCULO DE DELIVERY
-- Distancia ingresada = solo ida.
-- Se considera ida y vuelta si round_trip está activado.
-- =============================================================
create or replace function public.calculate_delivery_fee(
  p_distance_km numeric,
  p_commune text default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.sales_settings%rowtype;
  v_zone public.delivery_zones%rowtype;
  v_distance numeric := greatest(coalesce(p_distance_km, 0), 0);
  v_total_km numeric;
  v_base numeric;
  v_fuel numeric;
  v_maintenance numeric;
  v_suggested numeric;
begin
  select * into v_settings from public.sales_settings where id = 1;

  if p_commune is not null and trim(p_commune) <> '' then
    select * into v_zone
    from public.delivery_zones
    where lower(trim(commune)) = lower(trim(p_commune)) and active = true
    limit 1;

    if found and v_distance = 0 then
      v_distance := v_zone.default_distance_km;
    end if;
  end if;

  v_total_km := v_distance * case when coalesce(v_settings.round_trip, true) then 2 else 1 end;
  v_base := coalesce(v_zone.base_fee_override, v_settings.delivery_base_fee, 0);
  v_fuel := (v_total_km / greatest(v_settings.vehicle_km_per_liter, 0.001)) * v_settings.fuel_price_per_liter;
  v_maintenance := v_total_km * v_settings.maintenance_cost_per_km;
  v_suggested := (v_base + v_fuel + v_maintenance) * (1 + v_settings.delivery_margin_percent / 100);
  v_suggested := greatest(v_settings.minimum_delivery_fee, v_suggested);

  -- Precio comercial redondeado hacia arriba al siguiente múltiplo de $100.
  return ceil(v_suggested / 100) * 100;
end;
$$;

-- =============================================================
-- AJUSTAR STOCK GENERAL DE BARRITAS
-- =============================================================
create or replace function public.adjust_finished_stock(
  p_recipe_id uuid,
  p_new_quantity integer,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous integer;
begin
  if auth.uid() is null or coalesce(public.user_role(), '') not in ('admin','produccion') then
    raise exception 'No tienes permisos para ajustar el stock de barritas.';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'El stock debe ser cero o un número mayor.';
  end if;

  if not exists (select 1 from public.recipes where id = p_recipe_id) then
    raise exception 'La receta no existe.';
  end if;

  insert into public.finished_goods_inventory (recipe_id, warehouse_bars)
  values (p_recipe_id, 0)
  on conflict (recipe_id) do nothing;

  select warehouse_bars into v_previous
  from public.finished_goods_inventory
  where recipe_id = p_recipe_id
  for update;

  update public.finished_goods_inventory
  set warehouse_bars = p_new_quantity,
      updated_at = now()
  where recipe_id = p_recipe_id;

  if v_previous <> p_new_quantity then
    insert into public.finished_goods_movements (
      recipe_id, movement_type, quantity, previous_stock, new_stock, notes, registered_by
    ) values (
      p_recipe_id, 'ajuste', abs(p_new_quantity - v_previous), v_previous, p_new_quantity,
      nullif(trim(coalesce(p_notes, '')), ''), auth.uid()
    );
  end if;

  return jsonb_build_object('success', true, 'previous_stock', v_previous, 'new_stock', p_new_quantity);
end;
$$;

-- =============================================================
-- DISTRIBUIR TODO EL STOCK DE BODEGA 50/50 ENTRE 2 VENDEDORES
-- =============================================================
create or replace function public.split_warehouse_stock(
  p_recipe_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sellers uuid[];
  v_warehouse integer;
  v_first integer;
  v_second integer;
  v_previous integer;
  v_result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or coalesce(public.user_role(), '') <> 'admin' then
    raise exception 'Solo administración puede distribuir stock entre vendedores.';
  end if;

  select array_agg(id order by created_at, id) into v_sellers
  from public.sellers
  where active = true;

  if coalesce(cardinality(v_sellers), 0) <> 2 then
    return jsonb_build_object(
      'success', false,
      'message', 'Debes tener exactamente 2 vendedores activos para distribuir 50/50.'
    );
  end if;

  insert into public.finished_goods_inventory (recipe_id, warehouse_bars)
  values (p_recipe_id, 0)
  on conflict (recipe_id) do nothing;

  select warehouse_bars into v_warehouse
  from public.finished_goods_inventory
  where recipe_id = p_recipe_id
  for update;

  if v_warehouse <= 0 then
    return jsonb_build_object('success', false, 'message', 'No hay barritas en bodega para distribuir.');
  end if;

  v_first := floor(v_warehouse / 2.0)::integer;
  v_second := v_warehouse - v_first;

  for i in 1..2 loop
    insert into public.seller_inventory (seller_id, recipe_id, available_bars)
    values (v_sellers[i], p_recipe_id, 0)
    on conflict (seller_id, recipe_id) do nothing;

    select available_bars into v_previous
    from public.seller_inventory
    where seller_id = v_sellers[i] and recipe_id = p_recipe_id
    for update;

    update public.seller_inventory
    set available_bars = available_bars + case when i = 1 then v_first else v_second end,
        updated_at = now()
    where seller_id = v_sellers[i] and recipe_id = p_recipe_id;

    insert into public.finished_goods_movements (
      recipe_id, seller_id, movement_type, quantity, previous_stock, new_stock, notes, registered_by
    ) values (
      p_recipe_id,
      v_sellers[i],
      'distribucion',
      case when i = 1 then v_first else v_second end,
      v_previous,
      v_previous + case when i = 1 then v_first else v_second end,
      'Distribución 50/50 desde bodega',
      auth.uid()
    );

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'seller_id', v_sellers[i],
      'quantity', case when i = 1 then v_first else v_second end
    ));
  end loop;

  insert into public.finished_goods_movements (
    recipe_id, movement_type, quantity, previous_stock, new_stock, notes, registered_by
  ) values (
    p_recipe_id, 'distribucion', v_warehouse, v_warehouse, 0,
    'Salida de bodega para distribución 50/50', auth.uid()
  );

  update public.finished_goods_inventory
  set warehouse_bars = 0, updated_at = now()
  where recipe_id = p_recipe_id;

  return jsonb_build_object('success', true, 'distributed', v_warehouse, 'allocations', v_result);
end;
$$;

-- =============================================================
-- CREAR PEDIDO Y DESCONTAR STOCK ATÓMICAMENTE
-- =============================================================
create or replace function public.create_order_with_stock(
  p_recipe_id uuid,
  p_quantity_bars integer,
  p_customer text,
  p_delivery_date timestamptz,
  p_address text,
  p_commune text default null,
  p_distance_km numeric default 0,
  p_seller_id uuid default null,
  p_notes text default null,
  p_status text default 'pendiente'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available integer;
  v_new integer;
  v_order_id uuid;
  v_fee numeric;
  v_zone public.delivery_zones%rowtype;
  v_distance numeric := greatest(coalesce(p_distance_km, 0), 0);
  v_delivery_weekday integer;
  v_source text;
begin
  if auth.uid() is null or coalesce(public.user_role(), '') not in ('admin','ventas') then
    raise exception 'No tienes permisos para agendar pedidos.';
  end if;

  if p_quantity_bars is null or p_quantity_bars <= 0 then
    raise exception 'La cantidad de barritas debe ser mayor que cero.';
  end if;

  if coalesce(trim(p_customer), '') = '' or coalesce(trim(p_address), '') = '' or p_delivery_date is null then
    raise exception 'Completa cliente, fecha y dirección.';
  end if;

  if p_status not in ('pendiente','en_produccion','listo') then
    p_status := 'pendiente';
  end if;

  if not exists (select 1 from public.recipes where id = p_recipe_id and active = true) then
    raise exception 'La receta no existe o está inactiva.';
  end if;

  if p_commune is not null and trim(p_commune) <> '' then
    select * into v_zone
    from public.delivery_zones
    where lower(trim(commune)) = lower(trim(p_commune)) and active = true
    limit 1;

    if found then
      v_delivery_weekday := extract(isodow from (p_delivery_date at time zone 'America/Santiago'))::integer;
      if v_delivery_weekday <> v_zone.weekday then
        return jsonb_build_object(
          'success', false,
          'message', 'La comuna seleccionada tiene otro día de reparto.',
          'expected_weekday', v_zone.weekday
        );
      end if;

      if v_distance = 0 then
        v_distance := v_zone.default_distance_km;
      end if;
    end if;
  end if;

  v_fee := public.calculate_delivery_fee(v_distance, p_commune);

  if p_seller_id is not null then
    if not exists (select 1 from public.sellers where id = p_seller_id and active = true) then
      raise exception 'El vendedor seleccionado no existe o está inactivo.';
    end if;

    insert into public.seller_inventory (seller_id, recipe_id, available_bars)
    values (p_seller_id, p_recipe_id, 0)
    on conflict (seller_id, recipe_id) do nothing;

    select available_bars into v_available
    from public.seller_inventory
    where seller_id = p_seller_id and recipe_id = p_recipe_id
    for update;

    v_source := 'seller';
  else
    insert into public.finished_goods_inventory (recipe_id, warehouse_bars)
    values (p_recipe_id, 0)
    on conflict (recipe_id) do nothing;

    select warehouse_bars into v_available
    from public.finished_goods_inventory
    where recipe_id = p_recipe_id
    for update;

    v_source := 'warehouse';
  end if;

  if v_available < p_quantity_bars then
    return jsonb_build_object(
      'success', false,
      'message', 'No hay suficientes barritas disponibles para agendar este pedido.',
      'available', v_available,
      'requested', p_quantity_bars
    );
  end if;

  v_new := v_available - p_quantity_bars;

  if v_source = 'seller' then
    update public.seller_inventory
    set available_bars = v_new, updated_at = now()
    where seller_id = p_seller_id and recipe_id = p_recipe_id;
  else
    update public.finished_goods_inventory
    set warehouse_bars = v_new, updated_at = now()
    where recipe_id = p_recipe_id;
  end if;

  insert into public.orders (
    recipe_id, quantity_bars, customer, delivery_date, address, commune,
    distance_km, delivery_fee, seller_id, notes, status,
    stock_source, stock_deducted, created_by
  ) values (
    p_recipe_id, p_quantity_bars, trim(p_customer), p_delivery_date, trim(p_address),
    nullif(trim(coalesce(p_commune, '')), ''), v_distance, v_fee, p_seller_id,
    nullif(trim(coalesce(p_notes, '')), ''), p_status,
    v_source, true, auth.uid()
  ) returning id into v_order_id;

  insert into public.finished_goods_movements (
    recipe_id, seller_id, order_id, movement_type, quantity,
    previous_stock, new_stock, notes, registered_by
  ) values (
    p_recipe_id, p_seller_id, v_order_id, 'pedido', p_quantity_bars,
    v_available, v_new, 'Stock reservado al agendar pedido', auth.uid()
  );

  return jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'remaining_stock', v_new,
    'delivery_fee', v_fee,
    'distance_km', v_distance,
    'stock_source', v_source
  );
end;
$$;

-- =============================================================
-- CAMBIAR ESTADO. AL CANCELAR, REPONE STOCK AUTOMÁTICAMENTE.
-- =============================================================
create or replace function public.update_order_status_with_stock(
  p_order_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_previous integer;
  v_new integer;
begin
  if auth.uid() is null or coalesce(public.user_role(), '') not in ('admin','ventas','produccion') then
    raise exception 'No tienes permisos para cambiar el estado del pedido.';
  end if;

  if p_status not in ('pendiente','en_produccion','listo','entregado','cancelado') then
    raise exception 'Estado de pedido inválido.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'El pedido no existe.';
  end if;

  if v_order.status = 'cancelado' and p_status <> 'cancelado' then
    return jsonb_build_object(
      'success', false,
      'message', 'Un pedido cancelado no puede reabrirse. Crea un pedido nuevo.'
    );
  end if;

  if p_status = 'cancelado' and v_order.status <> 'cancelado' and v_order.stock_deducted then
    if v_order.stock_source = 'seller' and v_order.seller_id is not null then
      insert into public.seller_inventory (seller_id, recipe_id, available_bars)
      values (v_order.seller_id, v_order.recipe_id, 0)
      on conflict (seller_id, recipe_id) do nothing;

      select available_bars into v_previous
      from public.seller_inventory
      where seller_id = v_order.seller_id and recipe_id = v_order.recipe_id
      for update;

      v_new := v_previous + v_order.quantity_bars;

      update public.seller_inventory
      set available_bars = v_new, updated_at = now()
      where seller_id = v_order.seller_id and recipe_id = v_order.recipe_id;
    else
      insert into public.finished_goods_inventory (recipe_id, warehouse_bars)
      values (v_order.recipe_id, 0)
      on conflict (recipe_id) do nothing;

      select warehouse_bars into v_previous
      from public.finished_goods_inventory
      where recipe_id = v_order.recipe_id
      for update;

      v_new := v_previous + v_order.quantity_bars;

      update public.finished_goods_inventory
      set warehouse_bars = v_new, updated_at = now()
      where recipe_id = v_order.recipe_id;
    end if;

    insert into public.finished_goods_movements (
      recipe_id, seller_id, order_id, movement_type, quantity,
      previous_stock, new_stock, notes, registered_by
    ) values (
      v_order.recipe_id, v_order.seller_id, v_order.id, 'reposicion', v_order.quantity_bars,
      v_previous, v_new, 'Reposición automática por pedido cancelado', auth.uid()
    );
  end if;

  update public.orders
  set status = p_status,
      stock_deducted = case when p_status = 'cancelado' then false else stock_deducted end,
      ready_at = case when p_status = 'listo' then coalesce(ready_at, now()) else ready_at end,
      delivered_at = case when p_status = 'entregado' then coalesce(delivered_at, now()) else delivered_at end
  where id = p_order_id;

  return jsonb_build_object('success', true, 'status', p_status, 'restored_stock', coalesce(v_new, 0));
end;
$$;

-- =============================================================
-- PRODUCCIÓN: DESCUENTA INGREDIENTES Y SUMA BARRITAS TERMINADAS.
-- Si hay exactamente 2 vendedores activos, reparte automáticamente 50/50.
-- =============================================================
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
  v_distribution jsonb := '[]'::jsonb;
  v_sellers uuid[];
  v_settings public.sales_settings%rowtype;
  v_alloc integer;
  v_previous_bars integer;
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

  if not exists (select 1 from public.recipe_items where recipe_id = p_recipe_id) then
    raise exception 'La receta no tiene ingredientes configurados.';
  end if;

  perform i.id
  from public.ingredients i
  join public.recipe_items ri on ri.ingredient_id = i.id
  where ri.recipe_id = p_recipe_id
  order by i.id
  for update of i;

  for v_item in
    select ri.ingredient_id, ri.grams_per_batch, i.name, i.unit, i.stock_qty
    from public.recipe_items ri
    join public.ingredients i on i.id = ri.ingredient_id
    where ri.recipe_id = p_recipe_id
    order by i.name
  loop
    v_needed := round((v_item.grams_per_batch * p_quantity_bars::numeric / v_recipe.bars_per_batch), 3);
    if v_needed <= 0 then continue; end if;

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

  insert into public.production_logs (recipe_id, quantity_bars, notes, registered_by)
  values (p_recipe_id, p_quantity_bars, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_production_id;

  for v_item in
    select ri.ingredient_id, ri.grams_per_batch, i.name, i.unit, i.stock_qty
    from public.recipe_items ri
    join public.ingredients i on i.id = ri.ingredient_id
    where ri.recipe_id = p_recipe_id
    order by i.name
  loop
    v_needed := round((v_item.grams_per_batch * p_quantity_bars::numeric / v_recipe.bars_per_batch), 3);
    if v_needed <= 0 then continue; end if;

    v_previous := v_item.stock_qty;
    v_new := v_previous - v_needed;

    update public.ingredients set stock_qty = v_new where id = v_item.ingredient_id;

    insert into public.inventory_movements (
      ingredient_id, movement_type, quantity, previous_stock, new_stock,
      recipe_id, production_id, notes, registered_by
    ) values (
      v_item.ingredient_id, 'produccion', v_needed, v_previous, v_new,
      p_recipe_id, v_production_id,
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

  select * into v_settings from public.sales_settings where id = 1;
  select array_agg(id order by created_at, id) into v_sellers
  from public.sellers where active = true;

  if coalesce(v_settings.auto_split_production, true) and coalesce(cardinality(v_sellers), 0) = 2 then
    for i in 1..2 loop
      v_alloc := case when i = 1 then floor(p_quantity_bars / 2.0)::integer else p_quantity_bars - floor(p_quantity_bars / 2.0)::integer end;

      insert into public.seller_inventory (seller_id, recipe_id, available_bars)
      values (v_sellers[i], p_recipe_id, 0)
      on conflict (seller_id, recipe_id) do nothing;

      select available_bars into v_previous_bars
      from public.seller_inventory
      where seller_id = v_sellers[i] and recipe_id = p_recipe_id
      for update;

      update public.seller_inventory
      set available_bars = available_bars + v_alloc, updated_at = now()
      where seller_id = v_sellers[i] and recipe_id = p_recipe_id;

      insert into public.finished_goods_movements (
        recipe_id, seller_id, production_id, movement_type, quantity,
        previous_stock, new_stock, notes, registered_by
      ) values (
        p_recipe_id, v_sellers[i], v_production_id, 'produccion', v_alloc,
        v_previous_bars, v_previous_bars + v_alloc,
        'Producción distribuida automáticamente 50/50', auth.uid()
      );

      v_distribution := v_distribution || jsonb_build_array(jsonb_build_object(
        'seller_id', v_sellers[i], 'quantity', v_alloc, 'source', 'seller'
      ));
    end loop;
  else
    insert into public.finished_goods_inventory (recipe_id, warehouse_bars)
    values (p_recipe_id, 0)
    on conflict (recipe_id) do nothing;

    select warehouse_bars into v_previous_bars
    from public.finished_goods_inventory
    where recipe_id = p_recipe_id
    for update;

    update public.finished_goods_inventory
    set warehouse_bars = warehouse_bars + p_quantity_bars, updated_at = now()
    where recipe_id = p_recipe_id;

    insert into public.finished_goods_movements (
      recipe_id, production_id, movement_type, quantity,
      previous_stock, new_stock, notes, registered_by
    ) values (
      p_recipe_id, v_production_id, 'produccion', p_quantity_bars,
      v_previous_bars, v_previous_bars + p_quantity_bars,
      'Producción agregada a bodega', auth.uid()
    );

    v_distribution := jsonb_build_array(jsonb_build_object(
      'quantity', p_quantity_bars, 'source', 'warehouse'
    ));
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'Producción registrada, ingredientes descontados y stock de barritas actualizado.',
    'production_id', v_production_id,
    'recipe_name', v_recipe.name,
    'quantity_bars', p_quantity_bars,
    'consumption', v_consumption,
    'distribution', v_distribution
  );
end;
$$;

-- =============================================================
-- RLS Y PERMISOS
-- =============================================================
alter table public.sales_settings enable row level security;
alter table public.sellers enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.finished_goods_inventory enable row level security;
alter table public.seller_inventory enable row level security;
alter table public.finished_goods_movements enable row level security;

drop policy if exists "sales_settings_select_authenticated" on public.sales_settings;
create policy "sales_settings_select_authenticated" on public.sales_settings
for select to authenticated using (true);

drop policy if exists "sales_settings_write_admin" on public.sales_settings;
create policy "sales_settings_write_admin" on public.sales_settings
for all to authenticated using (public.user_role() = 'admin') with check (public.user_role() = 'admin');

drop policy if exists "sellers_select_authenticated" on public.sellers;
create policy "sellers_select_authenticated" on public.sellers
for select to authenticated using (true);

drop policy if exists "sellers_write_admin" on public.sellers;
create policy "sellers_write_admin" on public.sellers
for all to authenticated using (public.user_role() = 'admin') with check (public.user_role() = 'admin');

drop policy if exists "delivery_zones_select_authenticated" on public.delivery_zones;
create policy "delivery_zones_select_authenticated" on public.delivery_zones
for select to authenticated using (true);

drop policy if exists "delivery_zones_write_admin" on public.delivery_zones;
create policy "delivery_zones_write_admin" on public.delivery_zones
for all to authenticated using (public.user_role() = 'admin') with check (public.user_role() = 'admin');

drop policy if exists "finished_goods_select_authenticated" on public.finished_goods_inventory;
create policy "finished_goods_select_authenticated" on public.finished_goods_inventory
for select to authenticated using (true);

drop policy if exists "seller_inventory_select_authenticated" on public.seller_inventory;
create policy "seller_inventory_select_authenticated" on public.seller_inventory
for select to authenticated using (true);

drop policy if exists "finished_goods_movements_select_authenticated" on public.finished_goods_movements;
create policy "finished_goods_movements_select_authenticated" on public.finished_goods_movements
for select to authenticated using (true);

grant select on public.sales_settings, public.sellers, public.delivery_zones,
  public.finished_goods_inventory, public.seller_inventory, public.finished_goods_movements
to authenticated;

grant insert, update, delete on public.sellers, public.delivery_zones to authenticated;
grant update on public.sales_settings to authenticated;

revoke all on function public.calculate_delivery_fee(numeric, text) from public;
revoke all on function public.adjust_finished_stock(uuid, integer, text) from public;
revoke all on function public.split_warehouse_stock(uuid) from public;
revoke all on function public.create_order_with_stock(uuid, integer, text, timestamptz, text, text, numeric, uuid, text, text) from public;
revoke all on function public.update_order_status_with_stock(uuid, text) from public;
revoke all on function public.produce_recipe(uuid, integer, text) from public;

grant execute on function public.calculate_delivery_fee(numeric, text) to authenticated;
grant execute on function public.adjust_finished_stock(uuid, integer, text) to authenticated;
grant execute on function public.split_warehouse_stock(uuid) to authenticated;
grant execute on function public.create_order_with_stock(uuid, integer, text, timestamptz, text, text, numeric, uuid, text, text) to authenticated;
grant execute on function public.update_order_status_with_stock(uuid, text) to authenticated;
grant execute on function public.produce_recipe(uuid, integer, text) to authenticated;
