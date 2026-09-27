# Ajustes de UI/UX, export a nómina (Galepso) y buscador global

Estado: **plan aprobado (2026-09-27), sin implementar.** Va después de `docs/10`
(PR 1–3, ya implementados) y **antes** de las pruebas con los 2 equipos (T6, T7,
T10–T12 de `10` §7.2).

Fuentes: `cambios.md` y `reportes.md` (raíz del repo), el archivo de ejemplo de
Adempiere (`PANADERIA EL CASTILLO  Relación de Asistencia 2023054246
20260922_162306.xlsx`) y la ronda de decisiones Jesús ↔ equipo del 2026-09-27
(§1). Donde choque con `07` §0 o `10` §6, gana este documento.

---

## 1. Decisiones cerradas

### Navegación y estándares

| # | Decisión |
| --- | --- |
| U1 | **Patrón de detalle estándar** para Empresas, Empleados y Equipos: encabezado (nombre + estado) con **íconos de acción con tooltip**, y debajo **pestañas por ruta** (subrutas, como hoy en Empresa). La **primera pestaña es "Información"** y es la que se abre por defecto. |
| U2 | **Íconos con tooltip son la norma** para las acciones de las barras (sincronizar, editar, renombrar, asignar…). Texto solo para la acción principal de un estado vacío. Los botones de sincronizar de Empresa → Empleados / Asistencia quedan estandarizados así. |
| U3 | **Filas clickeables**: si una fila tiene un destino principal, toda la fila es clickeable mediante un **link real estirado** (patrón *stretched link*: el `<a>` de la primera celda cubre la fila con `::after`), no con `onClick` en el `<tr>` — conserva clic medio, Ctrl/⌘+clic y teclado. Los íconos de acción de la fila quedan **por encima** del link (z-index) y siguen funcionando. Se quitan los botones "Detalle →". Aplica igual en mobile (la tarjeta entera, no solo el título). |
| U4 | **"Equipos"** en toda la UI (menú, títulos, textos). Las URLs `/admin/dispositivos/**` **no cambian** (no se rompen links). |
| U5 | **"Contratos de trabajo"** en lugar de "Empleos" en todo lo visible (la tabla sigue siendo `employment`, `10` R4). |
| U6 | **Selector de empresa con búsqueda** (combobox) como componente global del sistema de diseño; se usa en la asignación de sede de un equipo y en los filtros por empresa. |
| U7 | Se corrige el warning de React "two children with the same key" (el selector de sedes usaba el nombre de la empresa como key; hay dos empresas de prueba con el mismo nombre). Key = id. |

### Equipos

| # | Decisión |
| --- | --- |
| E1 | Lista de Equipos con columnas **Empresa** y **Sede**, **barra de búsqueda** (nombre, serie, empresa, sede) y **filtros** (empresa con el combobox de U6; estado: en línea / desconectado / pendiente de asignar). "Sincronizar todos" pasa a ícono. |
| E2 | El widget "Equipos" del Inicio es clickeable → lista de Equipos filtrada por **en línea**. |
| E3 | **Detalle del equipo** con el patrón U1. Íconos arriba: **Renombrar**, **Sincronizar hora**, **Actualizar**, **Asignar sede**. |
| E4 | **Un solo "Actualizar"** (reemplaza "Actualizar estado" + "Sincronizar ahora"): con sede corre la sincronización completa (que ya incluye leer el estado); sin sede (congelado) solo lee el estado del equipo. El texto dice cuál de los dos casos aplica. |
| E5 | **Asignar sede**: primero empresa (combobox U6, con búsqueda), luego sede (select). Mantiene el aviso de impacto. |
| E6 | Pestañas del equipo: **Información** (asignación, contadores, última corrida, **bajas frenadas** con aprobar/rechazar), **Usuarios** (las acciones de la vieja "Usuarios de equipo" — renombrar, privilegio, ver biométricos, eliminar — **más** el estado de la vieja Enrolamiento: empleado vinculado, huellas físicas/copiadas, qué falta / sobra / admins que no se tocan / IDs sin empleado), **Marcaciones** (lo marcado en ese equipo, incluidos IDs sin empleado — la vista "dónde se marcó"). |
| E7 | Texto de "Asignación" sin sede: el viejo ("Sin empresa, al enrolar… no se puede acotar", del enrolamiento manual) pasa a decir que el equipo está **congelado**: no se agrega ni se quita a nadie hasta que tenga sede. |
| E8 | Se **eliminan** del menú y como rutas: **Usuarios de equipo**, **Enrolamiento** y la **Asistencia global** (`/admin/asistencia`). Todo vive en el detalle del equipo o de la empresa. |

