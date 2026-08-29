# Conectividad del dispositivo en producción

Este documento cubre la capa de **red/infraestructura** de la comunicación con el dispositivo — no el formato de bytes del protocolo (eso está en `04-device-protocol-real.md`) ni el catálogo de comandos (`05-commands-catalog.md`). Es lo que hay que saber para desplegar esto contra las ~40 sedes de clientes de Grupo ALCO, sobre redes que La Devhouse no controla.

## Modelo de conexión — corregido

**El dispositivo no mantiene una conexión TCP persistente con el servidor.** Habla HTTP/1.0 con `Connection: close`, y hace **poll cada ~11 segundos** (verificado empíricamente contra hardware real, firmware `WS535BW1_BSCS_v1.5.31` — ver `05-commands-catalog.md`), abriendo una conexión nueva en cada poll.

Esto es mejor de lo que se había asumido en una sesión de planificación de infraestructura anterior a la verificación contra hardware real: se había diseñado un esquema de `SO_KEEPALIVE` + ping de aplicación pensando en sostener un socket persistente contra timeouts de NAT. **Ese trabajo no es necesario.** Sin conexión persistente, no hay nada que "mantener vivo" — cada poll es independiente. Si un poll puntual falla (por ejemplo, por un timeout de NAT agresivo en la red de una sede), el dispositivo simplemente reintenta ~11 segundos después, sin intervención del servidor. El modelo de polling es intrínsecamente resiliente a cortes de red intermitentes, que es exactamente el escenario esperado en las sedes de los clientes de ALCO (Venezuela).

**Lo que sí sigue siendo relevante:**

- La **latencia** del servidor (ver `06-infrastructure.md`, Ashburn vs. Europa) afecta qué tan rápido se entrega/confirma cada comando individual, no la estabilidad de una conexión de largo plazo.
- **Validar en campo, no solo en LAN:** todo lo verificado hasta ahora (`04-device-protocol-real.md`) fue contra una red local controlada. El comportamiento de reconexión bajo condiciones WAN reales (latencia alta, cortes intermitentes, NAT de un ISP real) no está confirmado — validar contra un dispositivo en una sede real antes de dar por cerrado el Hito 2.
- La cola de comandos (`commands` en la base de datos) ya maneja bien este modelo: un comando queda en `WAIT` hasta el próximo poll del dispositivo que lo recoja — no requiere que el dispositivo esté "conectado" en un sentido persistente.

## Configuración requerida en el dispositivo — en este orden

### 1. `Net Mode` → `Internet` (no `Local`)

Menú: `Comm Set → 2. TCP/IP → 3. Net Mode → Internet`

**Crítico y fácil de pasar por alto.** En modo `Local`, el dispositivo es un servidor pasivo y **ignora por completo el campo de IP/puerto del servidor** (el manual del fabricante lo dice explícitamente: _"Useless in local network"_). Un dispositivo en este modo nunca va a aparecer conectado, sin importar qué tan bien esté configurada la infraestructura del lado del servidor — no es un problema de red, es un problema de configuración del equipo. Ver el caso documentado en `04-device-protocol-real.md` ("dispositivo mudo") para el diagnóstico completo de este síntoma.

### 2. IP y puerto del servidor

Menú: `Comm Set → 2. TCP/IP → 2. Server Set`

- **IP:** la IP pública del servidor (Floating IP en producción — ver `06-infrastructure.md`). El firmware puede mostrar los octetos con padding de ceros en su UI (ej. `002.028.070.076`) — es cosmético.
- **Puerto:** el puerto dedicado de ingesta (bypass de Traefik — ver `06-infrastructure.md`). **No confundir con el puerto propio del dispositivo** (algunos equipos exponen un puerto de administración local, ej. 5005, que es irrelevante para esta configuración).
- **DNS:** desactivado — se apunta a una IP literal, no a un hostname.

**Implicación operativa:** la IP y el puerto quedan quemados físicamente en cada dispositivo desplegado en campo. Cambiarlos después implica re-tocar cada equipo manualmente in situ (no hay comando remoto para reconfigurar esto — confirmado en `04-device-protocol-real.md`). De ahí la importancia de fijar la Floating IP y el puerto de producción con intención, antes de desplegar el primer dispositivo real de un cliente.

### 3. Sincronizar reloj (`SET_TIME`)

El reloj del dispositivo arranca en el año 2000 de fábrica. Encolar `SET_TIME` con parámetros vacíos (`{}`) — el servidor estampa la hora en el momento de la entrega, no en el momento de encolar, evitando el desfase de ~10s que se acumula esperando el próximo poll. Ver `05-commands-catalog.md` para el detalle verificado.

## Herramientas de diagnóstico disponibles

Si un dispositivo no aparece conectado, antes de asumir que es un problema de red:

- **`npm run sniffer`** — proxy TCP transparente que muestra los bytes exactos intercambiados en ambas direcciones. Útil para confirmar si el tráfico está llegando y en qué formato.
- **`npm run handshake-probe`** — servidor TCP crudo que le habla primero al dispositivo, para el caso en que el equipo espere un saludo del servidor antes de hablar (no aplica al modelo HTTP normal, pero fue clave para descartar hipótesis en el caso "dispositivo mudo").

Ver `04-device-protocol-real.md`, sección "Caso real: dispositivo mudo", para el checklist completo de diagnóstico ya recorrido — incluye qué causas se descartaron y con qué evidencia, para no repetir ese trabajo.
