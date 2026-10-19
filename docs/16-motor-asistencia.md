# 16 — Motor de asistencia (Hito 4)

**Estado (2026-10-19):** pasos 1 a 3 hechos — cálculo y guardado de los días
(`lib/attendance/`), cálculo nocturno y botón "Recalcular", y pantallas. Pendiente: correcciones
manuales auditadas (paso 4).

## Pantallas

- **Empresa → Asistencia → "Por día"** (`?vista=dias`, `app/admin/empresas/[id]/asistencia/DaysView.tsx`):
  fecha, persona, entrada, salida (con "+1" si es del día siguiente), horas, extra y estado con
  sus minutos. Filtros: desde, hasta y estado. Sin rango, los últimos días cerrados. Arriba, el
  resumen por estado y un aviso de cuántos contratos vigentes no tienen horario. "Marcaciones"
  sigue siendo la vista de siempre (la que se exporta).
- **Empleado → Asistencia** (`app/admin/empleados/[id]/asistencia/page.tsx`): los días de la
  persona en todas sus empresas, con totales de horas y extra del período.
- **Empresa → Empleados → "Asignar horario"** (`AssignScheduleDialog`, `assignScheduleAction`):
  elegir un horario (o quitarlo) para varias personas a la vez, **vigente desde** una fecha (por
  defecto hoy; no futura, hasta un año atrás), con atajos "Seleccionar todos" y "Solo los sin
  horario". Queda en la auditoría (`employment.assign_schedule`, con `starts_on`) y recalcula la
  asistencia desde esa fecha al guardar.

## Cuándo se calcula

- **Cada noche** (worker, cola `attendance-compute`, `SYNC_COMPUTE_CRON`, por defecto
  `30 4 * * *` en `SYNC_TZ`): todas las empresas activas, los últimos
  `ATTENDANCE_COMPUTE_DAYS` días cerrados (35 por defecto, hasta ayer). Corre a las 4:30 y no
  junto con el pull de las 2:00, para que las marcaciones de los equipos ya hayan llegado. Una
  empresa que falla no frena a las demás.
- **A pedido:** Empresa → Asistencia → "Recalcular asistencia" (`recomputeAttendanceAction`):
  el rango filtrado, o los últimos días cerrados si no hay filtro. Queda en la auditoría
  (`attendance.compute`) y muestra un resumen por estado.
- Se guarda en lote (`unnest` + `ON CONFLICT`), no una consulta por día.

## Qué hace

Para cada **contrato** de una empresa y cada día de un período, calcula y guarda un
`attendance_day`: entrada, salida, horas trabajadas, horas por encima de la jornada (solo
referencia, **sin recargos legales** — eso es de nómina), minutos de tardanza y de salida
anticipada, cuántas marcaciones hubo y el estado del día.

Parte de **las mismas marcaciones que muestra y exporta Empresa → Asistencia**
(`companyAttendance`): sin repetidas (ventana de 3 min, `docs/11` R9), por la sede donde estaba
el equipo en ese momento (historial, O-UI6) y dentro del período del contrato. No toca
`attendance_logs`.

## Reglas (acordadas con el usuario el 2026-10-19)

| Tema | Regla |
| --- | --- |
| Horario del día | El del **historial del contrato** (`employment_schedule`): el último que empezó en o antes de ese día. Antes del primero, sin horario — asignar un horario hoy no vuelve "Ausente" los días pasados |
| Turno del día | Ese horario → el turno vigente en esa fecha (`effective_from/to`) cuyo `workdays` incluye ese día. Si hay varios, el que empieza antes |
| Entrada / salida | Primera marcación del día / última. Las del medio no cuentan para las horas |
| Turno que cruza la medianoche | La salida de la madrugada cuenta para el día en que empezó el turno (hasta 6 h después del fin), salvo que ya sea la llegada del turno del día siguiente (hasta 4 h antes de su inicio) |
| Horas trabajadas | Salida − entrada − la parte del descanso del turno que cae dentro |
| Jornada | Las horas cargadas en el turno; si no hay, fin − inicio − descanso |
| Horas extra (referencia) | Trabajadas − jornada, si es positivo |
| Tolerancias | Por horario; si no, por empresa; si no, **10 min** de tardanza y **10 min** de salida anticipada |
| Tardanza y salida anticipada el mismo día | Estado **Tardanza**, con los dos minutos guardados |
| Ausencia | Según la regla del horario/empresa (por defecto **no marcó nada**): `no_marks` = ninguna marcación; `no_check_in` = ninguna marcación en la primera mitad del turno; `under_hours` = trabajó menos de `absence_min_hours` |
| Entrada y salida variable | Solo horas: sin tardanza ni salida anticipada |
| Día no laborable | Sin marcar = **Día libre**; con marcaciones = **Día libre trabajado**, todas sus horas como extra de referencia |
| Contrato sin horario | **Sin horario**: solo horas, y solo los días en que marcó |
| Día en curso | No se calcula hoy ni el futuro: un día se cierra cuando termina (así no aparece "ausente" a primera hora) |

## Estados

| Estado | Significado |
| --- | --- |
| `present` | Presente, dentro de las tolerancias |
| `late` | Tardanza (`late_minutes`) |
| `early_leave` | Salida anticipada (`early_leave_minutes`) |
| `absent` | Ausente según la regla |
| `incomplete` | Una sola marcación: no hay horas |
| `rest_day` | Día no laborable, sin marcar |
| `rest_day_worked` | Día no laborable con marcaciones |
| `no_schedule` | El contrato no tiene horario |

## Datos

