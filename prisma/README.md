# prisma/ — schema y migraciones

Fuente de verdad del schema: `schema.prisma`. Las migraciones las maneja
`prisma migrate` (reemplaza el `addColumnIfMissing` ad-hoc del viejo `lib/db.ts`).

Estado: **PR1 hecho** — las 8 tablas de protocolo, en 2 migraciones:

| Migración | Contenido |
| --- | --- |
| `20260830151045_protocol_baseline` | Las 8 tablas (bigint millis, `ux_attendance_natural` UNIQUE, sin FKs). Generada por `prisma migrate dev`. |
| `20260830151600_protocol_check_constraints` | Los `CHECK` de `commands.status`, `operations.stage`, `raw_traffic.direction` (SQL crudo, Prisma no los expresa — ver `docs/08-data-model.md` §6). |

Los modelos de dominio (`docs/08-data-model.md` §4) llegan en una migración
`0003` (PR3).

## Levantar la base localmente

```bash
cp .env.example .env            # si no existe
docker compose up -d db         # Postgres local en el puerto 55432
npm run db:migrate:deploy       # aplica las 2 migraciones
```

`docker compose down` detiene; `docker compose down -v` además borra los datos.

## Comandos habituales

| Comando | Qué hace |
| --- | --- |
| `npm run db:migrate` | `prisma migrate dev` — crea/aplica migraciones en desarrollo |
| `npm run db:migrate:deploy` | `prisma migrate deploy` — aplica pendientes (CI / arranque de contenedor) |
| `npm run db:generate` | regenera el cliente (`postinstall` ya lo corre) |
| `npm run db:studio` | GUI de la base |

## Agregar SQL que Prisma no expresa (CHECK, triggers, unique parcial)

Flujo correcto (el orden importa):

```bash
npx prisma migrate dev --create-only --name algo   # genera la carpeta SIN aplicar
# editar el migration.sql: agregar el ALTER TABLE / CREATE TRIGGER / etc.
npx prisma migrate dev                              # ahora sí aplica
```

Si ya se aplicó una migración y hay que sumar SQL crudo, va en una **migración
nueva** — no se edita una migración ya aplicada (rompe el checksum de
`_prisma_migrations`).

## Notas de diseño (no cambiar sin leer `docs/02-architecture.md`)

- Timestamps `*_at` son `BigInt` epoch-millis. `lib/db.ts` (tras PR2) registra
  `pg.types.setTypeParser(20, Number)` para que vuelvan como `number`.
- Sin foreign keys en las tablas de protocolo — los handlers realtime insertan
  sin garantizar orden. Las FKs protocolo↔dominio se agregan en `0003`, solo
  donde las gestiona el admin.
- Producción: `prisma migrate deploy` corre al arrancar el contenedor contra el
  servicio `postgres-alco` de Coolify (`docs/06-infrastructure.md`).
- Puerto local 55432 (no 5432) para no chocar con otros Postgres en la máquina.
