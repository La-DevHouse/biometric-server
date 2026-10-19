# Handoff — estado del proyecto para retomar en otra sesión

_Actualizado: 2026-10-16. Reemplaza el handoff del 2026-09-01 (sigue en `git log HANDOFF.md`)._

Este documento es para quien retome el trabajo —en particular una sesión de Claude Code en
la nube— sin el historial de la conversación que lo produjo. Léelo junto con `CLAUDE.md`
(instrucciones del repo, se cargan solas) y `docs/00-index.md` (índice de toda la documentación).
Si algo de acá contradice al código, manda el código; si contradice a `docs/`, revisá la fecha.

---

## 1. Qué es esto, en un párrafo

Fase 1 de una plataforma para **Grupo ALCO** (servicios de RRHH en Venezuela, ~40 empresas
cliente): gestión remota de biométricos de asistencia (huella y faciales), empresas / sedes /
empleados / contratos, sincronización automática de huellas entre equipos, y exportación de la
asistencia en el formato que ALCO carga en su sistema de nómina (**Galepso**). Solo 4 usuarios
internos de ALCO. Alcance contractual: `docs/01-requirements.md`. Panel en producción:
`https://admin.alcolegaltech.com`.

**Stack:** Next.js 16.2 (App Router) con `server.ts` propio (los equipos postean a `//`) ·
PostgreSQL + Prisma 6 (`@prisma/adapter-pg`; el hot path del protocolo usa SQL crudo con los
helpers de `lib/db.ts`) · worker aparte con pg-boss (`worker/index.ts`) · Tailwind · tests con
`node:test` vía `tsx` · Coolify en Hetzner.

> **Next 16 no es el que conocés:** `AGENTS.md` pide leer `node_modules/next/dist/docs/` antes de
> escribir código de Next (verificado que existe). Ej.: `middleware` ahora es `proxy.ts`.

---

## 2. Qué puede y qué no puede hacer una sesión en la nube

| Se puede | No se puede |
| --- | --- |
| Leer/editar código, `tsc`, `eslint`, tests (con un Postgres disponible) | **Hablar con los equipos físicos**: están en la LAN del usuario o apuntados a producción. Todo lo que dependa de hardware hay que pedírselo al usuario |
| Levantar la app local con datos de prueba | **Acceder a la base de producción**: ni la sesión ni el usuario tienen acceso directo hoy. Si hace falta un dato de prod, pedir que alguien con acceso corra una consulta |
| Commit / push a `main` cuando el usuario lo pide | Probar en un navegador real (salvo que la sesión tenga uno). Ver §8 para renderizar páginas con `curl` |

**Tests y base de datos.** `npm test` corre primero `scripts/test-db-setup.ts` (crea/migra la base
de tests) y después todos los `lib/**/*.test.ts` y `__tests__/**/*.test.ts` en serie. Necesita
`DATABASE_URL` en `.env` (copiar de `.env.example`) y un Postgres: localmente
`docker compose up -d db` (puerto **55432**, usuario/clave/base `biometric`; la de tests es
`biometric_test`). Si en la nube no hay Docker, apuntar `DATABASE_URL`/`TEST_DATABASE_URL` a
cualquier Postgres 16+ y correr `npm run db:migrate:deploy`. Al 2026-10-16: **185/185 tests pasan**.

**Desarrollo contra producción (2026-10-18):** el usuario corre el panel local contra la base de
producción por un túnel SSH (`DATABASE_URL` → `localhost:5432`). Consecuencias: todo lo que se
haga en el panel local es real; **no correr `prisma migrate` desde local** (las migraciones las
aplica el deploy); no apuntar equipos al PC; y `npm test` **se niega** a correr sin un
`TEST_DATABASE_URL` aparte (candado en `scripts/test-db-setup.ts`). Cada consulta tarda ~1 s por
el túnel.

**Comandos útiles:** `npm run dev` (app + protocolo en `:3000`) · `npm run worker:dev` ·
`npx tsc --noEmit -p .` · `npx eslint <archivos>` · `npm run db:migrate:deploy` ·
`npx prisma generate`.

---

## 3. Mapa del código (lo que más se toca)

