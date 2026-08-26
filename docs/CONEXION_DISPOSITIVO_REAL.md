# Guía: Conexión de Dispositivo Biométrico Real

**Última actualización:** 2026-08-05
**Versión:** 1.1

> ## ⚠️ Si el dispositivo "no aparece", lee esto primero
>
> Dos cosas hacen que un equipo perfectamente conectado no aparezca nunca, y
> ninguna es de red:
>
> 1. **`Net Mode` en `Local`.** En ese modo el equipo es un servidor pasivo y el
>    campo "Server Set" se ignora — el manual mismo dice *"Useless in local
>    network"*. Ponlo en **`Internet`** para que use el modelo push.
> 2. **El dispositivo hace `POST //`**, no `POST /`. Next responde 308 y el
>    firmware, que habla HTTP/1.0, no sigue redirects.
>
> Ambas ya están resueltas — ver [Caso real](#caso-real-dispositivo-mudo-2026-08-05).
> El servidor arranca con `npm run dev`, que ahora usa [server.ts](../server.ts):
> **no uses `next dev` directo** o el `POST //` volverá a fallar.
4
---

## 📋 Contenido

1. [Requisitos previos](#requisitos-previos)
2. [Configuración del dispositivo](#configuración-del-dispositivo)
3. [Verificación de conectividad](#verificación-de-conectividad)
4. [Primeros pasos](#primeros-pasos)
5. [Troubleshooting](#troubleshooting)
6. [Monitoreo en tiempo real](#monitoreo-en-tiempo-real)
7. [Caso real: dispositivo mudo](#caso-real-dispositivo-mudo-2026-08-05) ← resuelto; empieza aquí si el equipo "no aparece"

---

## Requisitos previos

### Hardware
- ✅ Dispositivo biométrico compatible (ej: FK725HS, ZKTeco, etc.)
- ✅ Conexión Ethernet o WiFi
- ✅ Cable de alimentación

### Software en servidor
- ✅ Servidor biométrico ejecutándose (`npm run dev`)
- ✅ IP accesible desde la red del dispositivo
- ✅ Puerto 3000 abierto (o el que hayas configurado)

### Información del dispositivo
Antes de conectar, recolecta esta información:
- Número de serie (dev_id) — típicamente en la etiqueta del dispositivo
- Modelo y firmware
- Dirección IP que usará en la red

### Red
- ✅ Dispositivo y servidor en la **misma red** (o rutas configuradas)
- ✅ Sin firewall bloqueando puerto 3000
- ✅ Prueba con `ping <server_ip>` desde el dispositivo si es posible

---

## Configuración del dispositivo

### 1. Acceso a la interfaz de administración

**Método típico (depende del modelo):**
- Presiona los botones de función durante el booteo
- O accede via web: `http://<device_ip>:8080` (varía según modelo)
- Credenciales default: admin/admin (verificar manual del dispositivo)

### 2. Configurar dirección del servidor

**Campo a buscar en la interfaz de administración:**
```
Network Settings → Web Server
  Server IP: <tu_ip_servidor>
  Server Port: 3000
  Protocol: HTTP
```

Esto se configura únicamente desde el menú del dispositivo — no hay comando
del servidor para reconfigurar la IP/puerto de forma remota.

### 3. Sincronizar reloj del dispositivo

**Muy importante** — los logs necesitan timestamps correctos:

Desde panel admin:
```
Device: <dev_id>
Command: SET_TIME
Parameters: {
  "time": "20260729143045"
}
```

Formato: `YYYYMMDDhhmmss`

### 4. Configurar nombre del dispositivo (opcional)

```
Device: <dev_id>
Command: SET_FK_NAME
Parameters: {
  "fk_name": "Puerta Entrada - Piso 1"
}
```

---

## Verificación de conectividad

### 1. Verificar que el servidor está escuchando

```powershell
# Windows (PowerShell)
netstat -ano | Select-String "LISTENING" | Select-String ":3000\s"
# Output esperado: TCP  0.0.0.0:3000  0.0.0.0:*  LISTENING  <pid>
```

```bash
# Linux / macOS
netstat -an | grep 3000
```

Debe decir `0.0.0.0:3000`, no `127.0.0.1:3000` — si dice `127.0.0.1` solo acepta
conexiones locales y el dispositivo nunca podrá llegar.

**Verifica también si el dispositivo ya está conectando** (sustituye por su IP):

```powershell
netstat -ano | Select-String "192.168.0.116"
```

Si aparecen líneas en `ESTABLISHED`, el dispositivo **sí alcanza el servidor** y
el problema no es de red — salta a [Caso real: dispositivo
mudo](#caso-real-dispositivo-mudo-2026-08-05).

### 2. Verificar que el dispositivo puede alcanzar el servidor

**Desde el dispositivo (si tiene terminal):**
```bash
ping <server_ip>
telnet <server_ip> 3000
```

**Desde el servidor (simular conexión):**
```bash
curl -X POST http://localhost:3000/ \
  -H "dev_id: TEST_DEVICE" \
  -H "request_code: receive_cmd" \
  -H "Content-Type: application/octet-stream" \
  -d '{}'
```

**Resultado esperado:**
```http
HTTP/1.1 200 OK
response_code: OK
```

### 3. Ver en el panel admin

Accede a `http://localhost:3000/admin/`:
- **Dashboard:** ¿Aparece el dispositivo en la tabla "Connected Devices"?
- **Traffic:** ¿Aparecen peticiones del dispositivo en `/admin/traffic`?

---

## Primeros pasos

### Fase 1: Registro de usuarios (0-1 horas)

**Opción A — Via dispositivo (recomendado):**
1. Accede a interfaz del dispositivo
2. Selecciona "Enroll User"
3. Escanea finger/rostro de usuarios
4. El dispositivo enviará `realtime_enroll_data` automáticamente

**Opción B — Via servidor (sin interface del dispositivo):**
```
Device: <dev_id>
Command: SET_USER_INFO
Parameters: {
  "user_id": "U001",
  "user_name": "Juan Pérez",
  "user_privilege": "USER"
}
```

**Verificar que llegó:**
```
Device: <dev_id>
Command: GET_USER_ID_LIST
Parameters: {}
```

### Fase 2: Prueba de asistencia (15 mins)

1. Usuario se acerca al dispositivo
2. Escanea dedo/rostro
3. Dispositivo hace `realtime_glog`
4. Verifica en `/admin/logs` — ¿Aparece el log?

### Fase 3: Sincronización de datos (30 mins)

**Hacer backup de datos antes de limpiar:**

```
Device: <dev_id>
Command: GET_USER_ID_LIST
Parameters: {}
→ Guarda lista de usuarios
```

```
Device: <dev_id>
Command: GET_LOG_DATA
Parameters: {}
→ Guarda todos los logs (fragmentado si >25KB)
```

```
Device: <dev_id>
Command: GET_USER_INFO
Parameters: {"user_id": "U001"}
→ Repite para cada usuario
```

---

## Troubleshooting

### El dispositivo no conecta al servidor

**Verificaciones (en orden):**

| Síntoma | Verificar | Solución |
|---------|-----------|----------|
| Peticiones no llegan | ¿Firewall del servidor abierto? | `ufw allow 3000` (Linux) o abrir en Windows Firewall |
| Peticiones no llegan | ¿IP correcta en dispositivo? | Ejecuta `ipconfig` / `hostname -I` en servidor |
| Timeout al conectar | ¿Dispositivo puede hacer ping al servidor? | Verificar conexión de red, rutas, DNS |
| Error 500 del servidor | Ver logs en `/admin/traffic` | Expandir petición y revisar errores |

### El dispositivo conecta pero no es reconocido

**Problema:** El dispositivo aparece offline en dashboard

**Causas comunes:**
1. `last_seen_at` es NULL → No ha enviado petición aún
2. Dispositivo configurado con IP incorrecta → Cambiar en interfaz del dispositivo
3. Puerto incorrecto → Cambiar el puerto en la interfaz del dispositivo

**Solución:**
```
Device: <dev_id>
Command: GET_DEVICE_STATUS
Parameters: {}
→ Si falla: dispositivo no puede conectar
→ Si funciona: dispositivo conectó en algún momento
```

### Los logs no se sincronizan

**Verificar:**
1. ¿Hay marcaciones? → `/admin/logs` con filtro por dispositivo
2. ¿El reloj está sincronizado? → SET_TIME con fecha actual
3. ¿El dispositivo está en modo offline? → Hacer GET_LOG_DATA

**Si los logs están >25KB:**
```
Device: <dev_id>
Command: GET_LOG_DATA
Parameters: {}
→ Se fragmenta en bloques de 8KB
→ Ver en /admin/traffic → últimas peticiones
→ Estado debe ser RESULT cuando termine
```

### El dispositivo se desconecta

**Causas:**
- Reinicio del dispositivo (normal después de firmware update)
- Pérdida de red (revisa conectividad)
- Timeout del servidor (revisar logs)

**Acción:**
- Normal: esperar que reconecte automáticamente (próximo poll)
- Forzar reconexión: apagar/encender el dispositivo
- Debug: ver en `/admin/traffic` qué sucede

---

## Monitoreo en tiempo real

### Dashboard de tiempo real

**URL:** `http://localhost:3000/admin/`

Información que ves:
- **Dispositivos conectados:** Verde si `last_seen_at < 30s`
- **Comandos pendientes:** Número en azul
- **Logs totales:** Contador general

**Refresco:** Automático cada 3 segundos

### Inspector de tráfico

**URL:** `http://localhost:3000/admin/traffic`

Ver:
- ← IN: Peticiones del dispositivo
- → OUT: Respuestas del servidor
- Headers exactos intercambiados
- Body completo (JSON + binario)

**Uso:** Debug cuando algo no funciona

### Cola de comandos

**URL:** `http://localhost:3000/admin/commands`

Estados:
- 🟡 **WAIT** — Esperando que dispositivo lo ejecute
- 🔵 **RUN** — Dispositivo recibió el comando
- 🟢 **RESULT** — Completado con éxito
- 🔴 **ERROR** — Falló en ejecución

**Expandir fila** para ver:
- Parámetros enviados
- Respuesta JSON del dispositivo
- Timestamps

---

## Flujo típico de una marcación

```
1. Usuario se acerca al dispositivo
   ↓
2. Dispositivo captura biométrico
   ↓
3. Dispositivo verifica y reconoce usuario
   ↓
4. Dispositivo hace POST realtime_glog:
   - dev_id: <serial del dispositivo>
   - request_code: realtime_glog
   - user_id: U001
   - verify_mode: FP
   - io_time: 20260729143045
   ↓
5. Servidor recibe y guarda en attendance_logs
   ↓
6. Aparece en /admin/logs
   ↓
7. ¡Listo!
```

---

## Flujo típico de sincronización

```
Servidor inicia (por horario o manual):
   ↓
GET_USER_ID_LIST → Lista de usuarios
   ↓
Para cada usuario:
  GET_USER_INFO → Datos completos
   ↓
GET_LOG_DATA → Todos los logs (puede fragmentarse)
   ↓
[Guardar en base de datos central]
   ↓
CLEAR_LOG_DATA → Liberar memoria del dispositivo
   ↓
✓ Sincronización completa
```

---

## Checklist de implementación

### Antes de conectar
- [ ] Servidor corriendo: `npm run dev`
- [ ] IP del servidor documentada
- [ ] Puerto 3000 abierto en firewall
- [ ] Dispositivo en misma red

### Conectar dispositivo
- [ ] Configurar IP del servidor en dispositivo
- [ ] Sincronizar hora: SET_TIME
- [ ] Dar nombre: SET_FK_NAME (opcional)
- [ ] Verificar en dashboard que aparece

### Registrar usuarios
- [ ] Escanear/registrar usuarios en dispositivo
- [ ] GET_USER_ID_LIST para verificar
- [ ] GET_USER_INFO para cada usuario

### Pruebas
- [ ] Usuario se acerca y marca
- [ ] Log aparece en /admin/logs
- [ ] Timestamp es correcto
- [ ] GET_DEVICE_STATUS devuelve datos correctos

### Producción
- [ ] Backup inicial: GET_LOG_DATA + GET_USER_ID_LIST
- [ ] Sincronización programada (diaria recomendado)
- [ ] Monitoreo: revisar /admin/traffic regularmente
- [ ] Alertas si `last_seen_at > 30 minutos`

---

## Casos especiales

### Dispositivo con múltiples localizaciones

Crear un dispositivo por ubicación:
```
Dispositivo 1: DEV_PUERTA_1 (Entrada)
Dispositivo 2: DEV_PUERTA_2 (Salida)
Dispositivo 3: DEV_OFICINA (Oficina central)
```

Cada uno reporta independientemente.

### Migración de dispositivo antiguo

```
1. GET_LOG_DATA (backup completo)
2. GET_USER_ID_LIST → obtener usuarios
3. Para cada usuario: GET_USER_INFO
4. Configurar nuevo dispositivo
5. SET_USER_INFO en nuevo dispositivo
6. CLEAR_LOG_DATA en dispositivo antiguo
7. Apagar dispositivo antiguo
```

### Reset de dispositivo

```
Device: <dev_id>
Command: CLEAR_ENROLL_DATA
Parameters: {}
→ Elimina todos los usuarios y biométricos
→ LOG DATA se mantiene
```

---

## Soporte y debugging

### Logs del servidor

En terminal donde corre `npm run dev`:
```
[next] GET /admin/traffic
[next] POST / (realtime_glog)
[next] GET /admin/commands
```

### Inspeccionar petición HTTP cruda

En `/admin/traffic`, expandir una petición:
```
Headers:
  dev_id: DEV001
  request_code: receive_cmd
  Content-Type: application/octet-stream
  Content-Length: 256

Body (JSON):
{
  "fk_name": "FK725HS001",
  "fk_time": "260729140000",
  "fk_info": {...}
}
```

### Simular petición desde línea de comandos

```bash
# Simular receive_cmd
curl -X POST http://localhost:3000/ \
  -H "dev_id: DEV001" \
  -H "request_code: receive_cmd" \
  -H "Content-Type: application/octet-stream" \
  -d '{"fk_name":"Test"}'

# Simular send_cmd_result
curl -X POST http://localhost:3000/ \
  -H "dev_id: DEV001" \
  -H "request_code: send_cmd_result" \
  -H "trans_id: 1" \
  -H "cmd_return_code: OK" \
  -d '{"status":"ok"}'
```

---

## Contacto y ayuda

Si algo no funciona:

1. **Revisa en `/admin/traffic`** — ¿qué exactamente envía el dispositivo?
2. **Expande un comando en `/admin/commands`** — ¿cuál es la respuesta?
3. **Verifica timestamp en logs** — ¿la hora es correcta?
4. **Consulta el manual del dispositivo** — parámetros pueden variar por modelo

---

## Caso real: dispositivo mudo (2026-08-05)

Registro del primer intento de conectar un equipo físico. **Léelo antes de
diagnosticar un dispositivo que "no aparece"** — evita repetir horas de trabajo.

### El equipo

| Dato | Valor |
|---|---|
| Serial (`dev_id`) | `2023081158` |
| Versión de software | `WS535BW1_BSCS_v1.5.31` |
| MAC | `E8:AB:FA:84:C7:0E` → Shenzhen Reecam Tech. Ltd. (OEM genérico) |
| IP en la red | `192.168.0.116` |
| Puerto propio del equipo | 5005 (único puerto abierto; **no** es el puerto del servidor) |
| Marca visible | ninguna — carcasa sin logo ni modelo |

### El síntoma

El dispositivo **abre una conexión TCP nueva al servidor cada ~11 segundos**,
mantiene 6 o 7 vivas simultáneamente, y **no envía ni un solo byte** por
ninguna. Node lo desconecta por timeout a los ~70 segundos y el dispositivo
reconecta:

```
17:30:09  conn#1 OPEN from 192.168.0.116:5018  → 0 bytes
17:30:20  conn#2 OPEN from 192.168.0.116:5019  → 0 bytes
17:30:31  conn#3 OPEN from 192.168.0.116:5020  → 0 bytes
          ... 36 conexiones, cero bytes en total ...
```

### Lo que quedó DESCARTADO (con evidencia, no por suposición)

No pierdas tiempo aquí si ves este síntoma:

| Hipótesis | Cómo se descartó |
|---|---|
| Problema de red / IP / subred | `ping` bidireccional OK; ambos en `192.168.0.x/24` |
| Firewall de Windows bloqueando | Regla de Node.js permitida en perfil privado; y el handshake TCP **completa** (estado `ESTABLISHED`) |
| Servidor no escuchando | `netstat` muestra `0.0.0.0:3000 LISTENING` |
| Puerto del servidor mal configurado | El dispositivo llega al puerto correcto — de ahí las conexiones establecidas |
| El MESH WiFi separaba las redes | Se conectó por LAN directo al router; mismo comportamiento |
| Puerto 5005 mal configurado | 5005 es el puerto **del dispositivo**, no del servidor. Irrelevante para el push |
| El equipo solo transmite al haber un evento | Se marcó con el dedo y se registró una huella nueva: **cero bytes** |

### Lo que se intentó sin éxito

- **11 framings de saludo** enviados al dispositivo por la conexión que él mismo
  abre (`npm run handshake-probe`): reverse-HTTP `GET`/`POST`, respuesta HTTP 200
  con `response_code: OK`, ZKTeco `CMD_CONNECT` y `CMD_DEVICE` (con checksum
  válido y wrapper TCP `50 50 82 7d`), framing `0x55AA`, Anviz `0xA5`, CRLF, byte
  nulo, y escucha pasiva. **Ninguna respuesta.**
- **Puerto 5005 del dispositivo**: HTTP/1.1 con `Host`, `POST` con headers del
  protocolo, `/cgi-bin/`, framings binarios, escucha pasiva. Acepta la conexión
  TCP y **no contesta nada**.
- **UDP**: 60 probes en 5 puertos (unicast + broadcast), escuchando en 6 puertos.
  **Cero paquetes del dispositivo.**
- **Ajuste `Servdr req` de No → Sí** en el menú del equipo, con reinicio. Sin
  cambio de comportamiento.
- **Búsqueda de documentación** de `WS535BW1`, `BSCS` y el OUI de Reecam: sin
  resultados públicos.

### ✅ Resuelto — dos causas, ninguna de red

**Causa 1: `Net Mode` estaba en `Local`.**

La página 4/4 del manual físico lo explica:

> **【Net Mode】**: *Local* means Local network. ***Internet*** means WAN/Web based
> **/BS/Cloud**, user need to follow our communication protocol to do secondary
> development.
>
> **【Server Set】**: **Useless in local network. Please ignore and no need to set.**

En `Local` el equipo es un servidor pasivo en su puerto 5005 y **el campo Server
Set se ignora** — de ahí los sockets mudos. El modo `Internet` es el BS/Cloud,
que sí hace push al servidor.

```
Comm Set  →  2. TCP/IP  →  3. Net Mode  →  Internet
Comm Set  →  2. TCP/IP  →  2. Server Set  →  IP y puerto del servidor
```

**Causa 2: el dispositivo hace `POST //`, no `POST /`.**

```
POST // HTTP/1.0
request_code:receive_cmd
dev_id: 2023081158
blk_no: 0
blk_len: 223
HOST: 192.168.0.114
```

Next colapsa los slashes repetidos con un **308 Permanent Redirect**, y lo hace
antes de `proxy.ts`, antes de `redirects` y antes del routing — no se puede
desactivar desde `next.config`. El firmware habla HTTP/1.0 y nunca sigue
redirects, así que **1802 peticiones murieron en el redirect** sin llegar nunca
a `app/route.ts`.

Resuelto en [server.ts](../server.ts), un servidor Next personalizado que
normaliza `req.url` antes de entregárselo a Next. Por eso `npm run dev` ahora
corre `tsx server.ts`. **`next dev` directo rompe el dispositivo** — quedó
disponible como `npm run dev:next` solo para trabajar en la UI.

### Formato real del body

Descubierto con el sniffer y verificado contra 4 respuestas distintas. **No es
"JSON + binario"**, es una secuencia de bloques con prefijo de longitud
(`uint32` little-endian). El bloque 0 es el JSON terminado en NUL; los que siguen
son los `BIN_1`, `BIN_2`… que el JSON referencia:

```
41 00 00 00                                          ← uint32 LE = 65
{"user_id_count":3,"one_user_id_size":8,
 "user_id_array":"BIN_1"}                            ← 64 bytes
00                                                   ← NUL (64 + 1 = 65 ✓)
18 00 00 00                                          ← uint32 LE = 24
01 00 00 00 01 01 08 00                              ← usuario 1
02 00 00 00 02 01 08 00                              ← usuario 2
03 00 00 00 01 01 08 00                              ← usuario 3
```

`parseBody` en [lib/protocol.ts](../lib/protocol.ts) maneja las dos formas: si el
body empieza con `{` lo lee plano (simulador, e2e, curl); si no, lo lee por
bloques. Comprobado:

| Comando | JSON | Binario | Cuadra |
|---|---|---|---|
| `GET_USER_ID_LIST` | `user_id_count: 3, one_user_id_size: 8` | 24 B | 3 × 8 ✓ |
| `GET_LOG_DATA` | `log_count: 30, one_log_size: 12` | 360 B | 30 × 12 ✓ |
| `GET_DEVICE_STATUS` | 7 campos | — | ✓ |

### Otros detalles del firmware

- **Las capacidades vienen anidadas en `fk_info`**, no al nivel raíz:
  `{"fk_name":"","fk_time":"...","fk_info":{"firmware":"WS535BW1_BSCS_v1.5.31",
  "fk_bin_data_lib":"FKDATAHS101","supported_enroll_data":["FP","PASSWORD","IDCARD"]}}`
- **El body trae padding NUL/newline al final.** Sin filtrarlo se guardaban 2
  bytes de basura como si fueran una huella o una foto en `log_image`.
- **El reloj arranca en el año 2000** (`io_time: "20000101025023"`). Hay que
  sincronizarlo o las marcaciones no sirven.

### Las respuestas del servidor también van framed

`SET_TIME` devolvía `ERROR` mientras le mandábamos JSON crudo. La causa era la
misma asimetría: **el firmware espera que las respuestas del servidor usen el
mismo framing que sus propias peticiones.** La prueba fue limpia — mismo comando,
mismo parámetro, solo cambió el framing:

| Body enviado | Resultado |
|---|---|
| `{"time":"20260805182800"}` — 25 B crudos | ❌ `ERROR` |
| `1a000000` + `{"time":"..."}` + `00` — 30 B | ✅ `RESULT / OK` |

Los comandos sin parámetros (`GET_DEVICE_STATUS`, `GET_LOG_DATA`…) funcionaban
igual sin framing porque el firmware nunca lee su body. Solo falla en los que sí
lo leen.

`buildResponse` en [lib/protocol.ts](../lib/protocol.ts) ahora arma el body como
bloques con prefijo de longitud y agrega los headers `blk_no: 0` y `blk_len`,
espejando lo que manda el dispositivo.

### SET_TIME: déjalo sin parámetros

El dispositivo solo aplica el comando en su siguiente poll, hasta ~10 segundos
después de encolarlo. Una hora estampada al encolar llega vieja — quedaba entre
8 y 15 segundos atrasado.

Encola `SET_TIME` con `{}` y [handleReceiveCmd](../lib/handlers/protocol-handlers.ts)
estampa la hora en el momento de la entrega. Resultado verificado: **desviación
cero**.

```
recibido 18:34:50  ->  dispositivo dice: 2026-08-05 18:34:50
```

Si necesitas una hora específica, `{"time":"YYYYMMDDhhmmss"}` sigue funcionando y
tiene precedencia.

### Herramientas de diagnóstico disponibles

```bash
npm run sniffer          # Proxy TCP: muestra los bytes exactos en ambas direcciones
npm run handshake-probe  # Servidor TCP crudo que le habla primero al dispositivo
```

**`npm run sniffer`** — proxy transparente. Por defecto escucha en 3001 y
reenvía a 3000. Configurable con `SNIFF_PORT` y `UPSTREAM_PORT`.

Para capturar sin reconfigurar el dispositivo, ponlo delante de la app:

```bash
npx next dev -p 3002                                    # app en 3002
SNIFF_PORT=3000 UPSTREAM_PORT=3002 npm run sniffer      # captura en 3000
```

El dashboard queda en `localhost:3002/admin` mientras dure la captura. Filtra el
log por la IP del dispositivo para separarlo del tráfico del navegador:

```bash
grep "192.168.0.116" sniffer.log
```

**`npm run handshake-probe`** — para el caso en que el dispositivo abra la
conexión y espere que el servidor hable primero. Rota un saludo distinto por
cada conexión entrante y registra cualquier respuesta. Requiere el puerto que
marca el dispositivo, así que detén el dev server antes. Configurable con
`PROBE_PORT`, `QUIET_MS` y `DEV_IP`.

---

## Recursos adicionales

- [COMANDOS.md](COMANDOS.md) — Catálogo completo de comandos
- [README.md](README.md) — Arquitectura y flujo general
- `/admin/traffic` — Visor de tráfico en tiempo real
- `/admin/logs` — Historial de marcaciones
