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
6. **No hay que migrar datos** — el proyecto arranca con Postgres limpio (`02-architecture.md`). Solo hace falta que `prisma migrate deploy` corra al arrancar el contenedor de la app.
7. Reconfigurar firewall de Hetzner en el servidor nuevo (no se hereda).
8. Solo entonces, apuntar el primer dispositivo real a la Floating IP de producción.

**Resize vs. migración:** cambiar el tamaño de un droplet existente es sin fricción real. Cambiar de región no lo es — requiere snapshot, servidor nuevo, reconfigurar DNS/Tunnel, y una IP nueva. Por eso la región se decide una sola vez.

## Servicios en Coolify

| Servicio                             | Estado                 | Notas                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `biometric-server` (monolito actual) | Desplegado (test), **sobre Postgres desde 2026-08-30** | Ver `02-architecture.md` — a separar en `dashboard-alco`/`sync-worker-alco`. Install `npm install`, build `npm run build`, start `npm run start` (= `prisma migrate deploy && tsx server.ts --prod`). `DATABASE_URL` en Environment Variables (build + runtime). |
| `biometric-worker` (a crear)         | **Pendiente de crear** (código listo 2026-09-27) | Worker de sincronización (`docs/10` §5): **misma imagen/repo** que `biometric-server`, otro comando — start `npm run worker` (= `tsx worker/index.ts`). Sin puerto expuesto, sin dominio. Mismas env vars que la app (`DATABASE_URL`) + opcionales `SYNC_FINGERPRINTS_INTERVAL_MIN` (30), `SYNC_ATTENDANCE_CRON` ("0 2 * * *"), `SYNC_TZ` ("America/Caracas"), `SYNC_MAX_REMOVALS_PER_DEVICE` (5), `SYNC_MAX_REMOVALS_PCT` (20). Crea sus tablas en el schema `pgboss` del mismo Postgres. **No migra**: la única que corre `prisma migrate deploy` es la app. Como Coolify no ordena deploys entre servicios, el worker al arrancar espera (reintenta cada 10 s, log `[worker] esperando a que la app aplique N migración(es)`) hasta que `_prisma_migrations` tenga todas las migraciones de su propio código. **Comando de arranque:** el build pack es **Railpack**, que fija el start al construir la imagen — el campo "Start command" de Coolify no alcanza. Setear en el servicio del worker la variable **`RAILPACK_START_CMD=npm run worker`** marcada como **disponible en build**, y *redeploy* (no restart). Sin eso arranca con `npm start` = la app → crash "Could not find a production build". **No** usar `railpack.json` en la raíz: el repo es el mismo que la app y la app arrancaría como worker. Build Command `true` (no necesita `next build`); health check en `:3001/health` (ver "Healthchecks" abajo). Puede correr más de una instancia sin coordinarse (pg-boss + operaciones idempotentes por equipo). |
| `postgres-alco`                      | **Creado en test (2026-08-30)** | Reemplaza SQLite. **`postgres:18-alpine`**, Persistent Storage propio montado en `/var/lib/postgresql` (PG18 cambió el path; Coolify lo maneja). Nota: el `docker-compose.yml` local usa `postgres:18` (Debian), **no** alpine — musl rompe la creación de la *shadow database* que necesita `prisma migrate dev`. Prod solo corre `prisma migrate deploy` (sin shadow DB), así que alpine anda bien ahí. El SQL de las migraciones es idéntico. **Public access: Private**, SSL Disabled. Conexión por el hostname interno de Docker (`d0l2qvobp9zmvdvmqx7fyvzq`) vía `DATABASE_URL` = `postgresql://postgres:…@<host-interno>:5432/postgres?schema=public&sslmode=disable`. La app corre `prisma migrate deploy` al arrancar (idempotente). Migración baseline aplicada y verificada (8 tablas de protocolo + `_prisma_migrations`). Local: `docker-compose.yml` levanta un Postgres equivalente en el puerto `55432`. **Pendiente:** rehacer todo esto en el server de producción (Ashburn). |

**Memoria en build (2026-09-27):** un `npm install` del worker murió por OOM (`Killed` / `cannot allocate memory`) en el CX23 de 4 GB (Coolify + `postgres-alco` + app + builder). El primer build había pasado; los siguientes fallaron mientras el worker estaba en crash-loop (arrancaba con `npm start` por el start command mal fijado, reintentando migrate + Next sin parar) y, posiblemente, en paralelo con el build de la app. Mitigación: **frenar el servicio en crash-loop antes de redeployar**, **Concurrent Builds = 1** en el servidor de Coolify (el mismo push dispara ambos deploys) y **swap de 4 GB** en el host (`/swapfile`, `vm.swappiness=10`) como colchón. Install/Build se configuran por los campos de Coolify (funcionan con Railpack; `npm ci` en Install Command si se quiere instalar desde el lockfile); **solo el start** necesita `RAILPACK_START_CMD`. **Aplica igual a Ashburn** (CPX21, también 4 GB).

**Healthchecks (2026-09-27).** Coolify los usa al desplegar: si el contenedor nuevo no queda sano, no reemplaza al viejo.

| Servicio | Endpoint | Configuración en Coolify (Health Check) | Sano cuando |
| --- | --- | --- | --- |
| App (`biometric-server`) | `GET /api/health` (`app/api/health/route.ts`) — público, exceptuado en `proxy.ts` | Enabled · GET · http · host `localhost` · port `3000` · path `/api/health` · return code `200` · **start period 90 s** (arranca con `prisma migrate deploy` + Next) · interval 30 s · timeout 5 s · retries 3 | El proceso responde y la base contesta un `SELECT 1` en < 2 s (si no, 503) |
| Worker (`biometric-worker`) | `GET /health` en `WORKER_HEALTH_PORT` (default `3001`, `worker/health.ts`) | **Ports Exposes `3001`** (sin dominio, sin port mapping público) · Enabled · GET · http · `localhost` · port `3001` · path `/health` · `200` · start period 30 s · interval 30 s · timeout 5 s · retries 3 | Proceso vivo, estado `waiting_migrations`/`starting`/`running` y la base contesta. **Esperar migraciones cuenta como sano** a propósito (es lo normal mientras la app nueva migra). El último error de pg-boss se ve en la respuesta, sin marcarlo caído |

El healthcheck de Coolify corre `curl` (o `wget`) **dentro** del contenedor. Si
el log del deploy dice que no los encuentra, agregar en ambos servicios la
variable de build **`RAILPACK_DEPLOY_APT_PACKAGES=curl`** (Railpack la instala en
la imagen final) y redeployar. El tráfico de los equipos no cambia: `/api/health`
es una ruta HTTP más del mismo puerto.

**Nota operativa:** el terminal web de Coolify para el servicio de BD es inestable (WebSocket detrás del proxy). Para `psql`, entrar por SSH al server: `ssh root@<ip>` → `docker exec -it <container> psql -U postgres -d postgres`.

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
