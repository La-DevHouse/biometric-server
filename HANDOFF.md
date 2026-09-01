# Estado del proyecto y próximos pasos

_Log de avance y hoja de ruta. Actualizado: 2026-09-01._
_(El handoff original de reconciliación de documentación quedó completado; ver `git log HANDOFF.md` si se necesita.)_

---

## 1. Dónde vamos

**Fase 1 para Grupo ALCO.** Stack: Next.js 16 (App Router) + `server.ts` custom, PostgreSQL + Prisma
(`@prisma/adapter-pg`), auth propia por sesión en cookie. Ver `docs/00-index.md` para el índice.

### Hecho

- **Migración SQLite → Postgres/Prisma**: completa y desplegada en el server de test (Nuremberg).
  Hot path del protocolo en SQL crudo vía 4 helpers de `lib/db.ts`; dominio con cliente Prisma.
- **Auth**: email/contraseña, sesión con token opaco en `app_session` (fuente de verdad), cookie
  httpOnly. `requireUser()` en layout + páginas + server actions; `proxy.ts` (Edge) hace el chequeo
  optimista de cookie en `/admin/**` y `/api/**`.
- **Hito 3 — administración de dominio (CRUD completo #1–#6):**
  1. Empresas + Sedes (jerarquía de 2 niveles, RIF, umbrales de asistencia, zona horaria por sede)
  2. Departamentos + Puestos
  3. Grupos de empleados + Turnos (HH:MM, días, vigencia, cruza-medianoche)
  4. Empleados + Empleos (persona/pool + N vínculos; alta / baja / **traslado** con `$transaction`)
  5. Enrolamiento (mapear slot `(equipo, user_id)` → empleado; unique parcial del enrolado activo)
  6. Cuentas de plataforma (`app_user` CRUD + resetear contraseña + cambiar la propia)
- **Extras de la sesión del 2026-09-01:**
  - Cédula/RIF: input libre → **tipo (`<select>`) + número numérico** (`lib/documento.ts`,
    `DocumentField`). Se guarda igual (`PREFIJO-dígitos`), sin cambio de schema.
  - **Asignar dispositivo → empresa/sede** en la ficha del equipo (`DeviceAssignDialog`,
    `app/admin/dispositivos/actions.ts`). Sin empresa no hay sede; la sede debe ser de esa empresa.
  - **Fix del reloj**: `SET_TIME` mandaba la hora en UTC → ahora manda hora de pared de la zona
    de la sede. `lib/time.ts` (solo `Intl`, sin deps): `formatDeviceTime`/`parseDeviceTime(instant, tz)`,
    `dateKeyInTz`, `isValidTimeZone`, `DEFAULT_TZ` (env `DEFAULT_TIMEZONE`, default `America/Caracas`).
  - **Multi-zona**: migración `site_timezone` (`site.timezone` IANA, default Venezuela) + selector
    en el form de sede + validación en el server.
  - **`proxy.ts`** (Next 16 renombró `middleware` → `proxy`) + `requireUser()` agregado a las 6
    páginas admin viejas que solo dependían del layout (cerraba un hueco en navegación soft).
  - Fix: pool separado para Prisma (el `types.setTypeParser(20)` global rompía la lectura de
    columnas `BigInt` del protocolo → `P2023`). Flag `COOKIE_INSECURE=1` para el server de test HTTP.

### Verificación local de todo lo anterior

`tsc --noEmit` 0 · `npm test` 58/58 · `next build` 0 (`ƒ Proxy` reconocido) · smokes de dominio.

---

## 2. Sin commitear al momento de parar

**Nuevos:** `lib/time.ts`, `proxy.ts`, `app/admin/dispositivos/actions.ts`,
`components/admin/DeviceAssignDialog.tsx`, `prisma/migrations/20260901165749_site_timezone/`.

**Modificados:** las 6 páginas admin viejas (`requireUser`), `app/admin/empresas/[id]/page.tsx` +
`app/admin/empresas/actions.ts` + `components/admin/SiteFormDialog.tsx` (zona horaria),
`app/admin/enrolamiento/page.tsx`, `lib/protocol.ts` + `lib/handlers/index.ts` +
`lib/handlers/protocol-handlers.ts` (reloj), `prisma/schema.prisma`, `__tests__/protocol.test.ts`,
`docs/qa-hito-3.md`.

**Para desplegar:**
1. `git add` + commit + push a `main` → Coolify redespliega y `prisma migrate deploy` aplica
   `site_timezone`.
2. Env en Coolify (app): `COOKIE_INSECURE=1` (mientras el panel se sirva por HTTP en el test),
   `DEFAULT_TIMEZONE` si se quiere otro default.
3. QA en vivo con `docs/qa-hito-3.md` (secciones 0–7).

> **Nota HTTPS**: el dominio `*.sslip.io` de Coolify NO puede tener cert Let's Encrypt (rate-limit).
> Para HTTPS real hace falta un dominio propio (subdominio → A record a `2.28.70.76`). Mientras
> tanto, `COOKIE_INSECURE=1` permite entrar por HTTP. **Nunca** usar ese flag en Ashburn.

---

## 3. Qué sigue — Hito 4: motor de asistencia

### Decisiones aprobadas

1. **Cómputo explícito**: botón "recalcular período" que hace upsert idempotente de `attendance_day`
   (no auto-cálculo en cada marcaje — eso acopla el hot path; queda para cuando exista `sync-worker`).
2. **Zona horaria**: `io_time` es hora de pared local de la sede (`site.timezone`, fallback
   `DEFAULT_TZ`). `first_in`/`last_out` en `timestamptz`. Marca de las 02:00 en turno nocturno
   pertenece al día del turno que arrancó el día anterior.
3. **In/out**: primera marca de la ventana del turno = entrada, última = salida; las del medio se
   ignoran para el cálculo de horas (salvo `shift.variable_in_out`).

> Contexto: ALCO respondió que la **valoración final** de tardanza/ausencia/salida anticipada
> (y feriados, recargos, bono nocturno) va al **sistema de nómina de Fase 2**. Fase 1 produce la
> capa observable + clasificación con umbrales configurables (grupo → empresa) + corrección
> auditada + consolidado. `docs/08-data-model.md` ya tiene el schema firmado para esto.

### Plan por piezas

| # | Pieza | Qué hace | UI |
| --- | --- | --- | --- |
| **4a** | `lib/attendance/resolve.ts` | `attendance_logs.(dev_id, user_id)` → `employee_id` vía `employee_device_enrollment` activo (respetando `enrolled_at`/`ended_at`). Puebla `attendance_logs.employee_id`. Función pura, sin imports de Next. | — |
| **4b** | `lib/attendance/shift.ts` | Empleado + fecha → `employment` activo → `employee_group` → `shift` vigente (`effective_from..to` + weekday en `workdays`, con `crosses_midnight`). Función pura. | — |
| **4c** | `lib/attendance/compute.ts` | (marcas del día + turno + umbrales) → fila `attendance_day` (first_in, last_out, worked_minutes, overtime, status). Idempotente (upsert `(employee_id, date)`). Fixtures + tests. | botón "Recalcular" |
| **4d** | Vista de asistencia procesada | Tabla por empresa/grupo/período; detalle del día con marcas crudas; diálogo de **corrección manual** → `attendance_correction` (motivo, auditado, CHECK "un solo target"). | pantalla nueva |
| **4e** | Consolidado del período | Rollup por empleado: días trabajados, tardanzas, ausencias, horas totales. Base para el export de Hito 5. | tab/vista |

**Arrancar por 4a + 4b** (base de todo, sin bloqueos externos, validable contra los marcajes reales
del equipo de test). Después 4c con las 3 decisiones de arriba resueltas.

### Después de Hito 4

- **Hito 5**: reportes + consolidado + export a hoja de cálculo. Formato exacto para nómina
  (Galepso) sigue **diferido** — export genérico CSV/xlsx por ahora.
- **Infra pendiente**: extraer `sync-worker.ts`; migración a producción (Ashburn) desde cero;
  fijar el puerto de ingesta de producción (hoy `8090` es valor de test); dominio propio + HTTPS;
  migración de huellas entre equipos (`GET_ENROLL_DATA`/`SET_ENROLL_DATA`, aún sin resolver).

---

## 4. Cómo reanudar

1. Commitear/pushear lo de la sección 2 y setear las env de Coolify.
2. Pedirle a Claude: **"seguí con Hito 4, arrancá por 4a y 4b"**.
3. `docs/qa-hito-3.md` es solo de Hito 3. Hito 4 tendrá su propio `docs/qa-hito-4.md` cuando
   se construyan 4c/4d. Único cruce: `docs/qa-hito-3.md` §2.3.4 (chequeo de reloj/zona horaria,
   porque el form de sede cambió).