### Empresas

| # | Decisión |
| --- | --- |
| C1 | Lista con **grupos colapsables** (como Adempiere): el grupo es una fila más con indicador de expandir, **colapsado por defecto**; se quita el encabezado "Sin grupo" (las empresas sin grupo son filas normales). Clic en la fila del grupo = expandir/colapsar (el grupo no tiene página); editar y activar/desactivar siguen como íconos. Mobile más compacto. |
| C2 | **Logo chico** en cada fila de empresa, cargado por `<img src="/admin/empresas/[id]/logo">` con carga diferida — **nunca** el binario en la consulta de la lista (hasta 512 KB c/u). |
| C3 | Detalle con pestañas **Información** (RIF, grupo, modelo de negocio, dirección, rep. legal, umbrales; **logo grande arriba a la derecha**), **Sedes** (pestaña propia), **Empleados**, **Asistencia**. |
| C4 | **Empresa → Asistencia muestra lo mismo que se exporta** (R3/b): las marcaciones de **sus empleados con contrato**, en cualquier equipo de su alcance, con columna **Sede** (dónde marcó). Solo cuentan las marcaciones **dentro del período del contrato**. El filtro de sede lista las sedes donde pueden marcar sus empleados (las propias y, si el grupo comparte empleados, las del grupo). La vista "dónde se marcó" (con IDs sin empleado) queda en Equipo → Marcaciones (E6). *Reemplaza la regla de pantalla de `10` R12 / F3.* |

### Empleados y Categorías

| # | Decisión |
| --- | --- |
| P1 | Detalle del empleado con pestañas **Información** (documento, RIF, fecha de nacimiento, foto de cédula), **Contratos de trabajo**, **Equipos y huellas** (estado por equipo + huellas, lo que hoy son dos secciones). |
| P2 | **Se elimina "Trasladar"** y se agrega **"Editar"** del contrato: el mismo formulario **precargado**, sobre el **mismo** contrato (misma fila). **La empresa no es editable**: para pasar a alguien a otra empresa se da de baja el contrato y se crea uno nuevo (cada paso con su aviso de impacto) — conserva el historial (`09` D5). Editables: cargo, horario, departamento, tipo y ref. de nómina, fecha de inicio. |
| P3 | Categorías con pestañas **Modelos de negocio**, **Puestos**, **Departamentos** (en ese orden: departamentos está previsto pero sin uso en Fase 1, `09` DC5). |

### Export a nómina (Galepso)

