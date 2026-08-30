@AGENTS.md

# Grupo ALCO — Plataforma de Control de Asistencia

## Qué es este proyecto

Fase 1 de una plataforma para Grupo ALCO (empresa de servicios de RRHH en Venezuela, ~40 empresas cliente): gestión remota de dispositivos biométricos de asistencia, con procesamiento de horarios/tardanzas/ausencias y exportación de datos para que ALCO los cargue a su sistema de nómina actual. **No incluye** cálculo de nómina, contratos, ni acceso de las empresas cliente/empleados finales — solo 4 usuarios internos de ALCO. Ver `docs/01-requirements.md` para el alcance completo.

## Documentación del proyecto

Ver `docs/00-index.md` para el índice completo con descripción de cada documento. Resumen:

| #   | Documento                         | Contenido                                                                        |
| --- | --------------------------------- | -------------------------------------------------------------------------------- |
| 01  | `docs/01-requirements.md`         | Alcance contractual de Fase 1                                                    |
| 02  | `docs/02-architecture.md`         | Estado del código, stack ya decidido, plan de separación en servicios            |
| 03  | `docs/03-device-network.md`       | Conectividad de red con el dispositivo en producción                             |
| 04  | `docs/04-device-protocol-real.md` | Protocolo verificado contra hardware real (antes `CONEXION_DISPOSITIVO_REAL.md`) |
| 05  | `docs/05-commands-catalog.md`     | Catálogo de comandos con gotchas verificados (antes `COMANDOS.md`)               |
| 06  | `docs/06-infrastructure.md`       | Hetzner, Coolify, networking, plan de migración a producción                     |

**Antes de trabajar en este repo, leer `docs/00-index.md` y los documentos relevantes a la tarea.** El código hoy es un monolito Next.js funcional (con simulador, sniffer, tests E2E, panel admin) que debe evolucionar hacia la separación de servicios descrita en `docs/02-architecture.md`.

## Contexto operativo clave (resumen — detalle en /docs)

- **El dispositivo hace polling cada ~11s con conexiones HTTP/1.0 independientes (`Connection: close`), no mantiene un socket persistente.** No se necesita keepalive de conexión — el modelo de polling ya es resiliente a cortes intermitentes. Ver `docs/03-device-network.md`.
- **`Net Mode` del dispositivo debe estar en `Internet`, no `Local`** — en `Local` el equipo ignora la configuración de IP/puerto del servidor por completo. Ver `docs/03-device-network.md`.
- **La IP y el puerto del servidor quedan quemados físicamente en cada dispositivo desplegado.** No hay forma remota de reconfigurarlos. Tratar la región del servidor y el puerto de ingesta como decisiones de una sola vez.
- **El tráfico de dispositivos nunca pasa por Traefik ni por Cloudflare Tunnel** (enrutan por hostname; el dispositivo no manda ninguno). Requiere puerto dedicado con mapeo directo Docker. Ver `docs/06-infrastructure.md`.
- **Servidor de desarrollo está en Nuremberg; producción va en Ashburn** por latencia medida (~2x mejor). No desplegar dispositivos reales contra el servidor de Nuremberg.
- **Migración de SQLite a Postgres: HECHA en código (2026-08-30).** El código corre sobre PostgreSQL + Prisma (`@prisma/adapter-pg`; el hot path del protocolo sigue con SQL crudo vía los 4 helpers de `lib/db.ts`, no modelos Prisma). Schema en `prisma/schema.prisma` + `prisma/migrations/`. Local: `docker compose up -d db` (puerto 55432) + `npm run db:migrate:deploy`. **Falta solo** crear el servicio `postgres-alco` en Coolify y desplegar. No reintrodujo Directus. Ver `docs/02-architecture.md` y `prisma/README.md`.
- **Migración de huellas entre dispositivos: funcionalidad pendiente, confirmada como necesaria por el cliente, no lograda todavía.** Ver `docs/02-architecture.md`.

## Verificar antes de confiar

- `AGENTS.md` instruye leer `node_modules/next/dist/docs/` porque "esta versión de Next.js tiene cambios que rompen el conocimiento previo del modelo". **Verificado (2026-08-29): la ruta existe y es legítima.** Next.js `16.2.12` distribuye la documentación completa dentro del paquete npm — `node_modules/next/dist/docs/` con ~425 archivos `.md` (`01-app/`, `02-pages/`, `03-architecture/`, `04-community/`, `index.md`). La instrucción de `AGENTS.md` es válida: consultar esos `.md` antes de escribir código de Next.
- `README.md` (root): la sección "Body del protocolo" (y el TODO obsoleto en "Limitaciones y trade-offs") **ya fue corregida** — ahora describe el framing de length-prefix y apunta a `docs/04-device-protocol-real.md`.

## Cómo mantener esta documentación

Cuando el código cambie de forma que invalide algo en `/docs`, actualizar el `.md` correspondiente como parte del mismo cambio — no como tarea separada para "después".
