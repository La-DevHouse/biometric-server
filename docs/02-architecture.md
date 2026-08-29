# Arquitectura de software

## ⚠️ Pendiente: diseño de UX y modelo de datos para Hitos 3–5

**Sin empezar.** Los Hitos 3 (administración de empresas/empleados), 4 (horarios/turnos/asistencia) y 5 (reportes/exportación) — ver `01-requirements.md` — no tienen todavía ninguna especificación de vistas, acciones de usuario, ni modelo de datos más allá de lo que ya existe para el protocolo de dispositivos (`devices`, `commands`, `attendance_logs`, `users`, `enroll_data`).

El método de descubrimiento en curso: relevar el sistema legacy **Adempiere** que Grupo ALCO usa hoy para biométricos (el que esta Fase 1 reemplaza) — catalogar sus vistas y acciones disponibles como referencia de UX/dominio para especificar cómo debe verse y comportarse el sistema nuevo. **Adempiere es solo referencia — el sistema nuevo no integra con él ni depende de él en ningún sentido técnico.**

Cuando ese relevamiento produzca una especificación concreta (vistas, relaciones entre entidades, tablas), documentarla en un archivo nuevo `docs/07-admin-ux-spec.md` (número reservado) — no fusionarla dentro de este documento, para no mezclar "cómo está construido el protocolo" con "cómo debe ser la experiencia de administración".

## ⚠️ Pendiente: migración de SQLite a Postgres

**Decisión tomada, ejecución pendiente.** El PoC arrancó con SQLite (ver razones históricas abajo), pero se decidió migrar a **Postgres en un contenedor separado dentro de Coolify** (`postgres-alco`, un servicio propio, no compartiendo proceso con `dashboard-alco`/`sync-worker-alco`). Esto no es Directus ni el patrón completo del WaaS original — es específicamente el motor de base de datos; el admin sigue siendo Next.js custom (`app/admin/**`).

**Por qué se reabrió esta decisión:** el plan original de infraestructura (antes de revisar el código real) ya asumía Postgres. Al confirmar que el PoC usaba SQLite, se documentó como "decisión asentada" — pero el negocio decidió después que vale la pena pagar el costo de migrar ahora, mientras el volumen de datos es bajo, en vez de arrastrar SQLite hacia producción.

**Motivo técnico adicional que refuerza la decisión:** Postgres resuelve de raíz el problema de "volumen compartido" que iba a generar la separación en `dashboard-alco`/`sync-worker-alco` (ver más abajo) — con SQLite, dos contenedores necesitan compartir el mismo archivo físico vía un volumen montado en ambos, más `PRAGMA journal_mode=WAL` para tolerar escritura concurrente. Con Postgres, ambos procesos simplemente son clientes de red hacia el mismo servicio de base de datos — sin archivo compartido, sin locks de filesystem, es el modelo estándar para el que Postgres está diseñado.

**Trabajo pendiente (no ejecutado todavía):**

1. Definir el schema en Postgres equivalente al de SQLite (`devices`, `commands`, `attendance_logs`, `users`, `enroll_data`, `block_buffer`, `raw_traffic`) — los campos `BLOB` de SQLite mapean a `bytea` en Postgres, sin cambios conceptuales.
2. Reescribir `lib/db.ts`: reemplazar el driver `sqlite3` (callback-based) por un cliente Postgres (ej. `pg`). Este es un cambio de código real, no solo de infraestructura — toda la capa de acceso a datos cambia de forma/API.
3. Decidir si se mantiene "sin ORM" (queries directas con `pg`) o se introduce un query builder — no asumir ninguna de las dos, es una decisión a tomar explícitamente al hacer el cambio.
4. En Coolify: crear el servicio `postgres-alco` (contenedor separado, con su propio Persistent Storage para el datadir de Postgres — esto es el volumen _propio_ de Postgres, no el problema de "compartir un archivo SQLite entre contenedores" que ya no aplica una vez migrado). Las apps se conectan por el hostname interno de Docker que expone Coolify, sin publicar el puerto de Postgres públicamente.
5. Variable de entorno de conexión (ej. `DATABASE_URL`), siguiendo la misma convención que ya usa el proyecto con `PORT`.
6. Decidir si vale la pena migrar los datos existentes del servidor de test (probablemente no — sigue siendo fase de desarrollo, es razonable arrancar Postgres limpio) o si hay algo que preservar.

**No bloqueante para seguir trabajando en otras partes**, pero si se va a ejecutar la separación en servicios (sección siguiente) tiene sentido hacer la migración a Postgres primero — evita construir el mecanismo de volumen compartido de SQLite para después descartarlo.

## Stack — resto de decisiones, sin cambios