| Dónde | Qué |
| --- | --- |
| `server.ts` | Server HTTP propio: normaliza `//` → `/` y engancha `lib/deviceHttp.ts` |
| `lib/deviceHttp.ts` | Rescata los pedidos con `Content-Length: -1` de los faciales (Node los rechaza) |
| `lib/handlers/protocol-handlers.ts` | **Hot path del protocolo**: `receive_cmd` (cola de comandos, identidad, candado por equipo), `send_cmd_result`, `realtime_glog`, `realtime_enroll_data` |
| `lib/deviceIdentity.ts` | Identidad del equipo: `dev_id`, o `fk_name` si el `dev_id` es placeholder (faciales) |
| `lib/protocol.ts` | Framing del body (length-prefix), decodificación de listas y marcaciones |
| `lib/operations/` | Operaciones de alto nivel (cadenas de comandos con verificación): `index.ts` (start*), `advance.ts` (reacciona a cada resultado, expira las colgadas), `batch.ts` (altas en lote), `queue.ts` |
| `lib/sync/` | Reconciliador de huellas (`reconcile.ts`, `plan.ts`), pull de asistencia (`attendance.ts`), vista previa de impacto (`impact.ts`) |
| `lib/fingerprints.ts` | Copias canónicas de huellas y registro de procedencia por slot |
| `lib/companyAttendance.ts` | **La consulta de asistencia por empresa**: misma para la vista y el export. Ventana de repetidas, IDs sin empleado, asignación puntual al exportar |
| `lib/export/galepso.ts` + `app/admin/empresas/[id]/asistencia/export/route.ts` | El `.xlsx` "Relación de Asistencia" para Galepso |
| `worker/index.ts` | Crons: huellas cada 30 min, asistencia 02:00, revisión nocturna 03:00, expirar operaciones cada minuto |
| `app/admin/**` | Panel (server components + server actions). `components/admin/**` diálogos y piezas; `components/ui/**` sistema de diseño (íconos en `components/ui/icons.tsx`) |
| `prisma/schema.prisma` + `prisma/migrations/` | Schema; la app corre `prisma migrate deploy` al arrancar (`npm start`) |
| `docs/` | Ver `docs/00-index.md`. Los más vivos: `04` (protocolo), `05` (comandos y rarezas de hardware), `10` (dominio + reconciliador), `11` (UI y reportes: reglas R1–R11, C1–C5, U1–U8) |

---

## 4. Qué se hizo en la última tanda (2026-10-12 → 10-16), todo en `main`

| Commit | Qué |
| --- | --- |
| `d6e378e` | **Identidad de faciales.** Mandan siempre `dev_id 000000000001`; ahora la identidad es su `fk_name` (trae el serial). `devices.name` = nombre visible (editable); `fk_name` solo lectura desde el panel y, en equipos normales, el server lo reescribe con el serial si alguien lo cambia. `send_cmd_result` se atribuye por `trans_id`. Migración re-keyea lo que estaba bajo `000000000001` |
| `d534c60` | Pull de marcaciones de faciales solo cuando un `GET_DEVICE_STATUS` reporta marcaciones nuevas (con 0 marcaciones no responden `GET_LOG_DATA`) |
| `b5fff16` | **Errores de faciales**: rescate de `Content-Length: -1` + reintento automático de `GET_USER_INFO`/`SET_ENROLL_DATA` (`FACIAL_ERROR_RETRIES`, default 10, columna `commands.attempt`). Con esto la huella llegó de un facial al otro (verificado con el dedo) |
| `9cb2248` | **Repetidas**: en vista y export no salen marcaciones de la misma persona a < 3 min de la anterior en cualquier equipo (`ATTENDANCE_DEDUP_SECONDS`, 0 = apagado). Solo al leer: `attendance_logs` no se toca (decisión del usuario) |
| `e6b92d3`, `b9f3f1a` | **IDs sin empleado**: se ven en Empresa → Asistencia ("Sin empleado", con "ID nnn"); al exportar, un aviso deja asignarlos a una persona **solo para ese archivo** (no se guarda nada — decisión explícita del usuario) |
| `47f6fd3`, `bf676be` | Asignar cualquier equipo a una sede desde Empresa → Sedes |
| `f384e43` | Desde un empleado abierto desde una empresa, "←" vuelve a esa empresa con sus filtros (`?volver=`, `lib/returnTo.ts`) |
| `9aa88c8` | Íconos SVG simbólicos en el menú lateral y el buscador |

---

## 5. Hechos de hardware que hay que saber (verificados con equipos reales)

Detalle en `docs/04` y `docs/05`. Modelos: huella `WS535BW1_BSCS_v1.5.31`; facial
`WS545CW_FP3FC5_BSCS_V2.0.33`.

