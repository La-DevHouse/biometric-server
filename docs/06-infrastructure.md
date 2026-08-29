# Infraestructura

Este documento registra las decisiones de infraestructura tomadas para este proyecto, el estado actual (servidor de desarrollo/pruebas) y el plan de migración a producción. Mantenerlo actualizado conforme cambie el estado real. Para la configuración del lado del dispositivo (no del servidor), ver `03-device-network.md`.

## Decisión de arquitectura general

- **Proveedor:** Hetzner Cloud, droplet dedicado y separado del WaaS propio de La Devhouse (no compartir servidor — ver razones abajo).
- **Orquestación:** Coolify (self-hosted), instalado directo sobre el droplet vía Docker.
- **Proxy/edge:** Cloudflare Tunnel — **solo para dashboard/API**, nunca para el puerto de ingesta de dispositivos.
- **CI/CD:** GitHub App de Coolify conectada a `La-DevHouse/biometric-server`, deploy vía Railpack (build automático detectado para Next.js).

### Por qué servidor separado del WaaS propio

- El cliente compró explícitamente "propiedad de software", no un servicio compartido tipo SaaS.
- El puerto de ingesta de dispositivos queda expuesto sin la protección de Cloudflare (ver abajo); aislar el droplet contiene el blast radius si ese puerto se ve comprometido, sin exponer a otros clientes del WaaS.
- Con el retainer de continuidad en negociación (~$10/dispositivo/mes), el costo de un droplet dedicado es marginal frente al ingreso recurrente esperado.

## Estado actual: servidor de desarrollo/pruebas

| Campo           | Valor                                                          |
| --------------- | -------------------------------------------------------------- |
| Proveedor       | Hetzner Cloud                                                  |
| Tipo            | CX23 — Cost-Optimized, x86 (2 vCPU / 4 GB RAM / 40 GB SSD)     |
| Región          | Nuremberg (eu-central)                                         |
| Costo           | ~$6.49/mes                                                     |
| OS              | Ubuntu 26.04                                                   |
| Nombre del host | `grupo-alco-test-ubuntu-4gb-nbg1-1`                            |
| IP pública      | `2.28.70.76` (IP primaria del droplet — **no es Floating IP**) |
| Acceso SSH      | `root@2.28.70.76`, autenticación por key                       |
| Coolify         | Panel en `http://2.28.70.76:8000`                              |

**Este servidor es desechable y temporal.** No debe recibir dispositivos biométricos de clientes reales de ALCO.

### Por qué Nuremberg para desarrollo pero NO para producción

Latencia real medida desde Venezuela (vía `mtr`):

| Destino                                        | Latencia promedio |
| ---------------------------------------------- | ----------------- |
| Nuremberg                                      | ~178–183 ms       |
| Falkenstein                                    | ~189–191 ms       |
| Hillsboro, US-West                             | ~136–140 ms       |
| Ashburn, US-East (inferido vía hop intermedio) | ~85–90 ms         |

Ambas rutas hacia Europa pasan por Ashburn en tránsito antes de cruzar el Atlántico. La diferencia (~2x) afecta la velocidad de entrega/confirmación de comandos (ver `03-device-network.md` — con el modelo de polling corregido, esto ya no afecta "estabilidad de conexión", pero sí responsividad).

**El servidor de producción va en Ashburn (us-east), no en Europa.**

## Plan de migración a producción (pendiente)

Checkpoint obligatorio: **migrar antes de configurar la IP del servidor en el primer dispositivo biométrico real.**

1. Droplet nuevo en Ashburn (us-east), tipo **Regular Performance CPX21** (3 vCPU / 4 GB / 80 GB, ~$37.49/mes) — no hay Cost-Optimized en esa región.
2. Asignar una **Floating IP** (no la IP primaria).
3. Instalar Coolify de cero.
4. Configurar Cloudflare Tunnel para `dashboard-alco`/`api-alco` (dominio propio, no `sslip.io`).
5. Recrear el/los servicio(s) en Coolify.
6. Migrar datos (dump/restore del SQLite, o el mecanismo que corresponda si ya se separó `sync-worker` — ver `02-architecture.md`).
7. Reconfigurar firewall de Hetzner en el servidor nuevo (no se hereda).
8. Solo entonces, apuntar el primer dispositivo real a la Floating IP de producción.

