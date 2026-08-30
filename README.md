# Servidor Biométrico de Asistencia - Documentación Completa

## 📋 Resumen Ejecutivo

Este es un servidor Next.js 16 que implementa un **protocolo HTTP de bajo nivel para comunicación con dispositivos biométricos de asistencia**. Los dispositivos actúan como **clientes HTTP**: hacen POST a intervalos regulares sin que el servidor inicie conexiones hacia ellos. El protocolo es agnóstico de transporte y usa headers HTTP personalizados para metadatos.

**Stack tecnológico:**
- **Framework:** Next.js 16 (App Router, TypeScript)
- **Base de datos:** PostgreSQL con Prisma (`@prisma/adapter-pg`; el hot path del protocolo usa SQL crudo, no modelos Prisma). Ver `docs/02-architecture.md` y `prisma/README.md`.
- **Servidor:** Node.js (runtime: nodejs)
- **UI:** React + Tailwind CSS
- **Testing:** node:test + scripts TypeScript

**Funcionalidades completadas:**
- ✅ Protocolo HTTP push con fragmentación de bloques
- ✅ Simulador de dispositivo para testing sin hardware
- ✅ Panel admin para gestión de comandos y visualización de logs
- ✅ Logging completo de tráfico (modo "espía")
- ✅ Suite E2E con 15 tests (todos pasan)

---

## 🏗️ Arquitectura del Sistema

### Flujo de comunicación

```
┌─────────────────┐                    ┌──────────────────┐
│  Dispositivo    │                    │  Servidor Next.js│
│  Biométrico     │                    │                  │
│  (Cliente HTTP) │                    │  ┌────────────┐  │
│                 │                    │  │ app/route  │  │
│   Poll cada 5s  │                    │  │   .ts      │  │
│      ↓          │                    │  └────────────┘  │
│  receive_cmd    │───POST────────────→│  Handlers:       │
│  (¿hay cmds?)   │    /               │  ├─receive_cmd   │
│                 │←─OK, cmd_code──────│  ├─send_cmd_...  │
│                 │    cmd_params      │  ├─realtime_glog │
│  Ejecuta cmd    │                    │  └─realtime_...  │
│      ↓          │                    │                  │
│  send_cmd_      │───POST────────────→│  ┌────────────┐  │
│  result         │    /               │  │ block_     │  │
│  (fragmentado   │                    │  │ buffer     │  │
│   si >8KB)      │←─OK, trans_id──────│  │ (frag)     │  │
│                 │                    │  └────────────┘  │
│ realtime_glog   │───POST────────────→│  ┌────────────┐  │
│ (asistencia)    │    /               │  │ attendance │  │
│                 │←─OK────────────────│  │ _logs      │  │
│                 │                    │  └────────────┘  │
└─────────────────┘                    └──────────────────┘
                                             ↓
                                        ┌──────────────┐
                                        │ PostgreSQL   │
                                        │ ┌──────────┐ │
                                        │ │ devices  │ │
                                        │ │ commands │ │
                                        │ │ logs     │ │
                                        │ │ users    │ │
                                        │ └──────────┘ │
                                        └──────────────┘
```

### Componentes principales

| Componente | Ubicación | Responsabilidad |
|-----------|-----------|-----------------|
| Route Handler | `app/route.ts` | Punto de entrada HTTP, lectura de body como bytes crudos |
| Dispatcher | `lib/handlers/index.ts` | Despacho por `request_code`, logging de tráfico |
| Protocol Handlers | `lib/handlers/protocol-handlers.ts` | Lógica de 4 tipos de request (receive_cmd, send_cmd_result, realtime_glog, realtime_enroll_data) |
| Protocol Parser | `lib/protocol.ts` | Parseo de JSON + binarios, construcción de respuestas |
| Database | `lib/db.ts` | `pg.Pool` singleton + cliente Prisma sobre el mismo pool; 4 helpers async (`runAsync`/`getAsync`/`allAsync`/`execAsync`), `NOW_MS`, `toPg` |
| Admin UI | `app/admin/**` | Dashboard, commandos, logs, traffic viewer (SSR, revalidación 3s) |
| Simulator | `scripts/simulator.ts` | Cliente HTTP que simula dispositivo real |
| E2E Tests | `scripts/e2e.ts` | Validación end-to-end de flujos completos |