- El equipo hace **polling HTTP/1.0 cada ~10 s**; no hay socket persistente. Postea a `//`.
- **Faciales:**
  - `dev_id` siempre `000000000001` → identidad por `fk_name`. Si alguien cambia el nombre del
    facial desde su teclado, aparece como equipo nuevo. Si `fk_name` está vacío, queda en cuarentena.
    Algunos llegan con un nombre de fábrica (`FK_DEV`, 2026-10-18): se corrige con "Corregir serial"
    en el detalle del equipo (escribe el serial con `SET_FK_NAME` y mueve el registro, `lib/deviceRekey.ts`).
  - Sus `realtime_glog`/`realtime_enroll_data` no se pueden atribuir y se descartan; las
    marcaciones entran por `GET_LOG_DATA` (lo conservan en memoria). Se pierden las fotos de marcación.
  - `GET_LOG_DATA`: **no responde con 0 marcaciones** e **ignora el rango de fechas**.
  - Reportan errores con `cmd_return_code:Error` + `Content-Length: -1` (lo rescata `lib/deviceHttp.ts`).
  - `GET_USER_INFO` y `SET_ENROLL_DATA` fallan **al azar** (sale bien entre 1 de 8 y 1 de 3);
    un `SET_ENROLL_DATA` rechazado no escribe. De ahí los reintentos.
  - `GET_USER_INFO` de un facial trae huella (612 B, slot 0–9), **rostro** (slot 12, 5704 B, sin el
    user_id embebido) y `user_photo`.
- **Huellas entre equipos:** leer siempre con `GET_USER_INFO` (612 B), nunca `GET_ENROLL_DATA`;
  patchar el user_id en el offset 608. `GET_USER_ID_LIST` **solo lista usuarios con ≥1 huella**.
  Sobre un slot ocupado, `SET_ENROLL_DATA` responde OK y no escribe. `SET_USER_INFO` sobre un
  usuario existente reindexa (destructivo) — por eso no se reintenta.
- `GET_USER_INFO` a veces no responde aunque el usuario exista: nunca tomar el silencio como
  "no existe".

---

## 6. Pendiente (en orden sugerido)

### Bugs / problemas abiertos

1. **"Sincronizar lista de usuarios" no asigna huellas a empleados** (diagnosticado, sin
   implementar). `advanceSyncUsers` (lib/operations/advance.ts) guarda lo leído en la caché
   (`users`/`enroll_data`) pero no llama a `ingestUserInfo`. Después el reconciliador
   (`selectUsersToRead`, lib/sync/plan.ts) los da por conocidos y no los relee → los empleados
   quedan "Sin huella" y "en 0 de 1" aunque el equipo tenga sus huellas (visto en producción,
   empresa "El Castillo del Pan"). Arreglo propuesto: (a) que `advanceSyncUsers` llame a
   `ingestUserInfo`; (b) que el reconciliador relea a quien tiene huellas en caché pero sin
   registro de procedencia (`device_fingerprint_slot`), para sanar lo existente solo.
2. **Faciales no aceptan crear usuarios** (`SET_USER_INFO`): 14/14 rechazados en local, antes y
   después de reiniciar. Pero en producción sí se crearon algunos (p. ej. en el facial "Equipo 2").
   Sin entender esto, la sincronización no puede poner empleados nuevos en un facial. Siguiente
   paso: mirar en la base de prod los `SET_USER_INFO` a `2401058627`/`2401058636` (resultado y
   parámetros) — necesita a alguien con acceso.
3. **Copiar el rostro entre faciales: no funcionó** (`SET_ENROLL_DATA` slot 12: 14/14 rechazados).
   No es contractual. Opciones: SDK/herramienta del fabricante, enrolar la cara en cada facial,
   o seguir probando (¿hace falta la foto junto al template?).
4. **Un usuario que marca con un ID viejo** (no su cédula) no aparece como suyo. Ya se ve como
   "Sin empleado" y se puede asignar al exportar; la receta de fondo está en `docs/10` §4.5.

### Lo que falta del plan de hitos (revisado el 2026-10-16)

- **Hito 4 — motor de asistencia: no existe.** `attendanceComputeAll()` (lib/sync/attendance.ts)
  está vacía; las tablas `attendance_day` y `attendance_correction` existen pero nada las usa.
  Falta: asistencia/tardanzas/salidas anticipadas/ausencias contra el horario, horas trabajadas
  y extra de referencia (sin recargos), turnos nocturnos, **corrección manual auditada** (UI).
  Decisiones ya tomadas en su momento: cómputo explícito e idempotente por período; `io_time` es
  hora de pared de la sede; primera marca = entrada, última = salida. **Confirmar con ALCO:**
  tolerancias, qué es ausencia, marcaciones impares. Ojo: el `HANDOFF` viejo proponía resolver
  marcaciones vía `employee_device_enrollment`; hoy se resuelven por **cédula = user_id**
  (`docs/10` §4.6), así que esa pieza ya no aplica.
