<!--
PLANTILLA. Copiá este archivo como views/<nombre-ventana>.md (kebab-case, sin
acentos: "correccion-marcaje.md") y rellenalo. Borrá los comentarios <!-- --> si
querés. Dejá en blanco lo que no sepas — no inventes.
-->

# Ventana: <nombre exacto como aparece en Adempiere>

**Ruta en el menú:** <ej: RRHH → Asistencia → Empleados>
**Propósito (1–2 frases):** <qué resuelve esta pantalla para ALCO>
**Quién la usa:** <qué rol/persona de ALCO, si se sabe>
**Entidad principal:** <el "objeto" que edita: empleado, empresa, marcaje, horario…>

---

## Pestañas

<!--
Adempiere muestra la ventana como pestañas. Suele haber una pestaña "cabecera"
(el registro principal) y pestañas "hijas" (detalle, dependen del registro de
arriba). Una sección por pestaña. Si la ventana tiene una sola pestaña, dejá solo
la primera.
-->

### Pestaña 1: <nombre> — <cabecera | hija de "Pestaña X">

Tabla/entidad a la que parece ligada (si se sabe): <...>

| Campo (etiqueta visible) | Tipo | Obligatorio | Solo lectura | Si es desplegable: ¿de qué lista sale? |
| --- | --- | --- | --- | --- |
| _ej: Nombre_ | texto | sí | no | — |
| _ej: Empresa_ | desplegable | sí | no | lista de empresas cliente |
| _ej: Fecha de ingreso_ | fecha | sí | no | — |
| _ej: Código biométrico_ | número | no | no | — |
| _ej: Estado_ | desplegable | sí | no | Activo / Inactivo |
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |

<!-- Tipos posibles: texto, texto largo, número, decimal, fecha, fecha-hora,
sí/no (checkbox), desplegable, botón, adjunto/imagen. -->

### Pestaña 2: <nombre> — hija de "Pestaña 1"

| Campo | Tipo | Obligatorio | Solo lectura | Fuente del desplegable |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
|  |  |  |  |  |

---

## Acciones

### Barra de herramientas (iconos arriba)
<!-- Marcá cuáles están habilitados en esta ventana -->
- [ ] Nuevo
- [ ] Guardar
- [ ] Eliminar
- [ ] Copiar registro
- [ ] Refrescar
- [ ] Adjuntar archivo
- [ ] Otro: <...>

### Botones de proceso (dentro del formulario o en un menú "Procesos")
<!-- Estos son acciones custom: "Generar", "Importar marcajes", "Recalcular",
"Completar", "Exportar a nómina"… Uno por línea con lo que hace. -->

| Nombre del botón | Qué hace (según lo que veas / sepas) | ¿Pide parámetros? ¿Cuáles? |
| --- | --- | --- |
| _ej: Procesar asistencia_ | _recalcula tardanzas/ausencias del período_ | _fecha desde, fecha hasta_ |
|  |  |  |

---

## Filtros y búsqueda

<!-- Cómo se filtra/busca en la grilla de esta ventana: por empresa, por fecha,
por empleado, por estado… -->

- <...>
- <...>

---

## Relación con otras ventanas

<!-- ¿Desde acá se salta a otra ventana? ¿Un campo abre otra ficha? ¿Esta ventana
depende de que antes exista un registro en otra? -->

- <...>

---

## Capturas asociadas

<!-- Nombres de archivos en ../screenshots/ que corresponden a esta ventana -->

- `screenshots/<...>.png`

---

## Observaciones libres

<!-- Cualquier cosa rara, cálculo que hace el sistema, comportamiento no obvio,
validación que salta, etc. -->

- <...>