- `attendance_day` es **un día por contrato y fecha** (`@@unique([employment_id, date])`): alguien
  con contrato en dos empresas del grupo tiene un día en cada una. Columnas nuevas (migración
  `20261019140000_attendance_engine`): `late_minutes`, `early_leave_minutes`, `scheduled_minutes`,
  `mark_count`, y los estados nuevos del enum.
- Recalcular es idempotente (upsert por contrato y fecha) y borra los días que ya no
  corresponden en el rango (p. ej. el contrato terminó antes).
- Las horas guardadas en `first_in` / `last_out` son instantes reales (hora de pared de la sede
  convertida con su zona horaria).

## Historial de horario por contrato (2026-10-19)

Un horario rige **desde una fecha**. `employment_schedule` (migración
`20261019160000_employment_schedule_history`) guarda cada tramo: contrato, horario (null = "sin
horario desde ahí") y `starts_on`. `employment.schedule_group_id` sigue siendo el horario actual
(lo que muestran las listas).

- **"Asignar horario"** escribe el tramo con su "Vigente desde" (si el contrato empezó después,
  desde su inicio), borra los tramos que empezaban en o después de esa fecha y actualiza el
  contrato.
- **Trigger `employment_schedule_history`** en `employment`, para cualquier otro camino:
  contrato nuevo con horario → desde su inicio; cambio de horario en el formulario del contrato
  → **desde hoy** (Caracas), salvo que la app ya lo haya registrado con su fecha; cambio de la
  fecha de inicio → el tramo que regía al inicio se mueve con ella.
- Los contratos que ya tenían horario al migrar lo tienen desde su inicio (nada cambia).

## Correcciones manuales (paso 4, 2026-10-19)

Un día se corrige con el lápiz ("Corregir marcaciones") de su fila, en Empresa → Asistencia →
"Por día" o en Empleado → Asistencia (`CorrectDayDialog`). Se corrige la **entrada** del cálculo
— las marcaciones — no el resultado del día (los días se rehacen en cada recálculo):

- **Agregar una marcación que falta**: hora del día (o del día siguiente, para la salida de un
  turno nocturno) y sede si la empresa tiene varias. No futura, dentro del contrato.
- **Anular una marcación del equipo**: deja de contar; `attendance_logs` **no se toca**.
- **Deshacer** cualquiera de las dos: queda quién y cuándo (`revoked_at` / `revoked_by`), no se borra.
- **Motivo obligatorio** (al menos 5 caracteres) para agregar o anular. Cada cambio va a la
  auditoría (`attendance.correction.add_mark` / `void_mark` / `revoke`) y recalcula el día
  y los vecinos.

Las aplica `companyAttendance` al leer (`lib/companyAttendance.ts`): la marcación agregada entra
(id negativo, `manual`, equipo "Corrección manual") solo en la empresa de su contrato, y la
anulada no sale. Por eso **la lista "Marcaciones", el export a nómina y el motor ven lo mismo**.
Tabla `attendance_correction` (migración `20261019180000_attendance_mark_corrections`, que
reemplazó la del modelo original — por campo de un día, nunca usada, vacía): CHECK de forma por
tipo, motivo no vacío, y un índice único parcial para que una marcación se anule una sola vez.
Lógica en `lib/attendance/corrections.ts`; pruebas en `__tests__/attendanceCorrections.test.ts`.

## Código

- `lib/attendance/compute.ts` — el cálculo de un día, puro (sin base de datos). Pruebas en
  `lib/attendance/compute.test.ts`.
- `lib/attendance/engine.ts` — `computeCompanyAttendance(companyId, from, to)`: junta horario,
  tolerancias y marcaciones, calcula y guarda. Pruebas en `__tests__/attendanceEngine.test.ts`.

## Producción (2026-10-19)

No hay horarios cargados (0 horarios, 0 turnos; ningún contrato con horario). Hasta que ALCO los
cargue, todos los días saldrían como "Sin horario" (solo horas). De ahí la asignación de horario
en masa del paso 3.

## QA de punta a punta (Playwright)

`e2e/asistencia.spec.ts` recorre el paso 3 (asignar horario a varios, "Por día" con cada estado,
filtro por estado, pestaña del empleado y volver, "Recalcular", "Marcaciones" igual). Los datos
los crea `e2e/seed-asistencia.ts`, que **se niega a correr contra otra base que no sea el Postgres
de Docker** (puerto 55432). Para no tocar el server de desarrollo de nadie (ni producción, si el
`.env` apunta ahí por el túnel), se levanta uno aparte en otro puerto, con su propia carpeta:

```bash
# server de QA (desarrollo, carpeta .next-qa, base de Docker)
DATABASE_URL="postgresql://biometric:biometric@localhost:55432/biometric?schema=public" \
  NEXT_DIST_DIR=.next-qa PORT=3100 npx tsx server.ts
# en otra terminal: la corrida, con video y trace de cada test en e2e/.artifacts/runs/<fecha-hora>/
DATABASE_URL="postgresql://biometric:biometric@localhost:55432/biometric?schema=public" \
  E2E_BASE_URL=http://localhost:3100 E2E_RUN_DIR="e2e/.artifacts/runs/$(date +%Y-%m-%d_%H%M%S)" \
  npx playwright test e2e/asistencia.spec.ts
```

Al terminar: detener el server de QA y borrar `.next-qa/` (Next agrega esa carpeta a
`tsconfig.json` al usarla: no commitear ese cambio). La primera corrida de 2026-10-19 pasó 8/8
(reporte y videos en `e2e/.artifacts/`, fuera de git).
