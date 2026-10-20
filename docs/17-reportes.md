# 17 — Reportes del período (Hito 5)

Contrato (`01-requirements.md` → "Reportes y exportación"): reportes por empresa, empleado y rango
de fechas; **consolidado del período** como insumo de nómina; **reporte de incidencias**; y el
export a nómina (Galepso, ya hecho: `docs/11` R1–R11).

Todo sale de los días que calcula el motor (`attendance_day`, `docs/16`) y de las correcciones
manuales vigentes. Los reportes **no recalculan**: si un período no está calculado, se usa
"Recalcular asistencia" (arriba a la derecha en Empresa → Asistencia).

## Dónde está

| Reporte | Pantalla | Descarga |
| --- | --- | --- |
| Consolidado por contrato | Empresa → Asistencia → **Consolidado** (`?vista=consolidado`) | "Descargar .xlsx" |
| Incidencias | Empresa → Asistencia → **Incidencias** (`?vista=incidencias`, filtro por tipo) | "Descargar .xlsx" |
| Por empleado | Empleado → Asistencia (días y totales del rango, en todas sus empresas) | — |
| Marcaciones / Por día | Las vistas que ya existían | Galepso (Marcaciones) |

Ambos reportes tienen rango Desde/Hasta (por defecto los últimos días cerrados) y atajos de período
de nómina: **Quincena en curso, Quincena anterior, Mes en curso, Mes anterior**. Un período que no
terminó llega hasta ayer (`periodPresets`). Cada persona enlaza a su pestaña Asistencia con el mismo
rango, y "←" vuelve al reporte.

## Consolidado — definiciones

Una fila por **contrato** vigente en algún día del período, aunque no tenga días calculados.

| Columna | Qué cuenta |
| --- | --- |
| Días laborables | Días que el horario esperaba trabajo: presente, tardanza, salida anticipada, ausente, incompleto |
| Días trabajados | Días con entrada y salida (horas > 0), incluye días libres trabajados y días sin horario |
| Horas trabajadas / extra | Suma de los días; la extra es **solo referencia, sin recargos legales** |
| Tardanzas / salidas anticipadas | Cantidad de días y minutos totales. Un día con las dos cuenta en ambas |
| Ausencias, días incompletos, días libres trabajados | Cantidad de días con ese estado |
| Correcciones manuales | Correcciones vigentes con marcaciones del período (en pantalla, debajo del nombre) |

En pantalla, "4 de 5" = días trabajados de los laborables, y una fila Total. El `.xlsx` trae además
cédula, referencia de nómina y horario, con horas como número decimal y minutos enteros (se pueden
sumar), filtro en los títulos y la fila de títulos fija.

## Incidencias — definiciones

Una fila por incidencia, por fecha y persona: **tardanza** (minutos), **salida anticipada**
(minutos), **ausencia**, **marcación incompleta** (la hora de la única marcación), y las
correcciones manuales vigentes: **marcación agregada / anulada a mano**, con hora, motivo, quién y
cuándo. Una corrección deshecha no aparece. Los contratos sin horario no tienen tardanzas ni
ausencias.

## Código

- `lib/attendance/reports.ts` — `companySummary`, `companyIncidents`, `periodPresets`.
- `lib/export/reports.ts` — `buildSummaryXlsx`, `buildIncidentsXlsx`, `reportFileName`
  (`<EMPRESA> Consolidado|Incidencias <desde>_<hasta>.xlsx`).
- `app/admin/empresas/[id]/asistencia/ReportsView.tsx` — las dos vistas.
- `app/admin/empresas/[id]/asistencia/reporte/route.ts` — la descarga (`?tipo=consolidado|incidencias`);
  cada descarga queda en la auditoría (`attendance.report`).
- Pruebas: `__tests__/attendanceReports.test.ts`; E2E en `e2e/asistencia.spec.ts` (incluye abrir el
  `.xlsx` descargado).

## Pendiente de confirmar con ALCO

- Si las definiciones de "días trabajados" y "días laborables" son las que usan para nómina.
- Si necesitan el consolidado de **todas las empresas** en un solo archivo (hoy es por empresa).

## Inicio (2026-10-20)

La pantalla de Inicio resume, dentro del alcance de la cuenta (`docs/18`): equipos en línea,
marcaciones de hoy, personas con contrato e incidencias; el **último día laborable** calculado
(ayer, o el viernes si es lunes) por estado; **"Requiere atención"** (equipos sin conexión, equipos
sin sede —solo administradores—, contratos sin horario, IDs de equipo sin empleado en 7 días, bajas
frenadas por aprobar, correcciones manuales de la semana); una tabla **por empresa** de ese día,
ordenada por incidencias, con enlaces a su "Por día" filtrado; y las últimas marcaciones con el
nombre de la persona. Código: `lib/dashboard.ts`, `app/admin/page.tsx`; prueba `__tests__/dashboard.test.ts`.
"Hoy" es el día de Caracas (antes salía de la zona horaria del servidor).
