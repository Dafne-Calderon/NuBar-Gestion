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

## Pedidos, vendedores, stock de barritas y delivery
El módulo agrega:

- stock de barritas terminadas por receta;
- stock independiente para cada vendedor;
- descuento atómico de barritas al agendar un pedido;
- reposición automática del stock al cancelar;
- comunas asociadas a lunes, martes, miércoles, jueves o viernes;
- delivery sugerido según distancia, precio de bencina, rendimiento de la moto, desgaste, cargo base y margen;
- botones para abrir la ruta en Google Maps y agregar cada pedido a Google Calendar;
- estados Pendiente, En producción, Listo, Entregado y Cancelado.

La distancia configurada corresponde a **solo ida**. La opción “Considerar ida y vuelta” se activa desde Pedidos y entregas. La moto queda configurada inicialmente en 30 km/L, pero todos los valores son editables.

### Google Calendar

El botón **Google Calendar** abre un evento ya completado con cliente, fecha, dirección, producto, vendedor y delivery. Esto funciona sin guardar credenciales de Google dentro del proyecto. Una sincronización automática bidireccional requeriría configurar OAuth de Google en un backend seguro.