- **Hito 5 — reportes:** consolidado del período por empleado (días, horas, tardanzas, ausencias,
  extra), reporte de incidencias, reporte por empleado (la ficha no tiene pestaña de asistencia).
  Dependen del motor. El export a Galepso ya existe (`docs/11` R1–R11); falta confirmar con ALCO
  el texto del pie y el nombre de la hoja (O-UI1/O-UI2).
- **Infra (`docs/06`):** el doc dice que Ashburn, la Floating IP, `postgres-alco` de prod y el
  servicio del worker estaban "pendientes"; el panel ya está en `admin.alcolegaltech.com` y los
  equipos apuntan ahí, así que **el doc probablemente está desactualizado** — confirmar con el
  usuario qué existe y actualizarlo. Verificar que el **worker** esté corriendo (sin él no hay
  sincronización cada 30 min ni carga diaria de marcaciones).
- **O-UI6:** el alcance de la asistencia usa la sede **actual** del equipo; mover un equipo de
  empresa re-imputa sus marcaciones viejas. Ahora que se puede mover equipos desde la sede
  (`47f6fd3`), esto pesa más.
- Control de acceso por perfil (hay `app_user.role`, verificar que restrinja algo), una pantalla
  para consultar `audit_log`, el plan de pruebas físicas `docs/13`, capacitación y entrega.

---

## 7. Cómo trabaja el usuario (convenciones)

- **Idioma:** el usuario escribe en español; responder en español. La UI usa **voseo**
  ("Elegí", "Probá") — mantenerlo. Código y mensajes de commit en inglés; comentarios y docs en español.
- **Push:** no pushear sin que lo pida ("pushealo", "súbelo a main"). A veces pushea él. Antes
  de pushear: `git fetch` y revisar que no haya nada nuevo en `origin/main`.
- **Commits:** estilo convencional (`feat(scope): …`, `fix(scope): …`), cuerpo explicando el
  porqué, y al final `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Se trabaja
  directo sobre `main`.
- **Docs en el mismo cambio:** si el código invalida algo de `docs/`, se actualiza en el mismo
  commit (regla de `CLAUDE.md`). Las reglas de UI/reportes nuevas van como filas en `docs/11`.
- **Decisiones del usuario que hay que respetar:** no cambiar cómo se guardan las marcaciones
  (deduplicar / asignar solo al leer o exportar); asignaciones de IDs sin empleado **no
  persistentes**; el `fk_name` de los equipos no se edita desde el panel (única excepción: "Corregir serial" de un facial).
- **Al proponer algo con trade-offs**, dar una recomendación concreta; el usuario decide rápido.
  Si pregunta "¿qué falta?" o "¿por qué pasa X?", responder sin ejecutar cambios.

---

## 8. Trucos que ahorran tiempo

- **Renderizar una página del panel sin navegador:** insertar una sesión temporal en la base
  **local** y pedir la página con `curl`, después borrarla:
  ```sql
  insert into app_session (token, app_user_id, expires_at) values ('tmp-tok', 1, now() + interval '1 hour');
  -- curl -b "session=tmp-tok" http://localhost:3000/admin/empresas/1/asistencia
  delete from app_session where token = 'tmp-tok';
  ```
- **Migraciones con Prisma:** `npx prisma migrate dev --create-only --name x` agrega ruido
  (`ALTER ... SET DEFAULT (extract(epoch ...))` en tablas del protocolo): borrar esas líneas y
  dejar solo el cambio real.
- **Comandos crudos a un equipo** (cuando haya equipos conectados a un server local): insertar en
  `commands (dev_id, cmd_code, cmd_param, status)` con `status='WAIT'`; el equipo lo toma en su
  próximo poll. El panel tiene Diagnóstico para lo mismo. `raw_traffic` guarda todo lo que entra
  y sale (headers + preview del body) — es la primera parada para depurar.
- **Lint:** hay errores preexistentes de `react-hooks/set-state-in-effect` (patrón de cerrar el
  diálogo al guardar, p. ej. `DeviceAssignDialog`, `AdminShell`) y `no-require-imports` en los
  tests que hacen `require()` después de fijar `DATABASE_URL`. No son regresiones.
- **Windows:** el repo se trabajó en Windows (Git Bash + PowerShell); los avisos "LF will be
  replaced by CRLF" son normales.
- **Equipos de prueba conocidos:** faciales `2401058627` ("Equipo 1") y `2401058636`
  ("Equipo 2"); de huella `2023081158`, `2023081133`, `2023054246`, `2023054254`.
