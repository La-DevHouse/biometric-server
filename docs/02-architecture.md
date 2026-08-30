# Arquitectura de software

## ⚠️ Pendiente: diseño de UX y modelo de datos para Hitos 3–5

**Sin empezar.** Los Hitos 3 (administración de empresas/empleados), 4 (horarios/turnos/asistencia) y 5 (reportes/exportación) — ver `01-requirements.md` — no tienen todavía ninguna especificación de vistas, acciones de usuario, ni modelo de datos más allá de lo que ya existe para el protocolo de dispositivos (`devices`, `commands`, `attendance_logs`, `users`, `enroll_data`).

El método de descubrimiento en curso: relevar el sistema legacy **Adempiere** que Grupo ALCO usa hoy para biométricos (el que esta Fase 1 reemplaza) — catalogar sus vistas y acciones disponibles como referencia de UX/dominio para especificar cómo debe verse y comportarse el sistema nuevo. **Adempiere es solo referencia — el sistema nuevo no integra con él ni depende de él en ningún sentido técnico.**

Cuando ese relevamiento produzca una especificación concreta (vistas, relaciones entre entidades, tablas), documentarla en un archivo nuevo `docs/07-admin-ux-spec.md` (número reservado) — no fusionarla dentro de este documento, para no mezclar "cómo está construido el protocolo" con "cómo debe ser la experiencia de administración".

## Migración de SQLite a Postgres — HECHA en código (2026-08-30)

El código ya corre sobre **PostgreSQL con Prisma**. Falta solo crear el servicio
`postgres-alco` en Coolify y desplegar (ver `06-infrastructure.md`).

**Qué se hizo:**

- **Schema:** `prisma/schema.prisma` con las 8 tablas de protocolo (`devices`,
  `commands`, `attendance_logs`, `users`, `enroll_data`, `block_buffer`,
  `raw_traffic`, `operations`). `BLOB` → `bytea`. Migraciones versionadas en
  `prisma/migrations/` (`prisma migrate`), reemplazan al `addColumnIfMissing`
  ad-hoc de antes. Los modelos de dominio (`08-data-model.md`) llegan en una
  migración posterior.
- **`lib/db.ts` reescrito:** un `pg.Pool` compartido + `PrismaPg` sobre ese pool
  (adapter `@prisma/adapter-pg`, sin binario de query-engine). Se **conservan**
  los 4 helpers (`runAsync`/`getAsync`/`allAsync`/`execAsync`) como shim delgado
  sobre `pool.query` — el hot path (`lib/handlers/**`, `lib/operations/**`)
  mantiene su SQL crudo, no se reescribió a modelos Prisma. `initDb()` ahora solo
  chequea conectividad; migrar es tarea de `prisma migrate deploy`.
- **Sin ORM en el hot path**; Prisma (cliente `prisma` exportado desde `lib/db.ts`)
  queda listo para las tablas de dominio nuevas y el CRUD del admin.
- **Timestamps** de protocolo siguen en epoch-millis, ahora `bigint`. `lib/db.ts`
  registra `pg.types.setTypeParser(20, Number)` — **load-bearing**: sin eso los
  `*_at` y los `COUNT(*)` vuelven como string y la aritmética `Date.now() - x`
  da `NaN`.
- **Sin foreign keys** en el baseline (los handlers realtime insertan sin
  garantizar que exista antes la fila de `devices` — igual que hoy con SQLite,
  que no las aplicaba). Las FKs protocolo↔dominio se agregan con las tablas de
  dominio.
- **`DATABASE_URL`** como variable de conexión. `docker-compose.yml` levanta un
  Postgres local para desarrollo y tests (puerto host `55432`). Los tests corren
  contra una base `biometric_test` separada (`scripts/test-db-setup.ts`, `pretest`).
- **Arranque limpio** — no se migraron datos del servidor de test.

**Detalle completo:** `08-data-model.md`, `prisma/README.md`, y el plan de Fase 2.

**Por qué Postgres** (contexto que sigue vigente): resuelve de raíz el problema
de "volumen compartido" que generaría la separación `dashboard-alco`/
`sync-worker-alco` — con Postgres ambos procesos son clientes de red al mismo
servicio, sin archivo compartido ni `PRAGMA journal_mode=WAL`.

**Pendiente (infra, no código):** crear `postgres-alco` en Coolify con su
Persistent Storage, setear `DATABASE_URL` al hostname interno de Docker, y que
`prisma migrate deploy` corra al arrancar el contenedor. Ver `06-infrastructure.md`.

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
- **`lib/db.ts`** — `pg.Pool` singleton + cliente `prisma` (adapter `@prisma/adapter-pg`) sobre el mismo pool; los 4 helpers crudos (`runAsync`/`getAsync`/`allAsync`/`execAsync`) + `NOW_MS` + `toPg`. `initDb()` chequea conectividad, no migra (eso es `prisma migrate`). Sin imports de Next.js.
- **`app/admin/**`** — dashboard: `/admin`(estado de dispositivos),`/admin/commands`(cola, encolar comandos),`/admin/logs`(marcaciones),`/admin/traffic` (visor de tráfico crudo — modo "espía").
- **`scripts/simulator.ts`**, **`scripts/e2e.ts`**, **`scripts/sniffer.ts`**, **`scripts/handshake-probe.ts`** — herramientas de desarrollo/diagnóstico. Ver `04-device-protocol-real.md` para cuándo usar el sniffer y el handshake-probe.

