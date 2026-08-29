# Handoff para Claude Code — reorganización y reconciliación de documentación

## Qué acabas de recibir

- `CLAUDE.md` (nuevo bloque, para fusionar con el `CLAUDE.md` existente — que hoy solo contiene `@AGENTS.md`, así que en este caso puedes simplemente agregar el contenido nuevo debajo de esa línea).
- `docs/00-index.md`, `docs/01-requirements.md`, `docs/02-architecture.md`, `docs/03-device-network.md`, `docs/06-infrastructure.md` — documentación nueva.
- Este `HANDOFF.md`.

**No se te entregó contenido nuevo para `docs/04-*` ni `docs/05-*`** — esos números están reservados para dos archivos que ya existen en el repo y solo necesitan renombrarse (ver paso 1). No los reescribas ni regeneres.

## Pasos a seguir, en orden

### 1. Reorganizar archivos existentes (renombrar, no reescribir)

```bash
git mv docs/CONEXION_DISPOSITIVO_REAL.md docs/04-device-protocol-real.md
git mv docs/COMANDOS.md docs/05-commands-catalog.md
```

Si dentro de esos dos archivos hay links relativos entre ellos (ej. `[COMANDOS.md](COMANDOS.md)`) o hacia ellos desde otros archivos (`README.md`, `CLAUDE.md`, `AGENTS.md`, o entre sí), actualízalos para reflejar los nuevos nombres.

Elimina la copia duplicada del README:

```bash
git rm docs/README.md
```

(el `README.md` del root se queda, es el canónico — confirma que su contenido sigue siendo válido antes de borrar la copia, por si divergieron en algún punto).

### 2. Corrige la sección desactualizada del README raíz

En `README.md` (root), sección "🔌 Protocolo HTTP Push" → "Body del protocolo": describe el formato como JSON + binarios concatenados sin framing, y dice `TODO: Implementar parsing de tamaños si se tiene especificación completa del protocolo` como si fuera un problema abierto. **Ya no lo es** — `docs/04-device-protocol-real.md` (antes `CONEXION_DISPOSITIVO_REAL.md`) documenta el formato real (bloques con prefijo de longitud `uint32` little-endian) y el código ya lo implementa en `lib/protocol.ts`.

Corrige solo esa sección puntual (y la nota en "📋 Notas de implementación" → "Limitaciones y trade-offs", punto 1, que tiene el mismo TODO obsoleto) para que apunten a `docs/04-device-protocol-real.md` en vez de describir el formato como sin resolver. No reescribas el resto del README — el resto sigue siendo válido (confirmado: la explicación de por qué usan `sqlite3` en vez de `better-sqlite3` sigue vigente y correcta).

### 3. Verifica antes de confiar: la instrucción de `AGENTS.md`

`AGENTS.md` dice que esta versión de Next.js tiene "breaking changes" respecto al conocimiento de entrenamiento, e instruye leer `node_modules/next/dist/docs/` antes de escribir código. **Confirma si esa ruta existe de verdad y contiene documentación real** (`ls node_modules/next/dist/docs/` o equivalente) antes de depender de ella. Si no existe o está vacía, la instrucción puede ser un artefacto de una sesión anterior sin validar — repórtalo, no lo sigas ciegamente ni lo borres sin decírselo al desarrollador.

### 4. Verifica el estado real del código contra lo documentado

Los documentos nuevos (`docs/02-architecture.md`, `docs/03-device-network.md`) describen el código según lo reportado en conversaciones de planificación, no verificado línea por línea contra el repo real. Antes de continuar cualquier trabajo, confirma:

- ¿`lib/db.ts` tiene `PRAGMA journal_mode=WAL` ya activado, o sigue pendiente? (`docs/02-architecture.md` lo marca como prerequisito antes de separar procesos — si ya no van a separar procesos en el corto plazo, no es bloqueante, pero hay que saber el estado real).
- ¿Ya existe algún avance hacia la separación `dashboard-alco`/`sync-worker-alco`, o sigue siendo 100% monolito?
- ¿Los nombres de módulos (`lib/handlers/index.ts`, `lib/handlers/protocol-handlers.ts`, `lib/protocol.ts`, `lib/db.ts`) coinciden exactamente con la estructura real?

Corrige `docs/02-architecture.md` si algo no coincide.

### 5. Continúa el trabajo real, en orden de bloqueo

1. **Migrar de SQLite a Postgres** (`docs/02-architecture.md`, sección "Pendiente: migración de SQLite a Postgres") — decisión ya tomada por el negocio, ejecución pendiente. Hazlo antes del punto 2 si vas a abordar ambos: evita construir el mecanismo de volumen compartido de SQLite (WAL + Persistent Storage montado en dos contenedores) para luego descartarlo al migrar a Postgres, que no tiene ese problema.
2. Ejecutar la extracción de `sync-worker.ts` descrita en `docs/02-architecture.md` — mecánica dado que la capa de negocio ya es agnóstica de framework.
3. Fijar el puerto de producción para ingesta de dispositivos (hoy solo hay un valor de prueba, `8090`, explícitamente no confirmado para producción — ver `docs/06-infrastructure.md`).
4. Validar el modelo de polling (`docs/03-device-network.md`) contra un dispositivo en una sede real, no solo en LAN — confirmar que el comportamiento de reconexión ~11s se mantiene estable sobre una red WAN real antes de dar el Hito 2 por cerrado.
5. **Investigar y resolver la migración de huellas entre dispositivos** (`docs/02-architecture.md`, sección "Pendiente: migración de huellas entre dispositivos") — confirmado por Grupo ALCO como funcionalidad necesaria, no lograda todavía. Verificar `GET_ENROLL_DATA`/`SET_ENROLL_DATA` contra hardware real con el mismo rigor que ya se aplicó a otros comandos en `docs/05-commands-catalog.md`, y documentar el resultado ahí.

## Regla general para el resto del proyecto

Cada vez que el código cambie de una forma que invalide algo en `/docs`, actualiza el documento correspondiente como parte del mismo cambio. Estos documentos son la fuente de verdad para cualquiera que retome este proyecto sin el contexto completo de las conversaciones de planificación que le dieron origen.
