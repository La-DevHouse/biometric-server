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
  elegir un horario (o quitarlo) para varias personas a la vez, con atajos "Seleccionar todos" y
  "Solo los sin horario". Queda en la auditoría (`employment.assign_schedule`) y recalcula la
  asistencia de los últimos días al guardar.

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
| Turno del día | El horario del contrato → el turno vigente en esa fecha (`effective_from/to`) cuyo `workdays` incluye ese día. Si hay varios, el que empieza antes |
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

## Código

- `lib/attendance/compute.ts` — el cálculo de un día, puro (sin base de datos). Pruebas en
  `lib/attendance/compute.test.ts`.
- `lib/attendance/engine.ts` — `computeCompanyAttendance(companyId, from, to)`: junta horario,
  tolerancias y marcaciones, calcula y guarda. Pruebas en `__tests__/attendanceEngine.test.ts`.

## Producción (2026-10-19)

No hay horarios cargados (0 horarios, 0 turnos; ningún contrato con horario). Hasta que ALCO los
cargue, todos los días saldrían como "Sin horario" (solo horas). De ahí la asignación de horario
en masa del paso 3.