| # | Decisión |
| --- | --- |
| R1 | **Formato**: réplica del `.xlsx` de Adempiere que hoy cargan en Galepso (§3). |
| R2 | **Alcance: por empresa**, con filtro de **fecha (obligatorio)** y **sede (opcional)**. **Sin export por grupo** (el encabezado lleva el nombre de UNA empresa; Galepso liquida por empresa). Reemplaza el modelo de Adempiere, que exporta por equipo y obliga a unir archivos a mano. |
| R3 | **Qué entra (b, por contrato)**: las marcaciones de los empleados con **contrato de trabajo** en esa empresa, en **cualquier** equipo de su alcance (incluidas sedes de otras empresas del grupo si comparte empleados), **dentro del período del contrato** y del rango elegido. IDs que no son la cédula de un empleado **no** entran (Adempiere los incluía; Galepso los ignora igual). Coherente con cómo Galepso cruza: busca a la persona por cédula en la empresa que liquida y descarta el resto. |
| R4 | **Nombre** = nombre completo del empleado en el sistema (no el del equipo, truncado a 8). |
| R5 | **Excel ahora**; el CSV (tabla limpia, sin encabezado decorativo) queda para después. |
| R6 | **Nombre del archivo**: `<EMPRESA> Relación de Asistencia <RIF> <YYYYMMDD>_<HHMMSS>.xlsx` (Adempiere ponía el número de serie del equipo; nosotros exportamos por empresa). |
| R7 | Cada export se registra en **`export_run`** (quién, cuándo, empresa, rango, filas) — ya existe en el schema. Sin export por grupo, O10 (`export_run.scope_group_id`) deja de ser necesario. |
| R8 | El botón de exportar vive en **Empresa → Asistencia** (ícono con tooltip), y exporta exactamente lo filtrado en pantalla (C4). |

### Buscador global

| # | Decisión |
| --- | --- |
| S1 | Estilo Zoho: **barra arriba**, junto a la barra lateral, con atajo **⌘K / Ctrl K**, que abre una **paleta centrada**. |
| S2 | **Solo objetos** (por ahora, sin acciones): empresas (nombre, RIF), grupos, sedes, empleados (nombre, cédula), equipos (nombre, serie), horarios, puestos. |
| S3 | Resultados **agrupados por tipo**, con ícono, coincidencia resaltada y una línea de contexto (ej. `Juan Pérez · V-12345678 · Farmacia X`). Navegación completa por teclado (↑↓, Enter, Esc). Sin texto: **vistos recientemente** (guardados en el navegador). |
| S4 | Backend: `GET /api/search?q=` con búsqueda insensible a mayúsculas y acentos, pocos resultados por tipo. Sin índices especiales a este volumen. |

---

## 2. Plan de implementación

Tres PRs. Los cambios se dejan en stage, sin commit (como siempre).

### PR 4 — Base común (mecánico, toca muchas pantallas)

1. **`<Tabs>` estándar** por ruta (generaliza `CompanyTabs`) + **`<DetailHeader>`** (nombre, estado, íconos de acción). U1.
2. **Filas clickeables** en `components/ui/Table.tsx` y `MobileRow` (stretched link, acciones por encima). U3.
3. **Íconos con tooltip**: pasar a `IconBtn` los botones de acción de las barras (sincronizar, OpButton / MultiOpButton con variante ícono). U2.
4. **`<CompanyCombobox>`** (búsqueda por nombre y RIF, teclado, accesible). U6.
5. Renombres visibles: **Equipos** (U4), **Contratos de trabajo** (U5). Fix de keys (U7).
6. Componente **`<Tooltip>`** si el `title` nativo no alcanza (el `title` de `IconBtn` hoy es nativo — suficiente para desktop; en mobile no hay hover, por eso cada ícono lleva también `aria-label`).

### PR 5 — Vistas

1. **Equipos**: lista (E1, E2), detalle con el patrón nuevo (E3–E7), rutas `/admin/dispositivos/[devId]` (Información), `/usuarios`, `/marcaciones`. Se eliminan `/admin/usuarios`, `/admin/enrolamiento`, `/admin/asistencia` y sus entradas de menú (E8).
2. **Empresas**: grupos colapsables + logos (C1, C2); detalle con pestañas Información / Sedes / Empleados / Asistencia (C3); Asistencia por contrato (C4).
3. **Empleados**: pestañas (P1); "Editar contrato" sin empresa editable, fuera "Trasladar" (P2).
4. **Categorías**: pestañas (P3).

