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
