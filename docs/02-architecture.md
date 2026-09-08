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

## ✅ Migración de huellas entre dispositivos — RESUELTO (2026-09-07)

**Funciona, verificado físicamente contra dos equipos reales.** El dedo de un
empleado fue reconocido por el equipo destino contra un template que nunca se
enroló ahí, generando marcaciones reales.

**La receta:** `GET_USER_INFO` (origen, blob de **612 bytes**) → patchar el
`user_id` embebido en el offset 608 → escribir en el destino. **Lo decisivo es
la lectura, no la escritura**: con la forma limpia de 612 bytes funcionan los
dos comandos de escritura, ambos verificados físicamente:

| Comando | Caso de uso | Riesgo |
| --- | --- | --- |
| `SET_ENROLL_DATA` | **Agregar** una huella a un empleado que ya existe en el destino | Ninguno — quirúrgico, no toca el resto de la ficha |
| `SET_USER_INFO` | **Crear** el empleado en el destino junto con su huella | Sobre un usuario existente dispara el reindexado destructivo — usar solo para altas |

**Lo que fallaba antes:** usar `GET_ENROLL_DATA` → `SET_ENROLL_DATA` con el blob
de **524 bytes**. Esa forma está contaminada — a partir del byte 60 trae memoria
sin inicializar del equipo origen (punteros de heap), y el registro resultante en
el destino queda incompleto (rango 283..486 en ceros). Se probó tres veces contra
hardware y el dedo nunca fue reconocido.

**Detalle completo, con el mapa de la estructura de 612 bytes decodificada
(nombre en ASCII, user_id, índice de slot, campos que el firmware regenera solo):
`05-commands-catalog.md` → "Migración de huellas entre dispositivos".**

**Implementado en el panel (2026-09-07)**, resolviendo el mapeo de identidad vía
el modelo de dominio ya firmado (`08-data-model.md`) en vez de pedir el
`user_id` destino a mano:

- `employee_fingerprint` — copia canónica de la huella por **empleado** (no por
  dispositivo). Operación `CAPTURE_FINGERPRINT`: lee con `GET_USER_INFO` desde
  un equipo donde la persona ya tiene un `employee_device_enrollment` activo, y
  guarda **todos** los slots de huella que el equipo reporte, tal cual — nunca
  pide elegir un número de dedo. El slot (`backup_number`) es orden de
  registro del equipo, no identidad de dedo (verificado 2026-09-08: un índice
  derecho quedó en el mismo slot 0 que antes se documentaba como "pulgar
  derecho" — ver `05-commands-catalog.md` → `GET_USER_INFO`).
- Operación `PUSH_FINGERPRINT`: dado un empleado + dedo + equipo destino, busca
  su `employee_device_enrollment` **activo** en ese destino (falla con un
  mensaje claro si no existe uno — no intenta crear el usuario ahí), toma su
  `device_user_id`, patcha el offset 608 del blob guardado, y escribe con
  `SET_ENROLL_DATA`. Verifica el resultado con un `GET_USER_INFO` posterior
  (igual que `DELETE_USER`: el `cmd_return_code` de esta escritura tampoco es
  confiable).
- UI: sección "Huellas" en la ficha de empleado (`/admin/empleados/[id]`) —
  "Capturar huella" por enrolamiento activo, "Copiar a otro equipo" por huella
  capturada, con la lista de equipos destino acotada a los enrolamientos
  activos de esa persona.
- Tests: `__tests__/operations.test.ts` (captura, huella no encontrada,
  destino sin enrolamiento, parche del `user_id` embebido, verify-mismatch).

**`ADD_EMPLOYEE_TO_DEVICE` (2026-09-07)** cierra ese hueco: alta de un empleado
en un equipo donde todavía no existe, en un solo paso desde su ficha, con la
regla de negocio explícita del cliente — **nunca automático**: vincular a una
empresa no agrega sola a ningún equipo, cada equipo se elige a mano (o varios a
la vez, selección múltiple).

- `lib/lookups.ts` → `loadDeviceCandidatesForEmployee(employeeId)`: equipos de
  la empresa del empleo activo de la persona. Excluye equipos donde ya hay un
  enrolamiento activo. (Hasta el 2026-09-08 esto ampliaba a padre+hermanas si
  la empresa tenía `shared_employees` — se revirtió junto con toda la
  jerarquía de empresas, ver `08-data-model.md` → "Enmienda 2026-09-08"; en la
  práctica ningún cliente real necesitaba varias razones sociales compartiendo
  empleados, y `site` ya cubre el caso real de varias ubicaciones.)
- Asignación de `device_user_id`: `MAX(user_id::int)+1` entre los usuarios
  numéricos ya sincronizados localmente de ese equipo como candidato inicial
  (barato, evita ID fijo repetido entre equipos), con la sonda real
  (`GET_USER_INFO`, igual que `CREATE_USER`) como única confirmación de que
  está libre — reintenta con el siguiente entero hasta
  `MAX_ID_ASSIGNMENT_ATTEMPTS` (5) veces ante colisión.
- Esa sonda explota el mismo hallazgo de hardware real que `DELETE_USER`
  (`05-commands-catalog.md` → `GET_USER_INFO`): un ID que existe responde en
  segundos, uno libre nunca responde. El panel espera `PROBE_TIMEOUT_MS` (30s,
  `lib/operations/advance.ts`) una vez entregado el comando antes de dar el
  candidato por libre y seguir — corregido el 2026-09-08 tras una prueba en
  vivo que reveló que el sondeo se quedaba esperando el timeout genérico de 3
  minutos y terminaba en error incluso cuando el ID sí estaba libre.
- Una vez creado y vinculado (`employee_device_enrollment`), si la persona ya
  tiene huellas en `employee_fingerprint`, se copian todas de una sola vez con
  la misma receta de `PUSH_FINGERPRINT` (parche del offset 608 + verify
  posterior) — sin pasos manuales extra. Un fallo en una huella individual no
  aborta las demás (mismo criterio que `SYNC_USERS`).
- El privilegio pedido se aplica **al final**, después de copiar huellas, no
  al crear. Hallazgo de hardware real (2026-09-08,
  `05-commands-catalog.md` → `SET_USER_PRIVILEGE`): un privilegio elevado
  (`MANAGER`) no se aplica — ni al crear con `SET_USER_INFO` ni con un
  `SET_USER_PRIVILEGE` posterior — mientras el usuario no tenga ninguna
  huella registrada; el equipo responde `OK` pero lo deja en `USER`. Si no
  hay huella para copiar en esa operación, termina en `mismatch` con el
  motivo explícito en vez de reportar éxito falso.
- UI: botón "+ Agregar a equipo" en la ficha de empleado, selección múltiple de
  equipos candidatos, una operación por equipo elegido.
- Tests: `__tests__/operations.test.ts` — id ya vinculado, reintento por
  colisión, agotamiento de intentos, copia multi-huella con tolerancia a fallo
  parcial.

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
