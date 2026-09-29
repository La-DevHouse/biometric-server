# Importación de empresas, empleados y contratos desde Adempiere

Estado: **reemplazado (2026-09-28) por [`14-importacion-excel.md`](./14-importacion-excel.md)**
— importación por empresa desde el export de Galepso (trae fecha de ingreso; los
apellidos se separan del nombre completo con vista previa editable). Se conserva
como referencia del formato del export de Adempiere (§1).

Cómo cargar a la plataforma lo que hoy vive en Adempiere, a partir del reporte
que ALCO exporta ("reportFrame"). No es una función de la plataforma: es un
**script que corremos nosotros** a mano cada vez que llega un export, contra la
base de producción. Hace *upsert*: la misma planilla se puede correr dos veces
y el resultado es el mismo.

---

## 1. El archivo de entrada

Relevado de `reportFrame (2).xls` (2026-09-27, 61 filas, 1 empresa):

| Columna (fila 1) | Ejemplo (inventado) | Va a |
| --- | --- | --- |
| `Organización.` (con punto) | `UNIDAD EDUCATIVA EJEMPLO C.A.` | `client_company.name` |
| `RIF` | `J301234567` | `client_company.tax_id` → `J-301234567` |
| `Cédula` | `V12345678` | `employee.national_id` → `V-12345678` |
| `Socio del Negocio` | `Maria  Jose` | `employee.first_name` (ver §6 D1) |
| `Departamento` | `Nivel inicial-Primaria` | `department.name` → `employment.department_id` |
| `Puesto` | `Docente` | `position.name` → `employment.position_id` |

Una fila = **un contrato de trabajo** (persona × empresa), con su departamento y
puesto.

**Detalles del formato que el script tiene que tolerar:**

- La extensión dice `.xls` pero es **`.xlsx`** (OOXML, "PK" al inicio). Leer con
  `exceljs` (ya es dependencia) por contenido, no por extensión.
- Una hoja (`Sheet0`), títulos en la fila 1, datos desde la 2, sin celdas
  combinadas. Localizar columnas **por nombre** normalizado (minúsculas, sin
  acentos, sin puntuación: `organizacion`, `rif`, `cedula`, `socio del negocio`,
  `departamento`, `puesto`), no por posición — si Adempiere agrega o reordena
  columnas, no se rompe.
- Cédula y RIF vienen **sin guion**: `V` + 7 u 8 dígitos; `J` + 9 dígitos.
- Nombres con **espacios dobles** (`"Maria  Jose"`, 44 de 61) y mezcla de
  MAYÚSCULAS / Capitalizado.
- Catálogos con ruido: mayúsculas inconsistentes (`ACADEMICO`, `FARMACIA`),
  punto final (`Docente primaria.`), guiones pegados (`Docente-Educacion
  inicial.`), acentos a veces sí y a veces no.

**Privacidad:** el export tiene cédulas y nombres reales. **Nunca** se commitea:
va a una carpeta local ignorada por git (`imports/`, agregarla a `.gitignore`),
se procesa y se borra. Los reportes del script tampoco llevan cédulas completas
cuando se comparten (ver §4).

---

## 2. Qué hace el script, paso a paso

`scripts/import-adempiere.ts`, corre con `tsx` usando los helpers de la app
(como los tests: `lib/db`, `lib/documento`, `lib/sync/reconcile`), así valida
con las mismas reglas que el panel.

```
npx tsx --env-file=.env scripts/import-adempiere.ts imports/reportFrame.xlsx \
  --fecha-inicio 2026-10-01 [--aplicar] [--cerrar-ausentes 2026-09-30] [--actualizar-nombres]
```

Sin `--aplicar` es **simulación** (dry-run): hace todo dentro de una transacción
y la revierte al final, e imprime el reporte. Siempre se corre primero así.

### 2.1 Leer y normalizar (antes de tocar la base)

1. Leer filas, localizar columnas por nombre, descartar filas completamente vacías.
2. Normalizar documentos con `lib/documento.ts` (el mismo formato que guarda el
   panel, `PREFIJO-dígitos`):
   - Cédula: `V12345678` → `joinDoc("V", "12345678", "cedula")` → `V-12345678`.
     Prefijo permitido V/E. Error → la fila va al reporte como **rechazada**.
   - RIF: `J301234567` → `joinDoc("J", "301234567", "rif")` → `J-301234567`.