**Resize vs. migración:** cambiar el tamaño de un droplet existente es sin fricción real. Cambiar de región no lo es — requiere snapshot, servidor nuevo, reconfigurar DNS/Tunnel, y una IP nueva. Por eso la región se decide una sola vez.

## Servicios en Coolify (planeados)

| Servicio                             | Estado                 | Notas                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `biometric-server` (monolito actual) | Desplegado (test)      | Ver `02-architecture.md` — a separar en `dashboard-alco`/`sync-worker-alco`                                                                                                                                                                                                                                                                                      |
| `postgres-alco`                      | **Pendiente de crear** | Reemplaza SQLite — ver `02-architecture.md`, sección "Migración de SQLite a Postgres". Contenedor separado, con su propio Persistent Storage para el datadir de Postgres. Conexión desde las apps vía el hostname interno de Docker que expone Coolify — no publicar el puerto de Postgres públicamente, sin necesidad de regla de firewall de Hetzner para esto |

## Networking — el punto más delicado

Coolify pone su propio proxy (Traefik) en 80/443, enrutando por `Host` header. El protocolo del dispositivo no manda ningún `Host` header — es una conexión TCP directa a IP:puerto. Por eso el tráfico de dispositivos **nunca puede pasar por Traefik ni por Cloudflare Tunnel**.

### Solución: puerto dedicado con mapeo directo

Coolify → app → **Networking → Port Mappings**: `PUERTO_HOST:PUERTO_CONTENEDOR`, publicado directo por Docker, sin pasar por el proxy.

- **Ports Exposes:** `3000` (puerto interno de Next.js).
- **Port Mappings (test):** `8090:3000` — validado funcionando (`curl -I http://2.28.70.76:8090` → 200 OK directo).
- **Puerto de producción: aún no decidido.** Una vez fijado, no debe cambiar (queda configurado en cada dispositivo — ver `03-device-network.md`). Decidir con intención antes del Hito 2 y actualizar esta tabla en cuanto se decida.

### Firewall de Hetzner (Cloud Firewall) — estado en servidor de test

| Puerto      | Protocolo | Propósito                                  | Notas                                                                                                                        |
| ----------- | --------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 22          | TCP       | SSH                                        | Restringir a IPs del equipo en producción                                                                                    |
| 80          | TCP       | HTTP (Traefik → dashboard/API)             |                                                                                                                              |
| 443         | TCP       | HTTPS (Traefik → dashboard/API)            |                                                                                                                              |
| 8000        | TCP       | Panel de Coolify                           | Restringir a IPs del equipo                                                                                                  |
| 8090 (test) | TCP       | Ingesta de dispositivos, bypass de Traefik | Sin protección de Cloudflare — mitigar con whitelist de IPs si el rango de las sedes es predecible, o rate-limiting/fail2ban |

Outbound: sin restricciones.

**Recordatorio:** repetir esta configuración en el servidor de Ashburn — no se hereda al migrar.

## Alternativas de proveedor consideradas y descartadas

- **DigitalOcean Basic Droplets:** specs comparables más baratas en algunos tiers. No adoptado — Hetzner ya funcionaba y la diferencia no justificó el cambio a mitad de desarrollo.
- **Self-host en hardware propio de Grupo ALCO:** descartado — la inestabilidad de energía/internet en Venezuela haría que un corte local tumbe la plataforma completa para las 40 empresas cliente a la vez.
- **Oracle Cloud Free Tier / Contabo / OVH:** evaluados, no adoptados — riesgos de estabilidad/soporte no justifican el ahorro frente al retainer ya negociado.
