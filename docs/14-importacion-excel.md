# Importación de trabajadores por empresa desde Galepso

Estado: **implementado (2026-09-29); formato real = Roster de Personal en PDF
(2026-09-30, §2.1).** Reemplaza a la primera versión de este
documento (plantilla propia de 3 hojas Empresas / Empleados / Contratos, 2026-09-28)
y a [`12-importacion-adempiere.md`](./12-importacion-adempiere.md). Decidido con
Ezequiel: **se importa por empresa, solo trabajadores, y a cada uno se le crea su
contrato automáticamente**, a partir del export que ALCO ya saca de Galepso.

---

## 1. Qué es

**Empresa → Empleados → Importar** (ícono de subir) abre
`/admin/empresas/[id]/importar`. Se sube el **listado de trabajadores activos** de
esa empresa tal como sale de Galepso. Para cada fila:

- si la persona no existe (por cédula), se crea;
- se le crea un **contrato en esa empresa** con la **fecha de ingreso** como fecha de
  inicio;
- su **cargo** pasa a ser el **puesto** del contrato.

Antes de aplicar hay una **vista previa editable** (§4). Al confirmar se aplica todo
en una transacción y los equipos de la empresa se sincronizan solos.

---

## 2. El archivo

### 2.1 Roster de Personal en PDF (el formato real, 2026-09-30)

Lo que ALCO saca de verdad de Galepso es el reporte **"ROSTER DE PERSONAL"**
(`repRoster_personal.frx`, filtro STATUS: ACTIVO) **impreso a PDF** con "Microsoft
Print to PDF". Relevado de `ACTIVOS CASTILLO SISTEMA.pdf` (13 trabajadores). El
`.xlsx` limpio de §2.2 lo había armado el cliente a mano: Galepso no lo produce.

- Filtros arriba (empleado/departamento/sucursal inicial y final, `STATUS : ACTIVO`).
- Columnas: `CÓDIGO`, `CÉDULA`, `NOMBRE`, `CARGO`, `STATUS`, `TIPO DE PERSONAL`,
  `FECHA NACIMIENTO`, `FECHA INGRESO`, `FECHA EGRESO`, `SUELDO`. Los de fecha van en
  dos renglones ("FECHA" / "INGRESO").
- Trabajadores agrupados por departamento (`DEPARTAMENTO : 1 - OPERATIVO`), con
  `TOTAL TRABAJADORES` por departamento y `TOTALES GENERALES : 13.00` al final.