### PR 6 — Export Galepso + buscador

1. **Export `.xlsx`** (R1–R8): generador con una librería de escritura de xlsx (`exceljs`), ruta de descarga autenticada (`GET /admin/empresas/[id]/asistencia/export?from&to&sede`), registro en `export_run`, ícono en Empresa → Asistencia. Tests: estructura del archivo (celdas combinadas, fila de títulos en la 5, textos, pie), alcance por contrato (dentro/fuera del período, otra empresa del grupo, ID sin empleado), orden por hora.
2. **Buscador global** (S1–S4): `GET /api/search`, `<CommandPalette>` en `AdminShell`, atajo ⌘K, recientes en `localStorage` (con try/catch — puede no estar disponible).

**Orden sugerido:** PR 6 puede ir primero si se quiere que ALCO empiece a exportar ya
(no depende de 4/5); PR 4 antes que PR 5.

---

## 3. Formato del export (referencia)

Relevado del `.xlsx` de ejemplo (2026-09-27):

| Elemento | Detalle |
| --- | --- |
| Hoja | una sola |
| `A1:C4` (combinadas) | una celda de texto multilínea: `Relación de Asistencia` / `<EMPRESA>` / `Rango de Fecha: M/D/YYYY ~ M/D/YYYY` / `Fecha: M/D/YYYY HH:MM:SS` — Arial 12 negrita, ajuste de texto |
| Fila 5 | títulos `Cédula` · `Nombre` · `Hora de Asistencia` — Arial negrita |
| Desde fila 6 | una fila por **marcación cruda** (sin emparejar entrada/salida), orden cronológico. **Todas las celdas son texto**, incluidas la cédula y la hora. Hora: `M/D/YYYY h:mm AM/PM` (formato EE. UU., sin segundos). Fuente por defecto Arial 10 |
| Última fila (combinada `A:C`) | `Impulsado por erpya.com / grupoalcoac (M/D/YYYY HH:MM:SS)` — Arial 8 cursiva. Se reemplaza la marca por la del sistema nuevo (a confirmar el texto; el contenido del pie no afecta el cruce en Galepso) |

**Observación:** el `.xlsx` de ejemplo tiene rastros de haber sido regenerado por Google
Sheets (hoja `Sheet1`, sin `docProps/`, namespaces `mx`/`mv`). El contenido y la
estructura se replican tal cual; si Ezequiel pasa el archivo exactamente como lo baja
de Adempiere, se confirma el nombre de la hoja (único detalle que podría variar).
El ejemplo trae marcaciones fuera del rango declarado (hasta el 9/22 con rango al 9/15):
nosotros respetamos el rango elegido.

---

## 4. Pendientes

| # | Tema |
| --- | --- |
| O-UI1 | Texto del pie del export (¿"Panel ALCO"?, `09` §7.1 ítem 2) |
| O-UI2 | Confirmar con el archivo crudo de Adempiere el nombre de la hoja (§3) |
| O-UI3 | CSV limpio (R5), cuando lo pidan |
| O-UI4 | Acciones en el buscador (S2), cuando lo pidan |
| O-UI5 | Aviso de impacto al desactivar empresa/grupo (hereda `10` O12) |

---

## 5. Documentación a actualizar (en el mismo cambio de cada PR)

- `07-admin-ux-spec.md` §0 (vistas y flujos: Equipos con pestañas, sin Enrolamiento ni
  Usuarios de equipo ni Asistencia global, "Editar contrato", export, buscador).
- `10-reestructura-dominio-sync.md` §6 y R12 (Empresa → Asistencia pasa a "por contrato";
  "dónde se marcó" en Equipo → Marcaciones) y O10 (cerrado: sin export por grupo).
- `08-data-model.md` solo si cambia el schema (no está previsto: `export_run` ya existe).
- `01-requirements.md` / Hito 5: el export a nómina ya no está "diferido" en formato.
