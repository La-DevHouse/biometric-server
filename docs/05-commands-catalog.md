# Catálogo Completo de Comandos - Servidor Biométrico

**Última actualización:** 2026-07-29  
**Versión:** 1.0

---

## 📋 Índice de comandos

1. [Gestión de dispositivos](#gestión-de-dispositivos)
2. [Gestión de usuarios](#gestión-de-usuarios)
3. [Gestión de datos biométricos](#gestión-de-datos-biométricos)
4. [Gestión de logs](#gestión-de-logs)
5. [Gestión de información del servidor](#gestión-de-información-del-servidor)

---

## Gestión de dispositivos

### GET_DEVICE_STATUS
**Descripción:** Obtiene el estado actual del dispositivo (conteos de usuarios, logs, etc.)

**Parámetros JSON:** (vacío)
```json
{}
```

**Ejemplo en panel admin:**
- **Device:** SIM001
- **Command:** GET_DEVICE_STATUS
- **Parameters:** `{}`

**Respuesta esperada:**
```json
{
  "totalUserCount": 15,
  "userCount": 12,
  "managerCount": 2,
  "fpCount": 24,
  "faceCount": 0,
  "passwordCount": 5,
  "idcardCount": 3,
  "totalLogCount": 1250
}
```

**Campos de respuesta:**
| Campo | Tipo | Significado |
|-------|------|------------|
| `totalUserCount` | number | Total de usuarios en dispositivo |
| `userCount` | number | Usuarios activos (excluye managers) |
| `managerCount` | number | Usuarios con privilegio MANAGER |
| `fpCount` | number | Fingerprints registrados |
| `faceCount` | number | Rostros registrados |
| `passwordCount` | number | Contraseñas registradas |
| `idcardCount` | number | Tarjetas ID registradas |
| `totalLogCount` | number | Total de marcaciones de asistencia |

**Notas:**
- Útil para verificar estado del dispositivo antes de operaciones masivas
- No modifica estado del dispositivo
- Respuesta es inmediata (no requiere fragmentación)

---

### SET_FK_NAME
**Descripción:** Asigna un nombre/identificador al dispositivo

**Parámetros JSON:**
```json
{
  "fk_name": "Puerta Entrada Principal"
}
```

**Campos requeridos:**
| Campo | Tipo | Máx | Descripción |
|-------|------|-----|------------|
| `fk_name` | string | 64 | Nombre descriptivo del dispositivo |

**Ejemplo en panel admin:**
```
Device: SIM001
Command: SET_FK_NAME
Parameters: {"fk_name":"Oficina Piso 3"}
```

**Respuesta esperada:**
```json
{"status": "ok"}
```

**Notas:**
- Puramente informativo
- Se usa para identificar dispositivos en reportes
- No afecta funcionalidad

**No existe GET_FK_NAME — no hace falta pedirlo:**
El dispositivo manda su `fk_name` por su cuenta en cada `receive_cmd` (su poll,
cada ~11s en el firmware `WS535BW1_BSCS_v1.5.31`), junto con `fk_time` y
`fk_info`. El servidor lo guarda automático en `devices.fk_name`
([lib/handlers/protocol-handlers.ts](../lib/handlers/protocol-handlers.ts)).
Para leerlo, consulta la tabla `devices` o el dashboard — no encoles ningún
comando. Si el dispositivo nunca tuvo nombre, el equipo manda `fk_name: ""` y
el servidor lo guarda como `null`.

---

### SET_TIME
**Descripción:** Sincroniza el reloj del dispositivo

**Parámetros JSON:**
```json
{
  "time": "20260729143045"
}
```

**Campos requeridos:**
| Campo | Tipo | Formato | Descripción |
|-------|------|---------|------------|
| `time` | string | YYYYMMDDhhmmss | Fecha/hora a establecer |

**Desglose del formato:**
- `YYYY`: Año (2026)
- `MM`: Mes (01-12)
- `DD`: Día (01-31)
- `hh`: Hora (00-23)
- `mm`: Minuto (00-59)
- `ss`: Segundo (00-59)

**Ejemplo en panel admin:**
```
Device: SIM001
Command: SET_TIME
Parameters: {"time":"20260729143045"}
```

**Ejemplo práctico (ahora):**
```json
{"time":"20260729153000"}
```

**Respuesta esperada:**
```json
{"status": "ok"}
```

**Notas:**
- Crítico para que los logs tengan timestamps correctos
- Se recomienda sincronizar diariamente o cuando cambia zona horaria
- Mejor hacerlo en horario de poco uso para no afectar operaciones

---

## Gestión de usuarios

### SET_USER_NAME
**Descripción:** Cambia el nombre de un usuario existente

**Parámetros JSON:**
```json
{
  "user_id": "U001",
  "user_name": "Juan Pérez García"
}
```

**Campos requeridos:**
| Campo | Tipo | Máx | Descripción |
|-------|------|-----|------------|
| `user_id` | string | 32 | ID único del usuario (ej: U001, EMP123) |
| `user_name` | string | 128 | Nombre completo |

**Ejemplo en panel admin:**
```
Device: SIM001
Command: SET_USER_NAME
Parameters: {"user_id":"U042","user_name":"María López"}
```

**Respuesta esperada:**
```json
{"status": "ok"}
```

**Notas:**
- No requiere que el usuario exista previamente
- Si no existe, lo crea
- Útil para corregir errores de entrada o cambios de nombre
- **Verificado en firmware `WS535BW1_BSCS_v1.5.31`:** único comando seguro para
  renombrar un usuario existente sin afectar privilegio ni datos biométricos —
  a diferencia de `SET_USER_INFO` (ver advertencia en esa sección)
- **⚠️ El nombre se trunca a 8 caracteres**, sin aviso ni error. Verificado:
  `"Jesus Renombrado"` quedó guardado como `"Jesus Re"`. No confiar en el
  límite de 128 documentado más arriba — ese es el límite teórico del
  protocolo, no el que aplica este firmware

---

### SET_USER_PRIVILEGE
**Descripción:** Asigna nivel de privilegios a un usuario

**Parámetros JSON:**
```json
{
  "user_id": "U001",
  "user_privilege": "MANAGER"
}
```

**Campos requeridos:**
| Campo | Tipo | Opciones | Descripción |
|-------|------|----------|------------|
| `user_id` | string | — | ID único del usuario |
| `user_privilege` | string | MANAGER, REGISTER, OPERATOR, USER | Nivel de acceso |

**Niveles de privilegio:**
| Privilegio | Descripción | Uso típico |
|-----------|------------|-----------|
| `USER` | Usuario regular, solo marcación | Empleados estándar |
| `OPERATOR` | Puede ver logs, reportes | Supervisores, RH |
| `REGISTER` | Puede registrar nuevos usuarios | Administradores de registros |
| `MANAGER` | Acceso total al dispositivo | Administrador del dispositivo |

**Ejemplo en panel admin:**
```
Device: SIM001
Command: SET_USER_PRIVILEGE
Parameters: {"user_id":"U010","user_privilege":"MANAGER"}
```

**Respuesta esperada:**
```json
{"status": "ok"}
```

**Notas:**
- No dispara el reindexado de `SET_USER_INFO` — verificado en firmware
  `WS535BW1_BSCS_v1.5.31`: no genera eventos `realtime_enroll_data`
  inesperados y las huellas del usuario sobreviven intactas
- Es el comando correcto para cambiar solo el privilegio de un usuario
  existente

**⚠️ Solo `MANAGER` fue verificado funcionando en este firmware.** Al probar
`{"user_id":"1","user_privilege":"OPERATOR"}`, el dispositivo respondió
`OK` pero el privilegio quedó en `USER` — el valor se ignoró en silencio, sin
error. No se probaron `REGISTER` ni `USER` explícitamente. Es posible que este
firmware use códigos numéricos en vez de estos strings para niveles distintos
de `MANAGER`, pero eso no está confirmado — no lo asumas sin probarlo primero
contra tu dispositivo real y verificar con un `GET_USER_INFO` posterior.

---

### DELETE_USER
**Descripción:** Elimina un usuario del dispositivo (y todos sus datos biométricos)

**Parámetros JSON:**
```json
{
  "user_id": "U999"
}
```

**Campos requeridos:**
| Campo | Tipo | Descripción |
|-------|------|------------|
| `user_id` | string | ID del usuario a eliminar |

**Ejemplo en panel admin:**
```
Device: SIM001
Command: DELETE_USER
Parameters: {"user_id":"U050"}
```

**Respuesta esperada:**
```json
{"status": "ok"}
```

**⚠️ Advertencia:**
- **Esta acción es irreversible**
- Elimina toda información del usuario (nombre, datos biométricos, foto)
- Los logs históricos se mantienen
- Se recomienda hacer backup antes de borrar usuarios importantes

**⚠️ El `cmd_return_code` de este comando no es confiable — verificado contra
hardware real (firmware `WS535BW1_BSCS_v1.5.31`, dos dispositivos, cuatro
usuarios distintos):** varias eliminaciones devolvieron `cmd_return_code:
"Error"` pero un `GET_USER_ID_LIST` posterior confirmó que el usuario sí había
sido borrado. No asumas que `Error` significa que la eliminación falló — la
única forma confiable de saberlo es volver a consultar con `GET_USER_INFO` o
`GET_USER_ID_LIST` después. El panel admin ya hace esto automáticamente
(`DELETE_USER` siempre verifica antes de reportar éxito o fracaso).

---

### GET_USER_INFO
**Descripción:** Obtiene información completa de un usuario

**Parámetros JSON:**
```json
{
  "user_id": "U001"
}
```

**Campos requeridos:**
| Campo | Tipo | Descripción |
|-------|------|------------|
| `user_id` | string | ID del usuario |

**Ejemplo en panel admin:**
```
Device: SIM001
Command: GET_USER_INFO
Parameters: {"user_id":"U025"}
```

**Respuesta cruda del dispositivo** (capturada del equipo real, usuario con una huella registrada):
```json
{
  "user_id": "1",
  "user_name": "jesus",
  "user_privilege": "MANAGER",
  "enroll_data_array": [
    {"backup_number": 0, "enroll_data": "BIN_1"}
  ]
}
```

Igual que en `GET_USER_ID_LIST`, cada `"BIN_N"` es un placeholder que apunta al
bloque binario adjunto (`user_photo` y cada `enroll_data` de
`enroll_data_array` pueden traer uno). Un fingerprint o rostro es un template
binario propietario del dispositivo — no hay una forma "decodificada" de
mostrarlo como con los IDs numéricos. Lo único objetivo y siempre correcto que
se puede dar es su tamaño real, así que el servidor agrega `<campo>_size`
junto a cada referencia, y `<campo>_text` únicamente cuando esos bytes resultan
ser texto imprimible (el caso real de una contraseña o número de tarjeta, no
una suposición basada en `backup_number`):

```json
{
  "user_id": "1",
  "user_name": "jesus",
  "user_privilege": "MANAGER",
  "enroll_data_array": [
    {"backup_number": 0, "enroll_data": "BIN_1", "enroll_data_size": 612}
  ]
}
```

Así se ve directamente en `/admin/commands` al expandir el comando.

**Campos de respuesta:**
| Campo | Tipo | Descripción |
|-------|------|------------|
| `user_id` | string | ID del usuario |
| `user_name` | string | Nombre completo |
| `user_privilege` | string | Nivel de privilegios |
| `user_photo` | string | Placeholder `"BIN_N"` si tiene foto (opcional) |
| `user_photo_size` | number | **Agregado por el servidor.** Tamaño real en bytes |
| `user_photo_text` | string | **Agregado por el servidor**, solo si la foto fuera texto imprimible (nunca ocurre con JPG/PNG reales) |
| `enroll_data_array` | array | Datos biométricos registrados |
| `enroll_data_array[].enroll_data_size` | number | **Agregado por el servidor.** Tamaño real en bytes del template |
| `enroll_data_array[].enroll_data_text` | string | **Agregado por el servidor**, solo si esos bytes son texto imprimible (típico en password/ID card) |

**Backup numbers (enroll_data_array):**
| Número | Tipo | Descripción |
|--------|------|------------|
| 0-9 | Fingerprint | 10 dedos (0=pulgar derecho, etc) |
| 10 | Password | Contraseña |
| 11 | ID Card | Tarjeta de identificación |
| 12 | Face | Reconocimiento facial |

**Notas:**
- Puede retornar >25KB si hay mucha data biométrica
- Se fragmenta automáticamente en bloques de 8KB si es necesario
- `user_photo`/`enroll_data` siguen siendo binarios — no se pueden visualizar
  en el panel admin, solo inspeccionar su tamaño (y texto, si aplica)

**⚠️ Se cuelga de forma consistente al consultar un `user_id` que no existe.**
Verificado repetidamente contra hardware real (dispositivo `2023081133`,
2026-08-18): en **todos** los intentos de sondear un ID genuinamente nuevo
(nunca usado antes), el comando quedó entregado (`RUN`) sin que el
dispositivo mandara jamás un `send_cmd_result` — mientras tanto, el equipo
seguía haciendo su polling normal como si nada, y solo se resolvió al
vencer la barrida de operaciones (3 min). En cambio, consultar un ID que
**sí** existe siempre respondió en segundos, sin excepción, en todas las
pruebas. Esto no es ocasional: si vas a usar este comando para "¿existe
este usuario?" (como hace `CREATE_USER` en el panel), asume que vas a
esperar el timeout completo cada vez que el ID resulte estar libre — no
hay forma conocida de acortar esa espera seguramente, porque no hay señal
para distinguir "no existe" de "existe pero está respondiendo lento" antes
de que se cumpla el timeout, y confundir esos dos casos aquí dispararía el
reindexado destructivo de `SET_USER_INFO` sobre un usuario real.

**`GET_USER_ID_LIST` no es una alternativa válida para este chequeo** — ver
su propia advertencia: no enumera usuarios sin huella registrada, así que
"no aparece en la lista" no significa "el ID está libre".

---

### SET_USER_INFO

> ## ⚠️ No usar para editar un usuario existente — usa SET_USER_NAME / SET_USER_PRIVILEGE
>
> **Verificado byte a byte en firmware `WS535BW1_BSCS_v1.5.31` (2026-08-16):**
> mandar `SET_USER_INFO` a un usuario que ya tiene huellas registradas, sin
> incluir `enroll_data_array`, dispara una **reconstrucción interna de toda la
> tabla de usuarios del dispositivo** — no solo del usuario que tocaste.
>
> Evidencia capturada con el sniffer: al enviar
> `{"user_id":"1","user_name":"Jesus Paris","user_privilege":"MANAGER"}`
> (usuario con una huella ya registrada), el dispositivo confirmó `OK` y acto
> seguido, **sin que se lo pidiéramos**, mandó dos eventos `realtime_enroll_data`
> no solicitados para OTROS usuarios (2 y 3), cada uno con su huella completa —
> la firma de un reindexado completo, no de una simple escritura de campo.
>
> Durante esa ventana (en la prueba, ~7 minutos), el propio dispositivo
> reportó al usuario editado con el privilegio reseteado a `USER` y
> `enroll_data_array: []` — es decir, **el dispositivo mismo dijo que sus
> datos estaban borrados**, no fue un problema de caché del servidor. Pasados
> esos minutos, sin mandar ningún comando adicional, el dispositivo se
> auto-corrigió y volvió a reportar `MANAGER` con la huella intacta.
>
> **No hay garantía de que esa reconciliación automática ocurra siempre ni en
> cuánto tiempo.** Para **editar** un usuario existente:
> - Cambiar el nombre → [`SET_USER_NAME`](#set_user_name) (verificado seguro, sin efectos secundarios)
> - Cambiar el privilegio → [`SET_USER_PRIVILEGE`](#set_user_privilege) (verificado seguro, sin efectos secundarios — aunque solo `MANAGER` se confirmó aplicando correctamente)
>
> ## ⚠️ Tampoco confirmado que sirva para dar de alta usuarios nuevos
>
> Una versión anterior de esta nota recomendaba `SET_USER_INFO` para crear
> usuarios nuevos sin biométricos — esa recomendación **nunca se verificó
> contra hardware real**, era una inferencia ("si es destructivo sobre
> existentes, debe ser para crear"). Al verificarla (dispositivo
> `2023081133`, 2026-08-18): **tres intentos de crear un usuario nuevo con
> IDs nunca antes usados (`10`, `11`, y con pausas reales de 20s entre pasos
> para descartar ráfaga) devolvieron `cmd_return_code: "OK"` los tres, pero
> un `GET_USER_ID_LIST` posterior confirmó que el usuario nunca se creó** —
> ni una sola vez. El `OK` no es fiable para saber si esto funcionó, igual
> que con `DELETE_USER`.
>
> No está confirmado si esto es una limitación general del firmware o
> específica de ese dispositivo — falta probar contra `2023081158`. Hasta
> entonces, no asumas que puedes dar de alta usuarios completamente nuevos
> por software; puede que este firmware solo permita crear el registro de un
> usuario mediante el enrolamiento físico en el equipo (huella o teclado),
> y que `SET_USER_INFO`/`SET_USER_NAME`/`SET_USER_PRIVILEGE` solo sirvan para
> ajustar campos de un usuario que ya existe por ese camino.

**Descripción:** Crea o actualiza un usuario completo con todos sus datos

**Parámetros JSON:**
```json
{
  "user_id": "U050",
  "user_name": "Laura Martínez",
  "user_privilege": "OPERATOR",
  "user_photo": "BIN_1",
  "enroll_data_array": [
    {"backup_number": 0},
    {"backup_number": 1},
    {"backup_number": 10}
  ]
}
```

**Campos requeridos:**
| Campo | Tipo | Descripción |
|-------|------|------------|
| `user_id` | string | ID único del usuario |
| `user_name` | string | Nombre completo |
| `user_privilege` | string | MANAGER, REGISTER, OPERATOR, USER |

**Campos opcionales:**
| Campo | Tipo | Descripción |
|-------|------|------------|
| `user_photo` | BIN_1 | Foto binaria (JPG/PNG) |
| `enroll_data_array` | array | Array de datos biométricos |

**Ejemplo en panel admin (sin foto/biométricos):**
```
Device: SIM001
Command: SET_USER_INFO
Parameters: {
  "user_id": "U100",
  "user_name": "Nuevo Usuario",
  "user_privilege": "USER"
}
```

**Ejemplo en panel admin (completo):**
```
Device: SIM001
Command: SET_USER_INFO
Parameters: {
  "user_id": "U101",
  "user_name": "Usuario Completo",
  "user_privilege": "OPERATOR",
  "enroll_data_array": [
    {"backup_number": 0},
    {"backup_number": 1}
  ]
}
```

**Respuesta esperada:**
```json
{"status": "ok"}
```

**Notas:**
- Pensado para dar de alta usuarios nuevos, no para editar uno existente —
  ver advertencia arriba
- **"lo actualiza excepto datos biométricos" es la intención original de
  este comando, pero NO es lo que se observó**: en un usuario con huellas ya
  registradas, sí las afecta (al menos transitoriamente, vía el reindexado)
- Los datos biométricos deben enviarse por separado con SET_ENROLL_DATA
- Puede requerir fragmentación si hay mucha data

---

## Gestión de datos biométricos

### GET_ENROLL_DATA
**Descripción:** Obtiene datos biométricos de un usuario (fingerprint, contraseña, etc)

**Parámetros JSON:**
```json
{
  "user_id": "U001",
  "backup_number": 0
}
```

**Campos requeridos:**
| Campo | Tipo | Descripción |
|-------|------|------------|
| `user_id` | string | ID del usuario |
| `backup_number` | number | Tipo de dato (0-12) |

**Backup numbers:**
| Número | Tipo | Descripción | Ejemplo |
|--------|------|------------|---------|
| 0-9 | Fingerprint | 10 dedos | 0=pulgar derecho |
| 10 | Password | Contraseña | "password123" |
| 11 | ID Card | Tarjeta ID | Número de tarjeta |
| 12 | Face | Rostro | Datos faciales |

**Ejemplo en panel admin (obtener fingerprint del dedo 0):**
```
Device: SIM001
Command: GET_ENROLL_DATA
Parameters: {"user_id":"U025","backup_number":0}
```

**Ejemplo (obtener contraseña):**
```
Device: SIM001
Command: GET_ENROLL_DATA
Parameters: {"user_id":"U025","backup_number":10}
```

**Respuesta cruda del dispositivo:**
```json
{
  "enroll_data": "BIN_1",
  "status": "ok"
}
```

Mismo caso que `GET_USER_INFO`: `"BIN_1"` es un placeholder. El servidor agrega
`enroll_data_size` (siempre) y `enroll_data_text` (solo si son bytes
imprimibles — típico de password/ID card):

```json
{
  "enroll_data": "BIN_1",
  "enroll_data_size": 612,
  "status": "ok"
}
```

**Notas:**
- Retorna datos binarios del biométrico — decodificable solo en tamaño (y
  texto, cuando aplica); un fingerprint o rostro no tiene forma legible
- Si el dato no existe, retorna error
- Útil para verificar qué datos están registrados
- Puede ser >25KB para datos de rostro (se fragmenta)

---

### SET_ENROLL_DATA
**Descripción:** Registra datos biométricos para un usuario

**Parámetros JSON:**
```json
{
  "user_id": "U001",
  "backup_number": 0,
  "enroll_data": "BIN_1"
}
```

**Campos requeridos:**
| Campo | Tipo | Descripción |
|-------|------|------------|
| `user_id` | string | ID del usuario |
| `backup_number` | number | Tipo de dato (0-12) |
| `enroll_data` | BIN_1 | Datos binarios |

**Backup numbers y tipos de datos:**
| Número | Tipo | Tamaño típico | Descripción |
|--------|------|--------------|------------|
| 0-9 | Fingerprint | 500-2000 bytes | Template del dedo |
| 10 | Password | 100-500 bytes | Hash de contraseña |
| 11 | ID Card | 100 bytes | Número/datos de tarjeta |
| 12 | Face | 5000-10000 bytes | Template facial |

**Ejemplo en panel admin:**
```
Device: SIM001
Command: SET_ENROLL_DATA
Parameters: {
  "user_id": "U050",
  "backup_number": 0
}
(+ datos binarios del fingerprint capturados)
```

**Respuesta esperada:**
```json
{"status": "ok"}
```

**Notas:**
- Los datos binarios deben ser capturados del dispositivo biométrico real
- No es posible capturar desde el panel admin (requeriría hardware)
- Generalmente usado por scripts de migración o sincronización
- Los datos se almacenan en enroll_data tabla

---

## Gestión de logs

### GET_LOG_DATA
**Descripción:** Obtiene registros de asistencia (marcaciones) del dispositivo

**Parámetros JSON:**
```json
{
  "begin_time": "20260701000000",
  "end_time": "20260731235959"
}
```

**Campos opcionales:**
| Campo | Tipo | Formato | Descripción |
|-------|------|---------|------------|
| `begin_time` | string | YYYYMMDDhhmmss | Fecha/hora inicio (vacío = desde siempre) |
| `end_time` | string | YYYYMMDDhhmmss | Fecha/hora fin (vacío = hasta ahora) |

**Ejemplo en panel admin (todos los logs):**
```
Device: SIM001
Command: GET_LOG_DATA
Parameters: {}
```

**Ejemplo (rango específico):**
```
Device: SIM001
Command: GET_LOG_DATA
Parameters: {
  "begin_time": "20260720000000",
  "end_time": "20260729235959"
}
```

**Respuesta cruda del dispositivo:**
```json
{
  "log_count": "64",
  "one_log_size": "12",
  "log_array": "BIN_1"
}
```

Nota: `log_count` y `one_log_size` llegan como **strings**, no como números —
a diferencia de `user_id_count`/`one_user_id_size` de `GET_USER_ID_LIST`, que sí
llegan numéricos. Es una inconsistencia real del firmware, no un error de esta
documentación.

Igual que en `GET_USER_ID_LIST`, `"BIN_1"` es un placeholder. El servidor
decodifica el binario automáticamente y agrega `logs`, un array con cada
marcación ya legible:

```json
{
  "log_count": "64",
  "one_log_size": "12",
  "log_array": "BIN_1",
  "log_array_size": 768,
  "logs": [
    {"user_id": "1", "verify_mode": "1", "io_mode": 0, "io_time": "20000101071429"},
    {"user_id": "1", "verify_mode": "1", "io_mode": 0, "io_time": "20000101071430"}
  ]
}
```

Así se ve directamente en `/admin/commands` al expandir el comando.

**Campos de respuesta:**
| Campo | Tipo | Descripción |
|-------|------|------------|
| `log_count` | string | Total de logs (numérico como texto) |
| `one_log_size` | string | Bytes por registro en el binario — **12**, no 64 |
| `log_array` | string | Placeholder `"BIN_1"`, referencia al binario adjunto |
| `log_array_size` | number | **Agregado por el servidor.** Tamaño real en bytes |
| `logs` | array | **Agregado por el servidor.** Cada marcación ya decodificada: `user_id`, `verify_mode`, `io_mode`, `io_time` |

**Cómo se decodifica (`decodeLogData` en [lib/protocol.ts](../lib/protocol.ts)):**
Cada registro ocupa **12 bytes** (no 64 — ese número era una suposición previa
sin verificar). Estructura confirmada byte a byte contra 64 registros reales
del dispositivo `2023081133`, cruzando contra los mismos logs ya capturados
por `realtime_glog`:

```
bytes 0-3   user_id, uint32 little-endian
byte  4     reservado (siempre 1 en las capturas)
byte  5     io_mode
byte  6     verify_mode
byte  7     segundos (0-59, byte crudo)
bytes 8-11  fecha/hora empaquetada en bits (uint32 LE):
              bits 0-1   reservado (siempre 01)
              bits 2-7   año - 1964
              bits 8-11  reservado (siempre 0001)
              bits 12-15 mes
              bits 16-20 día
              bits 21-25 hora (repartida en dos tramos de bits)
              bits 26-31 minuto
```

Los 64 registros decodificados coincidieron exactamente (usuario, modo,
fecha/hora completa hasta el segundo) contra los logs ya conocidos por
`realtime_glog`. Los bits marcados "reservado" nunca variaron en la muestra
(4 años distintos probados: 2000, 2015, 2025, 2026), pero con un solo
dispositivo de referencia podrían tener un significado que esta muestra no
llegó a activar — no se les asume un valor por decoración.

**Notas:**
- Puede retornar MUCHA data (>100MB para un año completo)
- Se **fragmenta automáticamente** en bloques de 8KB
- El servidor ensambla automáticamente los bloques
- Muy útil para sincronización con servidores centrales
- Mejor hacerlo en horario de poco uso

---

### CLEAR_LOG_DATA
**Descripción:** Elimina TODOS los logs de asistencia del dispositivo

**Parámetros JSON:** (vacío)
```json
{}
```

**Ejemplo en panel admin:**
```
Device: SIM001
Command: CLEAR_LOG_DATA
Parameters: {}
```

**Respuesta esperada:**
```json
{"status": "ok"}
```

**⚠️ Advertencia CRÍTICA:**
- **Esta acción es irreversible**
- Borra TODOS los logs de asistencia del dispositivo
- Se recomienda FUERTEMENTE hacer backup con GET_LOG_DATA primero
- Es normal hacerlo después de sincronizar logs con servidor central
- Libera espacio en memoria del dispositivo

**Recomendación:** Siempre hacer esto:
1. GET_LOG_DATA (backup a servidor)
2. Verificar que los logs llegaron correctamente
3. Recién entonces CLEAR_LOG_DATA

---

## Gestión de datos biométricos completa

### CLEAR_ENROLL_DATA
**Descripción:** Elimina TODOS los datos biométricos del dispositivo

**Parámetros JSON:** (vacío)
```json
{}
```

**Ejemplo en panel admin:**
```
Device: SIM001
Command: CLEAR_ENROLL_DATA
Parameters: {}
```

**Respuesta esperada:**
```json
{"status": "ok"}
```

**⚠️ Advertencia CRÍTICA:**
- **Esta acción es irreversible**
- Borra TODOS los fingerprints, contraseñas, rostros, tarjetas ID
- **Los usuarios siguen existiendo pero sin datos biométricos**
- No se pueden hacer marcaciones sin re-registrar biométricos
- Útil después de migración masiva a nuevo sistema

**Casos de uso:**
- Actualización masiva de firmware
- Migración de datos a servidor central
- Limpieza de datos corruptos
- Reset completo del dispositivo

---

### GET_USER_ID_LIST
**Descripción:** Obtiene un listado de usuarios registrados — **no todos, ver advertencia**

> ## ⚠️ No enumera todos los usuarios — verificado contra hardware real
>
> **Dispositivo `2023081133`, 2026-08-18:** `GET_DEVICE_STATUS` reportó
> `total_user_count: 6` (`user_count: 3` + `manager_count: 3`), pero este
> comando, consultado en el mismo momento, devolvió solo 3 IDs — exactamente
> los 3 con privilegio `MANAGER` (que también son, en esta muestra, los 3
> únicos con huella enrolada). Se confirmó con `GET_USER_INFO` directo que
> los 3 usuarios faltantes (privilegio `USER`, sin huella) sí existen de
> verdad en el equipo — simplemente no aparecen en esta lista.
>
> No se pudo determinar si el filtro es por privilegio, por tener biometría
> enrolada, o ambos a la vez (los 3 casos coincidían en esta muestra). Lo
> que sí queda confirmado: **este comando no sirve como fuente de verdad de
> "qué usuarios existen".** No lo uses para decidir si un `user_id` está
> libre (usa `GET_USER_INFO` sobre ese ID puntual) ni para podar una caché
> local de usuarios que ya no están (una versión anterior del panel lo hacía
> y borraba cuentas reales que seguían existiendo en el equipo).

**Parámetros JSON:** (vacío)
```json
{}
```

**Ejemplo en panel admin:**
```
Device: SIM001
Command: GET_USER_ID_LIST
Parameters: {}
```

**Respuesta cruda del dispositivo:**
```json
{
  "user_id_count": 3,
  "one_user_id_size": 8,
  "user_id_array": "BIN_1"
}
```

`user_id_array: "BIN_1"` es solo un placeholder — apunta al bloque binario
adjunto, no son los IDs en sí. El servidor lo decodifica automáticamente antes
de guardarlo, y agrega el campo `user_ids` con la lista legible:

```json
{
  "user_id_count": 3,
  "one_user_id_size": 8,
  "user_id_array": "BIN_1",
  "user_ids": ["1", "2", "3"]
}
```

Así se ve directamente en `/admin/commands` al expandir el comando — no hace
falta decodificar nada a mano.

**Campos de respuesta:**
| Campo | Tipo | Descripción |
|-------|------|------------|
| `user_id_count` | number | Total de usuarios |
| `one_user_id_size` | number | Bytes por registro de usuario en el binario |
| `user_id_array` | string | Placeholder `"BIN_1"`, referencia al binario adjunto |
| `user_ids` | string[] | **Agregado por el servidor.** Lista de IDs ya decodificados |

**Cómo se decodifica (`decodeUserIdList` en [lib/protocol.ts](../lib/protocol.ts)):**
Cada usuario ocupa `one_user_id_size` bytes en el binario; el ID son los
primeros 4 bytes como `uint32` little-endian. Verificado contra el firmware
`WS535BW1_BSCS_v1.5.31` cruzando con los `user_id` en texto plano ("1", "2")
que el mismo equipo manda en `realtime_glog`:

```
01 00 00 00 01 01 08 00   → usuario 1
02 00 00 00 02 01 08 00   → usuario 2
03 00 00 00 01 01 08 00   → usuario 3
```

Los 4 bytes restantes de cada registro varían de forma que no coincide con
privilegio ni con los conteos de `GET_DEVICE_STATUS` — su significado no está
confirmado, así que solo se decodifica el ID.

**Notas:**
- Puede ser >25KB (se fragmenta automáticamente)
- Útil para sincronización de usuarios con servidor central
- No incluye nombre ni privilegio — usar `GET_USER_INFO` por cada ID
- Para obtener datos usar GET_USER_INFO por cada usuario

---

## Resumen de uso en panel admin

### Template: Cómo usar cada comando

Todos los comandos se usan igual en el panel admin:

1. Accede a `http://localhost:3000/admin/commands`
2. Selecciona **Device:** (el dispositivo)
3. Selecciona **Command:** (de la lista)
4. Escribe **Parameters:** (JSON)
5. Haz clic en **"Queue Command"**
6. Ve a `/admin/commands` para ver el estado (WAIT → RUN → RESULT)

### Tabla rápida de referencia

| Comando | Tipo | Parámetros mínimos | Ejemplo |
|---------|------|-------------------|---------|
| GET_DEVICE_STATUS | Info | `{}` | `{}` |
| SET_FK_NAME | Config | fk_name | `{"fk_name":"Puerta 1"}` |
| SET_TIME | Config | time | `{"time":"20260729143000"}` |
| SET_USER_NAME | Usuario | user_id, user_name | `{"user_id":"U1","user_name":"Juan"}` |
| SET_USER_PRIVILEGE | Usuario | user_id, user_privilege | `{"user_id":"U1","user_privilege":"MANAGER"}` |
| DELETE_USER | Usuario | user_id | `{"user_id":"U999"}` |
| GET_USER_INFO | Usuario | user_id | `{"user_id":"U1"}` |
| SET_USER_INFO | Usuario | user_id, user_name, user_privilege | `{"user_id":"U2","user_name":"María","user_privilege":"USER"}` |
| GET_ENROLL_DATA | Biometría | user_id, backup_number | `{"user_id":"U1","backup_number":0}` |
| SET_ENROLL_DATA | Biometría | user_id, backup_number, enroll_data | `{"user_id":"U1","backup_number":0}` |
| GET_LOG_DATA | Logs | (vacío o rango) | `{}` o `{"begin_time":"20260701","end_time":"20260731"}` |
| CLEAR_LOG_DATA | Logs | `{}` | `{}` |
| GET_USER_ID_LIST | Listado | `{}` | `{}` |
| CLEAR_ENROLL_DATA | Biometría | `{}` | `{}` |

---

## Ejemplos prácticos completos

### Caso 1: Crear un nuevo usuario desde cero

```
Step 1: Crear usuario básico
  Device: SIM001
  Command: SET_USER_INFO
  Parameters: {
    "user_id": "U_NUEVO_001",
    "user_name": "Pedro González",
    "user_privilege": "USER"
  }
  → Estado: WAIT → RUN → RESULT ✓

Step 2: Asignar datos biométricos
  (Esto requiere captura real del dispositivo)
  Device: SIM001
  Command: SET_ENROLL_DATA
  Parameters: {
    "user_id": "U_NUEVO_001",
    "backup_number": 0
  }
  + datos binarios del fingerprint

Step 3: Verificar
  Device: SIM001
  Command: GET_USER_INFO
  Parameters: {"user_id": "U_NUEVO_001"}
  → Debería retornar usuario con enroll_data_array
```

### Caso 2: Sincronizar datos con servidor central

```
Step 1: Obtener todos los usuarios
  Device: SIM001
  Command: GET_USER_ID_LIST
  Parameters: {}
  → Retorna lista de IDs (fragmentado si >25KB)

Step 2: Para cada usuario, obtener detalles
  Device: SIM001
  Command: GET_USER_INFO
  Parameters: {"user_id": "U001"}
  
  Device: SIM001
  Command: GET_USER_INFO
  Parameters: {"user_id": "U002"}
  
  ... etc

Step 3: Obtener todos los logs
  Device: SIM001
  Command: GET_LOG_DATA
  Parameters: {}
  → Retorna fragmentado en bloques de 8KB

Step 4: Guardar en servidor central y limpiar
  Device: SIM001
  Command: CLEAR_LOG_DATA
  Parameters: {}
  ✓ Logs borrados del dispositivo
```

### Caso 3: Actualizar privilegios masivos

```
Cambiar múltiples usuarios de USER a OPERATOR:

  Device: SIM001
  Command: SET_USER_PRIVILEGE
  Parameters: {"user_id": "U050", "user_privilege": "OPERATOR"}

  Device: SIM001
  Command: SET_USER_PRIVILEGE
  Parameters: {"user_id": "U051", "user_privilege": "OPERATOR"}

  Device: SIM001
  Command: SET_USER_PRIVILEGE
  Parameters: {"user_id": "U052", "user_privilege": "OPERATOR"}
  
  ... (repetir para cada usuario)
```

---

## Notas importantes

### Formato de fechas
- Siempre usar: **YYYYMMDDhhmmss**
- Ejemplo: 2026-07-29 14:30:45 → `20260729143045`
- Validación: El servidor verifica que sea fecha válida

### Fragmentación automática
- Resultados >8192 bytes se fragmentan automáticamente
- El servidor ensambla bloques automáticamente
- En panel admin verás estado normal (RESULT) cuando esté completo

### Errores comunes
- ❌ `{"time":"20260729"}` → Falta formato completo (needs hhmmss)
- ❌ `{"user_id":"U1","user_name":""}` → Nombre vacío rechazado
- ❌ `{"user_privilege":"admin"}` → Debe ser MANAGER, REGISTER, OPERATOR o USER
- ✅ Usar siempre comillas dobles en JSON
- ✅ Validar JSON antes de enviar (uso de validador JSON online)

### Mejores prácticas
1. **Antes de DELETE_USER o CLEAR_LOG_DATA:** hacer backup con GET
2. **Sincronizar SET_TIME** al menos diariamente
3. **Limpiar logs regularmente** para evitar que se llene la memoria
4. **Usar MANAGER privilege** solo para administradores
5. **Validar respuestas** en `/admin/traffic` para debugging

---

## Soporte

Para más detalles técnicos, ver:
- [README.md](../README.md) — Arquitectura general
- [04-device-protocol-real.md](04-device-protocol-real.md) — Protocolo verificado contra hardware
- `/admin/traffic` — Inspector de tráfico HTTP
- `/admin/logs` — Logs de asistencia
- `scripts/e2e.ts` — Ejemplos de uso en código