---

## 📊 Estructura de Base de Datos

```sql
-- Dispositivos conectados
devices (dev_id TEXT PK, fk_name, firmware, fk_bin_data_lib, 
         supported_enroll_data JSON, last_seen_at, created_at)

-- Cola de comandos (WAIT → RUN → RESULT)
commands (trans_id INTEGER PK, dev_id FK, cmd_code, cmd_param TEXT,
          cmd_binary BLOB, status ENUM, result_json TEXT, result_binary BLOB,
          cmd_return_code, created_at, updated_at)

-- Buffer de fragmentación (para resultados >8KB)
block_buffer (dev_id, trans_id, blk_no, data BLOB, received_at)
  PRIMARY KEY (dev_id, trans_id, blk_no)

-- Marcaciones de asistencia en tiempo real
attendance_logs (id, dev_id, user_id, verify_mode, io_mode, io_time, 
                 log_image BLOB, received_at)

-- Usuarios biométricos
users (id, dev_id, user_id, user_name, user_privilege, user_photo BLOB,
       updated_at, UNIQUE(dev_id, user_id))

-- Datos de enrollamiento (fingerprints, etc)
enroll_data (id, dev_id, user_id, backup_number, data BLOB, updated_at,
             UNIQUE(dev_id, user_id, backup_number))

-- Tráfico bruto (auditoria/debugging)
raw_traffic (id, direction IN/OUT, dev_id, request_code, headers_json,
             body_preview TEXT, body_size, binary_size, created_at)
             ORDER BY created_at DESC
```

---

## 🔌 Protocolo HTTP Push

### Headers del protocolo

| Header | Origen | Significado |
|--------|--------|-------------|
| `dev_id` | Dispositivo | Identificador único del dispositivo (máx 24 chars) |
| `request_code` | Dispositivo | Tipo de petición (receive_cmd, send_cmd_result, realtime_glog, realtime_enroll_data) |
| `trans_id` | Servidor | ID de transacción del comando (máx 16 chars) |
| `cmd_code` | Servidor | Código del comando a ejecutar |
| `blk_no` | Dispositivo | Número de bloque en fragmentación (0 = último/único) |
| `cmd_return_code` | Dispositivo | "OK" o string de error |
| `Content-Type` | Ambos | Siempre `application/octet-stream` |
| `Content-Length` | Ambos | Tamaño del body en bytes |

### Body del protocolo

**Formato real:** secuencia de bloques con prefijo de longitud (`uint32` little-endian), verificado contra hardware real. El bloque 0 es el JSON UTF-8 terminado en NUL; los bloques siguientes son los binarios (`BIN_1`, `BIN_2`…) que el JSON referencia. Las respuestas del servidor usan el mismo framing (`buildResponse` en `lib/protocol.ts` lo arma, agregando los headers `blk_no: 0` y `blk_len`).

`parseBody` en `lib/protocol.ts` acepta además la forma plana (JSON crudo sin framing) para simulador/e2e/curl, detectándola por el `{` inicial.

Detalle completo del formato, con dumps de bytes verificados: **`docs/04-device-protocol-real.md`** → "Formato real del body".

**Ejemplo (framed):**
```
41 00 00 00                              ← uint32 LE = 65 (longitud del bloque 0)
{"user_id_count":3,"one_user_id_size":8,"user_id_array":"BIN_1"}00   ← JSON + NUL
18 00 00 00                              ← uint32 LE = 24 (longitud del bloque 1)
<24 bytes binarios>                      ← BIN_1
```

### Tipos de petición del dispositivo

#### 1. `receive_cmd` (polling de comandos)

