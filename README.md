# NüBar Gestión

Aplicación web interna para control de inventario, recetas, costos, márgenes, tabla nutricional, mermas, pedidos, entregas y usuarios con Supabase.


## Producción con descuento automático de inventario

Para activar esta función en una base de datos Supabase que ya estaba creada:

1. Abre **Supabase > SQL Editor**.
2. Copia y ejecuta todo el contenido de `supabase/production_inventory.sql`.
3. Reinicia la aplicación.
4. En **Recetas**, selecciona una receta, ingresa la cantidad y presiona **Producir**.

La operación valida todo el stock antes de comenzar. Si falta un ingrediente, no se descuenta ninguno. Cuando la producción se completa, se registra en `production_logs` y cada salida queda guardada en `inventory_movements`.

## Cálculo profesional de costos

Antes de usar la nueva pantalla de costos, ejecuta en Supabase SQL Editor:

`supabase/professional_costs.sql`

Luego ingresa el **precio de compra por kilo** de cada ingrediente en Inventario. La pantalla Costos calcula ingredientes por lote y por barra, costos adicionales, merma, comisión, margen, utilidad y precio sugerido con IVA.

### Corrección de precios multiplicados por 1.000

La fórmula usada por la aplicación es:

`costo ingrediente = (gramos usados / 1.000) × precio por kilo`

Si una versión anterior dejó precios inflados, la pantalla **Costos y margen** los detecta, usa inmediatamente el valor correcto y muestra el botón **Guardar corrección**. También puedes ejecutar `supabase/fix_inflated_prices.sql`.

A partir de esta versión, `price_per_kg` es el dato principal y el costo por gramo se genera automáticamente en Supabase, evitando que ambas unidades vuelvan a desincronizarse.

## Pedidos, vendedores, stock de barritas y delivery

Para activar este módulo en una base existente, ejecuta después de los scripts anteriores:

`supabase/sales_delivery_calendar.sql`

El módulo agrega:

- stock de barritas terminadas por receta;
- stock independiente para cada vendedor;
- reparto automático 50/50 cuando existen exactamente dos vendedores activos;
- descuento atómico de barritas al agendar un pedido;
- reposición automática del stock al cancelar;
- comunas asociadas a lunes, martes, miércoles, jueves o viernes;
- delivery sugerido según distancia, precio de bencina, rendimiento de la moto, desgaste, cargo base y margen;
- botones para abrir la ruta en Google Maps y agregar cada pedido a Google Calendar;
- estados Pendiente, En producción, Listo, Entregado y Cancelado.

La distancia configurada corresponde a **solo ida**. La opción “Considerar ida y vuelta” se activa desde Pedidos y entregas. La moto queda configurada inicialmente en 30 km/L, pero todos los valores son editables.

### Google Calendar

El botón **Google Calendar** abre un evento ya completado con cliente, fecha, dirección, producto, vendedor y delivery. Esto funciona sin guardar credenciales de Google dentro del proyecto. Una sincronización automática bidireccional requeriría configurar OAuth de Google en un backend seguro.

### Distancia automática con Google Maps

La aplicación funciona sin Google Maps API usando la distancia base de cada comuna o una distancia ingresada manualmente. Para activar el botón **Calcular con Google Maps**:

1. Activa **Routes API** en tu proyecto de Google Cloud y configura facturación.
2. Guarda la clave como secreto de Supabase:
   `supabase secrets set GOOGLE_MAPS_API_KEY=TU_CLAVE`
3. Publica la función incluida:
   `supabase functions deploy calculate-route`
4. En **Configuración del delivery**, guarda la dirección desde donde sale la moto.

La clave queda en Supabase y no se expone en el navegador. La función usa la ruta para vehículo de dos ruedas y devuelve kilómetros solo de ida.