3. Nombres: `trim` + colapsar espacios + capitalizar (`MARIA  JOSE` → `Maria Jose`).
4. Catálogos: clave de comparación = minúsculas, sin acentos, sin puntuación
   final, espacios y guiones colapsados. Se **guarda** el primer texto visto,
   limpio (sin punto final, espacios simples).
5. Validar dentro del archivo: una cédula que aparece **dos veces en la misma
   empresa** con departamento/puesto distintos → conflicto, fila rechazada (en
   el archivo de ejemplo: 0 casos).

### 2.2 Aplicar (una transacción por archivo)

Todo o nada: si algo falla a mitad, no queda una importación a medias.

| Entidad | Busca por | Si no existe | Si existe |
| --- | --- | --- | --- |
| **Empresa** | `tax_id` normalizado (no es `@unique` en la BD: el script verifica que haya 0 o 1; si hay 2, aborta) | Crea con `name` del export + **sede "Principal"** (obligatoria, trigger diferido de `10` R2). Sin grupo ni modelo de negocio: se completan en el panel | No toca el nombre (puede haber sido corregido en el panel); si difiere, lo avisa en el reporte |
| **Departamento** | nombre normalizado (catálogo global) | Crea | Nada |
| **Puesto** | nombre normalizado (catálogo global) | Crea; si la empresa tiene modelo de negocio, lo asocia (`position_business_model`), igual que "crear puesto nuevo" del formulario de contrato | Si la empresa tiene modelo de negocio y el puesto no lo tiene, agrega la asociación |
| **Empleado** | `national_id` (`@unique`) | Crea con los nombres (ver §6 D1) | No toca nombres salvo `--actualizar-nombres` (el panel puede tener datos mejores: OCR de cédula, correcciones) |
| **Contrato** | contrato **vigente** (`activeEmploymentWhere`) de esa persona con esa empresa | Crea con `start_date = --fecha-inicio` (ver §6 D2), depto y puesto | Actualiza depto/puesto si cambiaron (nunca la empresa ni la fecha de inicio) |

- Una persona con contrato vigente en **otra** empresa no se toca: el modelo
  permite varios contratos (`09` §3.12).
- Una persona con un contrato **cerrado** en esta empresa que vuelve a aparecer
  → contrato **nuevo** (reingreso), se conserva el historial (`09` D5).
- Cada alta/cambio escribe `audit_log` con `action = "import.adempiere"`,
  `actor_app_user_id = null` y el nombre del archivo en `after`.

### 2.3 Los que ya no están (`--cerrar-ausentes`)

Una persona con contrato vigente en una empresa del archivo que **no aparece**
en el export: por defecto **solo se reporta**. Con `--cerrar-ausentes
AAAA-MM-DD` se le da de baja con esa fecha (mismo efecto que "Dar de baja" en el
panel).

Por qué no automático: el export puede venir filtrado o incompleto, y una baja
**saca a la persona de los equipos** (el reconciliador la borra). El freno de
bajas masivas (`10` §4.4) protege, pero no conviene apoyarse en él.

### 2.4 Al terminar: sincronizar equipos

Crear contratos cambia el alcance: esas personas tienen que aparecer en los
equipos de las sedes de su empresa. El script, **después** del commit, llama una
sola vez `triggerReconcile(devicesAffectedByCompany(id))` por empresa tocada —
no una corrida por fila. Si la empresa todavía no tiene equipos asignados, no
pasa nada (y cuando se le asigne uno, el reconciliador los agrega).

---

## 3. Qué NO hace

- No crea grupos de empresas ni asigna modelo de negocio, logo, representante
  legal, umbrales ni sedes adicionales: eso se completa en el panel.
- No asigna horario (`schedule_group`): no viene en el export.
- No toca equipos ni huellas: las huellas se capturan en los equipos y las
  propaga el reconciliador (`10`).
- No borra nada: ni empresas, ni empleados, ni catálogos.

---