- Rarezas del reporte real: a veces la cédula sale **sin la V** (`-18871497`); la
  **fecha de nacimiento falta** en varias filas (7 de 13), aunque la persona la
  tenga en Galepso; los cargos largos vienen **cortados** ("DESPACHADORA - ATENCIÓN
  AL"), que se resuelven con los alias de §3.

**Cómo se lee** (`lib/import/readPdf.ts`, con `pdfjs-dist`): el texto de un PDF
viene en orden de dibujo, no de lectura, así que cada valor se ubica **por su
posición**. Se agrupan los textos en renglones por su altura; un renglón con algo
con forma de cédula es un trabajador. Cada texto va a la columna cuyo encabezado
le queda más cerca en x, comparando solo entre columnas del mismo tipo: una fecha
solo puede ser nacimiento, ingreso o egreso; un texto, nombre, cargo, status o tipo.
Los encabezados se buscan solo en la franja de `CÉDULA` (el `STATUS : ACTIVO` de los
filtros no es la columna). Varias páginas: cada una tiene sus encabezados.

- Filas con STATUS distinto de ACTIVO: no se importan (aviso).
- **Control de total:** la cantidad leída tiene que coincidir con `TOTALES
  GENERALES`. Si no, se rechaza todo: nunca queda alguien afuera sin avisar.
- PDF sin texto (escaneo, foto) → rechazado con el motivo.

**El `.xls` que exporta Galepso no sirve** y no se acepta: pierde la cédula y el
nombre del primer trabajador de cada departamento (3 de 13 en el relevado).

### 2.2 Planilla .xlsx

Relevado de `ACTIVOS CASTILLO.xlsx` (2026-09-29, 13 trabajadores):

- Una hoja (`RESUMEN DE PAGO`), título combinado arriba ("LISTADO DE TRABAJADORES
  ACTIVOS"), **encabezados en la fila 8**, datos desde la 9. No trae la empresa (ni
  RIF ni nombre): por eso se importa desde la página de la empresa.
- Columnas: `N°` (se ignora), `NOMBRES Y APELLIDOS`, `CEDULA`, `CARGO`,
  `FECHA DE INGRESO`, y opcional `FECHA DE NACIMIENTO`.

**Cómo se lee** (`lib/import/read.ts`): la fila de encabezados se busca sola (la
primera con `CEDULA` en las primeras 30 filas de cualquier hoja); las columnas se
reconocen por nombre sin importar mayúsculas ni acentos; las filas vacías y un pie
de "TOTAL" se ignoran. Obligatorias: NOMBRES Y APELLIDOS, CEDULA, FECHA DE INGRESO.
Se asume que la columna del cargo se llama siempre `CARGO`.

Cuál de los dos es se decide por el contenido (un PDF empieza con `%PDF-`), no por
la extensión.

**Privacidad:** el export tiene cédulas y nombres reales. Nunca en la raíz del repo:
en `imports/` (ignorada por git). La plataforma guarda el archivo en `import_run`
entre la vista previa y la confirmación y lo borra a los 30 días.

---

## 3. Reglas por columna

### Cédula
`V-24.506.123`, `V- 10.137.123`, `V-25,422,123`, `V- 12345678`, `12345678` →
`V-24506123`. Se quitan puntos, comas, espacios y guiones; **sin letra se asume V**
(una E de extranjero tiene que venir escrita). Se valida con las mismas reglas que el
panel (`lib/documento.ts`). Repetida en el archivo → rechazada.

### Nombres y apellidos (`lib/import/names.ts`)
Galepso los trae en **una sola celda, nombres primero**. Para separarlos:

1. Las partículas (`DE`, `DEL`, `DE LA`, `DE LOS`…) se pegan a la palabra siguiente:
   `DE GOUVEIA` es un apellido, `MARIA DE LOS ANGELES` es un nombre compuesto.
2. Por cantidad de palabras: 2 → 1+1; 4 → 2+2; 3 → si la segunda es un nombre de
   pila conocido (JOSE, MARIA, COROMOTO, RAMONA…, lista en el código) 2+1, si no 1+2
   **marcado para revisar**; 5 o más → 2 + resto, **marcado para revisar**.
3. En la vista previa se puede mover el corte de cualquier persona nueva.

En el archivo real: 13 de 13 separados con certeza, ninguno para revisar.

**Personas que ya existen:** no se les cambia el nombre. El del sistema puede venir
de escanear la cédula (que trae nombres y apellidos por separado) y el del archivo es
una celda partida por heurística. Si difiere, la vista previa lo muestra.

### Fecha de ingreso
Es el **inicio del contrato** (`employment.start_date`): define desde cuándo cuentan
sus marcaciones para la asistencia y el export a nómina. Fecha de Excel, número de
serie o texto `DD/MM/AAAA`. Se guarda como fecha pura (nunca con hora local). Sin
fecha → rechazada.

### Fecha de nacimiento
Opcional (`employee.birth_date`). Persona nueva: se crea con ella. Persona que ya
existe: si no la tiene, **se completa**; si tiene otra, **se corrige** y la vista
previa lo muestra ("antes DD/MM/AAAA"), con auditoría `import.employee.update`. Si
el archivo no la trae, **no se toca** la que ya tenga. Una fecha inválida rechaza la
fila (D1).

### Cargo → Puesto
En este orden:

1. un puesto con ese nombre (sin importar mayúsculas, acentos ni puntuación);
2. un **alias** guardado en una importación anterior (`position_alias`);
3. lo que se elija en la vista previa, para cada cargo:
   - **Crear puesto nuevo**, con el nombre **editable** (por defecto "Despachadora");
   - **Igual que otro cargo de este archivo**: unificar "HORMERO" (error de tipeo)
     con "HORNERO", o "DESPACHADORA" con "DESPACHADOR", aunque ninguno exista
     todavía: terminan en el mismo puesto y no se crea un duplicado;
   - **un puesto que ya existe**.

Todo cargo que termina en un puesto con otro nombre se **recuerda** como alias
(`position_alias`) para los próximos archivos de cualquier empresa: se decide una
sola vez. Dos cargos renombrados igual crean un solo puesto, y un nombre corregido
que ya existe usa ese puesto. Si la empresa tiene modelo de negocio, el puesto se
asocia a él.

### Contrato (en esta empresa)

| Situación | Resultado |
| --- | --- |
| No tiene contrato en esta empresa | Contrato nuevo |
| Tiene uno con la **misma fecha de inicio** | Es el mismo: si el cargo cambió, se actualiza el puesto; si no, sin cambios |
| Tiene uno **vigente** con otra fecha | **Rechazada**: corregir la fecha en el Excel si es la misma relación laboral, o dar de baja el anterior en el panel si es un reingreso |
| Tiene uno **cerrado** con otra fecha | Contrato nuevo (reingreso; el historial queda) |

Contratos en **otras** empresas no se tocan.

---

## 4. Vista previa

- Resumen: personas nuevas / existentes; contratos nuevos / con cambio de puesto /
  sin cambios; cuántas personas llegan a cuántos equipos.
- **Problemas** (fila, columna, motivo). Con uno solo, **no se aplica nada** (D1):
  se corrige el Excel y se vuelve a subir.
- **Cargos → Puestos**, con el selector crear / usar uno existente.
- **Personas**, las dudosas primero y resaltadas, con el selector del corte
  `Nombres | Apellidos` para las nuevas de 3 o más palabras.
- **Ausentes:** quienes tienen contrato vigente en la empresa y no están en el
  archivo. **No se les da de baja** (D3); es para revisar en el panel.

**Sin confirmar:** si se sube un archivo y no se confirma, queda en el historial
de la página como "Sin confirmar" con un enlace **Continuar**, que reabre la vista
previa del mismo archivo (guardado 30 días) recalculada contra la base de hoy.

"Confirmar" recalcula el plan: si algo cambió en la base desde la vista previa
(otra persona cargó a alguien, se creó un puesto…), muestra la vista nueva en vez de
aplicar. Un doble clic o dos pestañas no aplican dos veces (la importación se toma
de forma atómica).

---

## 5. Decisiones

| # | Tema | Decidido |
| --- | --- | --- |
| D1 | Filas con error | Todo o nada |
| D2 | Datos que ya existen | No se borra nada; a una persona existente no se le cambia el nombre (la fecha de nacimiento sí se completa o corrige, §3) |
| D7 | Formato (2026-09-30) | El Roster de Personal impreso a PDF. El `.xls` de Galepso está corrupto y no se acepta |
| D3 | Bajas | Nunca desde la importación; los ausentes solo se listan |
| D4 | Cargos que no existen | Se crean, o se asignan a un puesto existente (y se recuerda) |
| D5 | Quién importa | Los 4 usuarios de ALCO |
| D6 | Alcance | Por empresa, solo trabajadores + contrato. La plantilla de 3 hojas se descartó |

---

## 6. Código

| Pieza | Archivo |
| --- | --- |
| Lectura del Roster en PDF (por posición, control de total) | `lib/import/readPdf.ts` |
| Lectura del .xlsx (encabezados sin posición fija) y elección del formato | `lib/import/read.ts` |
| Cédula, fechas, textos | `lib/import/normalize.ts` |
| Separar nombres y apellidos | `lib/import/names.ts` |
| Estado actual en lote + plan puro | `lib/import/plan.ts` |
| Aplicar en una transacción (timeout 180 s, `createManyAndReturn`, auditoría `import.*`) | `lib/import/apply.ts` |
| Vista previa / confirmar, huella del plan, equipos, limpieza a 30 días | `lib/import/service.ts` |
| Página, acciones y panel | `app/admin/empresas/[id]/importar/`, `components/admin/CompanyImportPanel.tsx`, `ImportEmployeesButton.tsx` |
| Tablas | `import_run` (+ `company_id`), `position_alias` — migraciones `20260928140000_import_run`, `20260929100000_company_import` |
| Tests | `__tests__/import.test.ts` (archivos con la forma del export real, generados en el test; el PDF del Roster se dibuja con las mismas posiciones que el real) |

**Medido (test, base local):** 5 000 trabajadores → vista previa ≈0,2 s, aplicar
≈1,5 s.