**Dato clave para cualquier refactor:** la lógica de negocio (`lib/protocol.ts`, `lib/operations/*` si existen, `lib/db.ts`) es agnóstica de framework. Solo `app/route.ts` y las llamadas a `NextRequest`/`NextResponse` dentro de `protocol-handlers.ts` están acopladas a Next. Esto hace que extraer un proceso standalone (siguiente sección) sea mecánico, no un rediseño.

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

- **`PRAGMA journal_mode=WAL`** debe activarse en `lib/db.ts` (verificar si ya está — no confirmado en la revisión actual). Sin WAL, el modo default usa locks exclusivos que generan `SQLITE_BUSY` bajo escritura concurrente. Bloqueante antes de separar procesos.
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

## Decisiones de modelo de datos que surgen del relevamiento de Adempiere (en curso)

Estas decisiones se van tomando conforme avanza el kit de relevamiento (`adempiere-kit/`, ver `docs/00-index.md` → `07-admin-ux-spec.md` cuando esté escrito). Se registran aquí porque afectan directamente el esquema, no solo la UX.

- **Identificación de empleado: cédula, no ID numérico de nómina separado.** Adempiere maneja dos identificadores en paralelo para el mismo empleado (`Empleado Nómina`, numérico interno; y cédula, vía el registro de "Socio de Negocio"). El sistema nuevo estandariza en **cédula** como identificador único del empleado — no se replica el ID numérico de nómina como concepto separado. (Fuente: `adempiere-kit/views/importar-registro-asistencia.md`, decisión del 29/ago.)
- **Importación batch de marcajes: no es parte de la operación normal del sistema nuevo.** Adempiere tiene un mecanismo de importación manual/batch de asistencia (con una tabla de staging de 157,674 registros, la mayoría fallando validación). Hipótesis fuerte, pendiente de confirmación con ALCO: no se usa activamente, porque con el sistema nuevo conectado en vivo a los dispositivos no hace falta — el único caso donde este tipo de mecanismo importaría es una migración de histórico, que está fuera del alcance de Fase 1 (`01-requirements.md`). No diseñar esto como parte del flujo normal.
- **Categorización de empleado — matizado con datos reales (29/ago).** La rama "Configuración del Empleado" de Adempiere **no está uniformemente vacía**, como se asumió inicialmente:
    - **Con uso real, modelar como entidades propias:** `Departamento` (45 registros), `Puesto` (288 registros, relacionado a `Departamento`), `Nivel de Estudio` (6 registros), `Grado` (24 registros — probablemente específico de empresas cliente tipo institución educativa, ver `views/organizacion.md`).
    - **Sin registros reales cargados (footer `+*1/1` = formulario vacío por defecto, sin datos existentes):** `Estructura Salarial`, `Designación`, `Tipo de Habilidad`, `Tipo de Empleado`, `Carrera`. Para estos, incluir como mucho un campo de referencia simple y opcional en el esquema — no construir UI de gestión dedicada a menos que ALCO confirme que sí los usan y que Adempiere simplemente no tenía datos cargados en el momento del relevamiento.
    - **Sigue aplicando la distinción de alcance:** ninguno de estos implica construir lógica de cálculo de nómina — son campos de clasificación, no motor de nómina.

## Idea de diseño a evaluar (Hito 3/4, no comprometida): privilegios remotos por dispositivo

Grupo ALCO necesita que alguien en cada sede/empresa pueda enrolar huellas nuevas localmente, sin que esa persona tenga acceso a la plataforma web (confirmado explícitamente: solo los 4 usuarios de ALCO tienen acceso — ver `01-requirements.md`). Esta capacidad ya existe a nivel de firmware del dispositivo (privilegios `MANAGER`/`REGISTER`/`OPERATOR`/`USER`, comando `SET_USER_PRIVILEGE` — ver `05-commands-catalog.md`), independiente de la plataforma.

Idea a evaluar: exponer en el dashboard, para los 4 usuarios de ALCO, la capacidad de otorgar/revocar remotamente ese privilegio local a un empleado ya enrolado en un dispositivo específico — sin crear cuentas ni dar acceso a la plataforma a nadie fuera de ALCO. Antes de comprometerse a esto: `05-commands-catalog.md` documenta que solo `MANAGER` está verificado funcionando de forma confiable en el firmware probado; `REGISTER` (el nivel "angosto" ideal para este caso) no aplicó correctamente en las pruebas — validar esto contra hardware real antes de prometerle a ALCO una distinción fina de permisos que puede no sostenerse en la práctica.

Detalle completo del hallazgo en `views/organizacion.md` (kit de relevamiento de Adempiere), sección "Administrador/Super Usuario (Dispositivo de Asistencia)".

## Preparación para escala futura (no sobre-construir en Fase 1)

- Cola de comandos (`commands` table) ya persiste en base de datos, no en memoria — correcto por diseño.
- Si se separa en `sync-worker`, aislar la lógica de protocolo detrás de una interfaz clara permite, en el futuro, shardear esa responsabilidad entre múltiples instancias sin tocar el resto del sistema.
- No asumir en el código "un solo proceso, una sola IP" como supuesto permanente, aunque en Fase 1 sea así en la práctica.

**Explícitamente diferido a una fase posterior:** múltiples instancias de `sync-worker` coordinadas, pooling de conexiones, load balancer con passthrough TCP, migración de motor de base de datos. Ver `06-infrastructure.md` para el razonamiento de por qué esto es compatible con la restricción de IP fija en los dispositivos cuando llegue el momento.