Fijadas en `initial_plan_prompt.md` y `README.md`:

- **Framework:** Next.js 16, App Router, TypeScript. `app/route.ts` como entrypoint del protocolo, `runtime: nodejs`, `dynamic: force-dynamic`.
- **Sin Directus.** El admin (`app/admin/**`) sigue siendo Server Components + Server Actions custom — la migración a Postgres no reintroduce Directus, es exclusivamente el motor de base de datos.

## Estructura del código

- **`server.ts`** — wrapper custom sobre Next.js (`next({dev})` + `http.createServer` propio). Normaliza `POST //` → `POST /` antes de que el router de Next lo vea — necesario porque el firmware del dispositivo habla HTTP/1.0 y no sigue redirects 308. `npm run dev` = `tsx server.ts` (**no usar `next dev` directo** — rompe la comunicación con el dispositivo real). Ver `04-device-protocol-real.md` para el detalle completo del hallazgo.
- **`app/route.ts`** — entrypoint del protocolo (`POST /`), lee el body como bytes crudos (`Buffer.from(await request.arrayBuffer())`, nunca `request.json()`). También expone `GET /` → `"Biometric server OK"` para verificación rápida.
- **`lib/handlers/index.ts`** — dispatcher por `request_code`, logging de tráfico a `raw_traffic`.
- **`lib/handlers/protocol-handlers.ts`** — `handleReceiveCmd`, `handleSendCmdResult`, `handleRealtimeGlog`, `handleRealtimeEnrollData`. Es la capa acoplada a Next (usa `NextRequest`/`NextResponse`).
- **`lib/protocol.ts`** — parser/builder puro del protocolo: `parseBody`, `buildResponse`, decodificadores de binarios (`decodeUserIdList`, `decodeLogData`, etc). Sin imports de Next.js — portable tal cual. Ver `04-device-protocol-real.md` para el formato de framing que implementa.
- **`lib/db.ts`** — conexión SQLite singleton, migración automática al arrancar. Sin imports de Next.js.
- **`app/admin/**`** — dashboard: `/admin`(estado de dispositivos),`/admin/commands`(cola, encolar comandos),`/admin/logs`(marcaciones),`/admin/traffic` (visor de tráfico crudo — modo "espía").
- **`scripts/simulator.ts`**, **`scripts/e2e.ts`**, **`scripts/sniffer.ts`**, **`scripts/handshake-probe.ts`** — herramientas de desarrollo/diagnóstico. Ver `04-device-protocol-real.md` para cuándo usar el sniffer y el handshake-probe.

**Dato clave para cualquier refactor:** la lógica de negocio (`lib/protocol.ts`, `lib/operations/*` — `advance.ts`, `index.ts`, `kinds.ts`, `persist.ts`, `queue.ts` —, `lib/db.ts`) es agnóstica de framework. Solo `app/route.ts` y las llamadas a `NextRequest`/`NextResponse` dentro de `protocol-handlers.ts` están acopladas a Next. Esto hace que extraer un proceso standalone (siguiente sección) sea mecánico, no un rediseño.

## Plan de separación en servicios (pendiente de ejecutar)

Diseño de infraestructura objetivo (ver `06-infrastructure.md`): dos servicios separados en Coolify, no un monolito.

| Servicio           | Función                                               | Exposición                                                      |
| ------------------ | ----------------------------------------------------- | --------------------------------------------------------------- |
| `dashboard-alco`   | Dashboard admin (`app/admin/**`)                      | 80/443 vía Traefik, dominio propio                              |
| `sync-worker-alco` | Endpoint de dispositivos (`app/route.ts` y su lógica) | Puerto dedicado, bypass de Traefik (ver `03-device-network.md`) |

### Por qué separar

Un solo proceso atendiendo tanto el dashboard como las conexiones de dispositivos es un single point of failure: si el proceso cae por cualquier motivo del lado del dashboard, se cae también la ingesta de todos los dispositivos, no solo la UI. A mayor volumen de dispositivos desplegados, mayor el impacto de una caída. Separar aísla ese riesgo, y es más barato hacerlo con el código actual (relativamente simple) que después de que crezca.

### Pasos de extracción

1. Entrypoint nuevo, `sync-worker.ts` — proceso `tsx`/Node plano, **no Next.js**, con su propio `http.createServer`.
2. Portar la normalización `POST //` desde `server.ts` — es del firmware, no de Next, aplica igual aquí.
3. Reemplazar `NextRequest`/`NextResponse` en `protocol-handlers.ts` por `req`/`res` nativos — mecánico, dado que `buildResponse` ya devuelve objetos planos.
4. Importar `lib/db.ts` y el resto de la lógica de negocio tal cual desde el nuevo entrypoint.
5. En Coolify: desplegar `sync-worker-alco` como app nueva del mismo repo, start command `tsx sync-worker.ts`, puerto propio vía la variable `PORT` ya existente en el proyecto.