**Dispositivo → Servidor:**
```json
{
  "fk_name": "FK725HS001",
  "fk_time": "YYMMDDhhmmss",
  "fk_info": {
    "supported_enroll_data": ["FP", "PASSWORD"],
    "fk_bin_data_lib": "FKDataHS001",
    "firmware": "v2.0"
  }
}
```

**Servidor → Dispositivo (CON comando):**
```http
response_code: OK
trans_id: 42
cmd_code: SET_TIME
Content-Length: 27
Body: {"time":"20260729143000"}
```

**Servidor → Dispositivo (SIN comando):**
```http
response_code: OK
Content-Length: 0
```

#### 2. `send_cmd_result` (reporte de resultado)

**Dispositivo → Servidor (fragmentado):**
```http
trans_id: 42
cmd_return_code: OK
blk_no: 1
Content-Length: 8192
Body: <8192 bytes de datos>
```

**Luego (bloque final):**
```http
trans_id: 42
cmd_return_code: OK
blk_no: 0
Content-Length: 5000
Body: <5000 bytes finales>
```

El servidor ensambla en `block_buffer` y cuando `blk_no=0`, concatena todos los bloques.

#### 3. `realtime_glog` (asistencia en tiempo real)

**Dispositivo → Servidor:**
```json
{
  "user_id": "U001",
  "verify_mode": "FP",
  "io_mode": 1,
  "io_time": "20260729143045",
  "log_image": "BIN_1"
}
<imagen binaria opcional>
```

#### 4. `realtime_enroll_data` (nuevo usuario registrado)

**Dispositivo → Servidor:**
```json
{
  "user_id": "U002",
  "user_name": "John Doe",
  "user_privilege": "USER",
  "user_photo": "BIN_1",
  "enroll_data_array": [
    {"backup_number": 0},
    {"backup_number": 1}
  ]
}
<foto binaria><datos_enroll_0><datos_enroll_1>
```

---

## 🎯 Catálogo de Comandos

El servidor puede encolar estos comandos para que el dispositivo los ejecute:

| Comando | Parámetros | Respuesta | Notas |
|---------|-----------|----------|-------|
| `GET_DEVICE_STATUS` | — | JSON con counts | Estado actual del dispositivo |
| `SET_TIME` | `time: YYYYMMDDhhmmss` | `{"status":"ok"}` | Sincroniza reloj |
| `GET_USER_ID_LIST` | — | JSON array | >25KB → fragmentado |
| `GET_LOG_DATA` | `begin_time`, `end_time` (vacíos=todos) | JSON array | >25KB → fragmentado |
| `DELETE_USER` | `user_id` | `{"status":"ok"}` | Elimina usuario |
| `SET_USER_NAME` | `user_id`, `user_name` | `{"status":"ok"}` | Renombra usuario |
| `SET_USER_PRIVILEGE` | `user_id`, `user_privilege` | `{"status":"ok"}` | MANAGER\|REGISTER\|OPERATOR\|USER |
| `GET_USER_INFO` | `user_id` | JSON + foto binaria | Datos del usuario |
| `SET_USER_INFO` | JSON completo + foto/enrollments | `{"status":"ok"}` | Upsert usuario completo |
| `SET_ENROLL_DATA` | `user_id`, `backup_number`, datos binarios | `{"status":"ok"}` | Cargar fingerprint/etc |
| `GET_ENROLL_DATA` | `user_id`, `backup_number` | JSON + binario | Descargar fingerprint |
| `CLEAR_LOG_DATA` | — | `{"status":"ok"}` | Limpia logs |
| `CLEAR_ENROLL_DATA` | — | `{"status":"ok"}` | Limpia enrollments |
| `SET_FK_NAME` | `fk_name` | `{"status":"ok"}` | Renombra dispositivo |

---

## 🚀 Cómo ejecutar

### 1. Instalación

```bash
npm install
cp .env.example .env
docker compose up -d db          # Postgres local (puerto 55432)
npm run db:migrate:deploy        # aplica prisma/migrations
```

### 2. Iniciar servidor de desarrollo

```bash
npm run dev
```