## 4. Reporte de salida

Al terminar (también en simulación) imprime y guarda en
`imports/<archivo>.reporte.txt`:

```
Archivo: reportFrame.xlsx · 61 filas · modo: SIMULACIÓN
Empresas:       1 existente (UNIDAD EDUCATIVA EJEMPLO C.A., J-301234567)
Departamentos:  3 nuevos, 5 existentes
Puestos:        7 nuevos, 12 existentes
Empleados:      58 nuevos, 3 existentes (1 con nombre distinto — no se cambió)
Contratos:      58 nuevos, 2 actualizados (depto/puesto), 1 sin cambios
Ausentes:       4 con contrato vigente que no están en el archivo (no se cerraron)
Rechazadas:     0
Equipos a sincronizar: 2
```

Con el detalle por fila de rechazadas / ausentes / cambios de nombre, mostrando
la cédula **parcial** (`V-1234****`) si el reporte se va a compartir.

---

## 5. Procedimiento para cada export

1. Recibir el archivo, guardarlo en `imports/` (ignorada por git).
2. Correr en **simulación** contra producción (lee de verdad, revierte).
3. Revisar el reporte: rechazadas, ausentes, nombres distintos, puestos o
   departamentos nuevos que en realidad son un duplicado mal escrito de uno
   existente (si pasa, corregir el catálogo en el panel y volver a simular).
4. Correr con `--aplicar`.
5. Revisar en el panel: Empresa → Empleados (todos "en N de M" / "Falta en…"),
   y completar lo que el export no trae (grupo, modelo de negocio, horario).
6. Borrar el archivo y el reporte de `imports/`.

---

## 6. Decisiones abiertas

| # | Tema | Recomendación |
| --- | --- | --- |
| **D1 — bloquea** | **El export no trae apellidos.** "Socio del Negocio" tiene solo los nombres (58 de 61 filas con 2 palabras, ej. `Maria  Jose`; el espacio doble sugiere un campo vacío en medio). `employee.last_name` es obligatorio y los listados, el buscador y el export a Galepso (R4: nombre completo) dependen de él. | **Pedir que agreguen al reporte de Adempiere la columna de apellidos** (Name2 / apellidos del socio de negocio) o el nombre completo. Alternativa mala: importar con `last_name` vacío y completarlo después a mano / con OCR de cédula. |
| **D2 — bloquea** | **No trae fecha de inicio del contrato** (ni estado). `employment.start_date` es obligatorio, y la asistencia por contrato (`11` C4) y el export a nómina solo cuentan marcaciones **dentro** del período del contrato: una fecha de inicio posterior a la real deja marcaciones afuera. | **Pedir la columna "Fecha de inicio" del contrato** (y, si existe, "Empleado Nómina" → `payroll_ref` y tipo de nómina). Mientras tanto, `--fecha-inicio` obligatorio y explícito (no "hoy" por defecto): usar la fecha desde la que se va a liquidar con la plataforma. |
| D3 | Catálogos globales vs. por empresa. `department` y `position` hoy son **globales**; el export trae valores propios de cada empresa (hay un departamento `FARMACIA` en un colegio). Importando varias empresas, el catálogo se llena de variantes. | Aceptarlo en Fase 1 (departamentos no se usan todavía, `09` DC5) y revisar el catálogo en el paso 3 de §5. Si crece mal, discutir catálogo por empresa / modelo de negocio. |

---

## 7. Pruebas del script (cuando se implemente)

Contra la base de tests (`biometric_test`), con un `.xlsx` generado en el test
(nunca el export real):

- Idempotencia: correr dos veces → la segunda no crea nada.
- Normalización: `V12345678` / `v-12345678` → `V-12345678`; `Docente primaria.`
  y `docente primaria` → el mismo puesto.
- Empresa sin sede se crea con "Principal"; empresa con RIF duplicado → aborta.
- Contrato vigente → actualiza depto/puesto; cerrado → crea uno nuevo.
- Ausentes: sin flag solo reporta; con flag cierra con la fecha dada.
- Simulación no deja rastro (ni filas ni `audit_log`).
- Fila con cédula inválida → rechazada, el resto se importa.