### Requisito que la separación introduce

Con dos procesos abriendo conexiones separadas al mismo archivo SQLite:

- **`PRAGMA journal_mode=WAL`** debe activarse en `lib/db.ts`. **Verificado (2026-08-29): todavía NO está** — `openAndMigrate()` abre el `sqlite3.Database` y llama a `migrate()` sin ejecutar ningún `PRAGMA journal_mode` (el único `PRAGMA` en el archivo es `table_info` dentro de la migración). Sin WAL, el modo default usa locks exclusivos que generan `SQLITE_BUSY` bajo escritura concurrente. Bloqueante antes de separar procesos — aunque si se ejecuta primero la migración a Postgres (sección arriba), este punto deja de aplicar.
- **Volumen compartido en Coolify:** por defecto cada app tiene su propio filesystem aislado — si `dashboard-alco` y `sync-worker-alco` corren como contenedores separados escribiendo a una ruta relativa local, cada uno tendría su propia copia del `.db`, no el mismo archivo. Necesario: crear un **Persistent Storage** en Coolify, montarlo en la misma ruta en ambos contenedores, y que `lib/db.ts` lea la ruta desde una variable de entorno (ej. `DB_PATH`) en vez de un path relativo hardcodeado. Verificar después del despliegue que ambos contenedores efectivamente comparten el archivo (no asumirlo solo porque ambos "funcionan" por separado).

## ⚠️ Pendiente: migración de huellas entre dispositivos

**Confirmado por Grupo ALCO como posible, no logrado todavía por el equipo de desarrollo.** El cliente indicó que la migración de datos biométricos (huellas) de un dispositivo a otro es una operación que debe soportarse — por ejemplo, cuando un empleado cambia de sede o se reemplaza un equipo físico — pero **hasta ahora no se ha conseguido hacer funcionar**, pese a que el catálogo de comandos (`05-commands-catalog.md`) ya expone en teoría lo necesario:

- `GET_ENROLL_DATA` (`user_id`, `backup_number`) — trae el template biométrico crudo de un dispositivo origen.
- `SET_ENROLL_DATA` (`user_id`, `backup_number`, `enroll_data`) — debería cargar ese mismo template binario en un dispositivo destino.

**No asumir que esto es tan simple como "leer de uno y escribir en el otro".** El catálogo de comandos (`05-commands-catalog.md`) ya documenta varias inconsistencias del firmware en comandos relacionados a usuarios (`SET_USER_INFO` dispara un reindexado destructivo no documentado; `cmd_return_code` no es confiable en varios comandos de escritura) — es razonable sospechar que `SET_ENROLL_DATA` tenga un comportamiento igual de sorprendente que todavía no se ha caracterizado, dado que nunca se llegó a validar de punta a punta. Antes de intentar de nuevo:

1. Confirmar con Grupo ALCO qué entienden ellos exactamente por "migración de huellas" — ¿mismo `user_id` en ambos equipos, o hay que resolver también el mapeo de identidad entre dispositivos distintos?
2. Probar el flujo `GET_ENROLL_DATA` → `SET_ENROLL_DATA` contra dos dispositivos reales, con el mismo rigor de verificación que ya se aplicó a otros comandos en `05-commands-catalog.md` (no confiar en `cmd_return_code: OK` sin verificar después con un `GET_ENROLL_DATA` de confirmación en el equipo destino).
3. Documentar el resultado (funcione o no) en `05-commands-catalog.md`, siguiendo el mismo formato de advertencias verificadas que ya usa ese documento.

Este ítem no está en el catálogo de comandos como "pendiente" todavía — falta agregarlo ahí una vez se investigue, ya que ese documento es la fuente de verdad de comportamiento verificado contra hardware.

## Preparación para escala futura (no sobre-construir en Fase 1)

- Cola de comandos (`commands` table) ya persiste en base de datos, no en memoria — correcto por diseño.
- Si se separa en `sync-worker`, aislar la lógica de protocolo detrás de una interfaz clara permite, en el futuro, shardear esa responsabilidad entre múltiples instancias sin tocar el resto del sistema.
- No asumir en el código "un solo proceso, una sola IP" como supuesto permanente, aunque en Fase 1 sea así en la práctica.

**Explícitamente diferido a una fase posterior:** múltiples instancias de `sync-worker` coordinadas, pooling de conexiones, load balancer con passthrough TCP, migración de motor de base de datos. Ver `06-infrastructure.md` para el razonamiento de por qué esto es compatible con la restricción de IP fija en los dispositivos cuando llegue el momento.