- Servidor en `http://localhost:3000`
- GET `/`: devuelve "Biometric server OK"
- POST `/`: maneja peticiones de dispositivos
- UI admin: `http://localhost:3000/admin`

### 3. Ejecutar simulador (en otra terminal)

```bash
npm run simulator
```

Simula un dispositivo real:
- Hace polling cada 5 segundos
- Ejecuta comandos cuando llegan
- Envía fragmentación >8KB
- Comandos interactivos:
  - **m**: envía `realtime_glog` (marcación de asistencia)
  - **e**: envía `realtime_enroll_data` (nuevo usuario)
  - **q**: salir

### 4. Ejecutar tests E2E

```bash
npm run e2e
```

Verifica end-to-end:
- Registración de dispositivo
- Ejecución de comandos (SET_TIME)
- Fragmentación de resultados grandes
- Logs de asistencia en tiempo real
- Enrollamiento de usuarios

### 5. Tests unitarios

```bash
npm run test
```

15 tests del parser de protocolo (JSON+binarios, fechas, etc).

---

## 🎛️ Panel Admin

Accede a `http://localhost:3000/admin` (se revalida automáticamente cada 3 segundos).

### Dashboard (`/admin`)
- **Estadísticas:** total de dispositivos, pendientes, logs procesados
- **Tabla de dispositivos:** dev_id, nombre, firmware, estado online/offline (last_seen <30s), último contacto
- **Indicadores:** contador de comandos pendientes vs. completados

### Comandos (`/admin/commands`)
- **Formulario:** selecciona dispositivo, tipo de comando, parámetros JSON
- **Cola:** tabla con trans_id, dev_id, comando, estado (WAIT/RUN/RESULT/ERROR), código retorno
- **Estados:**
  - 🟡 WAIT: pendiente de entrega
  - 🔵 RUN: enviado al dispositivo
  - 🟢 RESULT: completado exitosamente
  - 🔴 ERROR: falló

### Logs (`/admin/logs`)
- **Filtros:** dispositivo, fecha desde
- **Tabla:** dev_id, user_id, verify_mode (FP/PASSWORD/etc), io_time, imagen (✓ si hay), received_at
- **Últimos 200 logs**

### Traffic (`/admin/traffic`)
- **Visor de tráfico bruto:** peticiones y respuestas HTTP del protocolo
- **Filtrable:** expandible para ver headers y preview del body (primeros 500 chars)
- **Dirección:** ← IN (petición del dispositivo), → OUT (respuesta del servidor)
- **Últimas 200 peticiones/respuestas**

---

## 🧪 Escenarios de Testing

### Escenario 1: Flujo completo de comando

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run simulator

# Terminal 3 - Encolar comando desde admin
# http://localhost:3000/admin/commands
# Device: SIM001
# Command: SET_TIME
# Params: {"time":"20260729143000"}
# → Enviar

# Ver en Logs/Traffic que se ejecutó
```

### Escenario 2: Fragmentación

```bash
# Simulador envía GET_LOG_DATA
# Si >8KB, se envía en 3 fragmentos:
# blk_no: 1 (8KB)
# blk_no: 2 (8KB)  
# blk_no: 0 (resto)
# → Servidor ensambla en block_buffer
# → Resultado final en commands.result_json
```

### Escenario 3: Asistencia en tiempo real

```bash
# En terminal del simulador, presionar "m"
# → realtime_glog se envía
# → Aparece en /admin/logs como nuevo registro
```

### Escenario 4: E2E automatizado

```bash
npm run e2e
# Ejecuta 15 tests de:
# - Registración
# - Comandos
# - Fragmentación
# - Logs
# - Enrollamiento
# Resultado: ✓ ALL TESTS PASSED
```

---

## 🔍 Debugging

### Ver logs en tiempo real

En desarrollo (`npm run dev`), Next.js loguea en consola:
- Errores en handlers
- Cambios de estado de comandos
- Inserciones de logs de asistencia

### Inspeccionar tráfico

Accede a `/admin/traffic` para ver:
- Headers exactos intercambiados
- Body (JSON) completo o fragmentado
- Tamaños de cuerpo y binario

### Inspeccionar base de datos

```bash
# Con el Postgres local del docker-compose (puerto 55432):
PSQL="docker compose exec -T db psql -U biometric -d biometric -c"

$PSQL "SELECT * FROM devices;"
$PSQL "SELECT * FROM commands WHERE status='WAIT';"
$PSQL "SELECT * FROM attendance_logs LIMIT 10;"

# O la GUI de Prisma:
npm run db:studio
```

---

## ⚙️ Variables de entorno

| Variable | Default | Propósito |
|----------|---------|-----------|
| `PORT` | `3000` | Puerto donde escucha el servidor (`npm run dev` / `npm start`) |
| `NO_CMD_STRATEGY` | `ok_empty` | Respuesta cuando no hay comando: `ok_empty` o `error` |
| `DEV_ID` | `SIM001` | ID del dispositivo simulado |
| `POLL_INTERVAL` | `5000` | Millisegundos entre polls (simulador) |
| `SERVER_URL` | `http://localhost:${PORT}` | URL del servidor (simulador, e2e) — sigue a `PORT` automáticamente si no se define |

**Uso:**
```bash
PORT=4000 npm run dev
DEV_ID=CUSTOM001 POLL_INTERVAL=3000 npm run simulator
NO_CMD_STRATEGY=error npm run dev
```

---

## 📋 Notas de implementación

### Limitaciones y trade-offs

1. **Framing de múltiples binarios (BIN_1, BIN_2, ...):** resuelto.
   - El body real usa bloques con prefijo de longitud `uint32` LE — cada binario es su propio bloque, sin ambigüedad de tamaños. Ver `docs/04-device-protocol-real.md`.
   - `parseBody` en `lib/protocol.ts` implementa el parsing por bloques (y mantiene el modo plano para simulador/e2e/curl).

2. **Handler de ENROLL_DATA simplificado:**
   - Actualmente inserta solo usuario y primer enrollment
   - Múltiples enrollments en el mismo request comentado (debug pending)

3. **PostgreSQL + Prisma:**
   - `lib/db.ts` usa un `pg.Pool` compartido; los 4 helpers async se conservan como shim delgado sobre `pool.query` para que el hot path (`lib/handlers/**`, `lib/operations/**`) cambie lo mínimo — sigue con SQL crudo, no modelos Prisma.
   - Prisma (`@prisma/adapter-pg`, sin binario de query-engine) queda listo para las tablas de dominio nuevas y el CRUD del admin.
   - Migración desde SQLite: ver `docs/02-architecture.md`. Antes se usaba el driver `sqlite3` (callback); el motivo histórico de no usar `better-sqlite3` (compilación en Windows) ya no aplica.

4. **Next.js 16 con App Router:**
   - `app/route.ts` con `runtime: nodejs` y `dynamic: force-dynamic`
   - Lectura manual de body con `Buffer.from(await request.arrayBuffer())`
   - No se puede usar `request.json()` porque el payload puede contener binarios

---

## 🏆 Estado del proyecto

✅ **Completado:**
- Parser de protocolo con tests (15/15 passing)
- Route handler y dispatcher
- 4 handlers de protocolo implementados
- Fragmentación de bloques (block_buffer)
- Simulador completo de dispositivo
- Panel admin funcional
- E2E testing (15/15 passing)
- Documentación completa

⚠️ **Limitaciones conocidas:**
- Múltiples binarios sin delimitación (AMBIGUO en spec)
- Enrollamentos múltiples simplificados
- Sin autenticación/SSL (fuera de scope)
- Sin Docker (fuera de scope)

---

## 📞 Soporte y preguntas

Para preguntas sobre:
- **Protocolo:** ver `lib/protocol.ts` y tests en `__tests__/protocol.test.ts`
- **Handlers:** ver `lib/handlers/protocol-handlers.ts`
- **Base de datos:** ver `lib/db.ts` y tablas en schema de migración
- **Casos de uso:** ver `scripts/e2e.ts` y `scripts/simulator.ts`
