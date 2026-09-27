# Reestructura de dominio + sincronización automática de huellas y asistencia

Estado: **implementado** — PR 1 (estructura de dominio), PR 2 (reconciliador +
worker) y PR 3 (UI) hechos, ver §0. Pendiente: las pruebas con los 2 equipos (T6, T7,
T10–T12, T14).

Fuente: `plan.md` (raíz del repo), que resume la reunión con Ezequiel posterior a la
Reunión 3, más la ronda de decisiones Jesús ↔ equipo del 2026-09-26 (§1). **Si algo
de este doc choca con `07`, `08` o `09`, gana este doc.** En §2 queda qué decía cada
uno antes y qué dice ahora. `07`/`08`/`09` se actualizan cuando se ejecute la
migración (§9), no antes.

---

## 0. Estado de implementación

| PR | Contenido | Estado |
| --- | --- | --- |
| **1** | Migración `20260926200000_company_group_and_site_scope` (§3.1 grupo/empresa/sede/contrato/dispositivo + backfill §3.2 + trigger §3.4) · `lib/scope.ts` (§4.1) · fan-out por alcance en `lib/enrollment.ts` (cubre empresa sin grupo / grupo que no comparte) · CRUD de grupos, empresa con primera sede obligatoria, contrato sin sede, dispositivo asignado solo a sede · tests `__tests__/scope.test.ts` | ✅ 2026-09-26 |
| **2** | Migración `20260927100000_fingerprint_provenance_and_sync` (`device_fingerprint_slot` con backfill desde las huellas existentes, `employee_fingerprint` re-keyed con `finger_index`→`source_backup_number` renombrado sin pérdida, `sync_run`, `sync_hold`, `commands.priority` + `operations.priority` y dequeue por prioridad) · `lib/fingerprints.ts` (ingesta + procedencia + slot libre) · reconciliador `RECONCILE_DEVICE` (`lib/sync/reconcile.ts` + decisión pura `lib/sync/plan.ts`) · pull de asistencia (`lib/sync/attendance.ts`, + `last_sync_at` y `employee_id` por cédula) · worker `worker/index.ts` (`npm run worker`) · disparadores por evento en contratos/empresas/grupos/sedes/dispositivos/`realtime_enroll_data` · "Sincronizar ahora"/"Sincronizar todos" + aprobar/rechazar `sync_hold` en Dispositivos · tests `__tests__/reconcile.test.ts` | ✅ 2026-09-27 |
| **3** | Pestañas Empresa → Empleados / Asistencia · Enrolamiento de solo lectura (`deviceSyncState`: lo que el reconciliador haría hoy) · aviso de impacto (`lib/sync/impact.ts` + `<ImpactPreview>`) en terminar contrato, traslado, compartir empleados, grupo de empresa y sede de equipo · ficha de empleado con estado por equipo y "Sincronizar ahora" · fuera la UI manual de alta/captura/copia de huellas y de vinculación · borrados masivos solo en Diagnóstico con doble confirmación · Asistencia global sale del menú (enlace desde Diagnóstico) | ✅ 2026-09-27 |

**Desvíos del PR 2 respecto de §3–§5:**
- **Sin `employee_device_enrollment.desired`**: el estado deseado se recalcula en
  cada corrida desde el alcance (`lib/scope.ts`); guardarlo era una segunda fuente
  de verdad que podía quedar vieja. La vista de desajustes del PR 3 lo calcula igual.
- **`ADD_EMPLOYEE_TO_DEVICE` vincula en vez de fallar** si la cédula ya existe en el
  equipo (plan.md: vinculación automática por cédula; "no sobreescribir ni borrar
  sus huellas"): nunca `SET_USER_INFO` sobre el existente; ingiere sus huellas y
  solo copia las que falten. El reconciliador usa esta misma operación para
  "completar huellas" de alguien que ya está.
- **Los disparos manuales y por evento no pasan por `pg-boss`**: la app llama
  directo a `startReconcileDevice` (instantáneo e idempotente por equipo). El worker
  solo corre el cron. Mismo resultado, una pieza menos en el camino caliente.
- **Umbral del freno**: se permite hasta `max(SYNC_MAX_REMOVALS_PER_DEVICE, ⌈PCT% ×
  usuarios del equipo⌉)` — así un equipo chico no queda frenado por un solo borrado.
- **La ingesta no guarda el binario de `realtime_enroll_data`**: el evento solo
  dispara la corrida, que relee con `GET_USER_INFO` (forma limpia verificada).

**Desvíos del PR 3 respecto de §6:**
- **"Eliminar usuario" se mantiene** en Usuarios de equipo: la receta de migración de
  IDs viejos (§4.5) necesita borrar a mano el ID que no es cédula. Si el usuario es
  un empleado del alcance, el diálogo avisa que el reconciliador lo volvería a crear.
- **Sin aviso de impacto al desactivar una empresa o un grupo** (botón genérico de
  estado, inline): queda como O12. La red es el freno de borrado masivo.
- **Asistencia global** no se movió de ruta: sale del menú y se llega desde
  Diagnóstico.

**Desvío respecto de §3:** la migración se partió en dos. Las tablas del
reconciliador van con el PR 2 porque solo las consume él; meterlas en el PR 1
obligaba a reescribir dos veces la captura/copia de huellas actuales.

**Backfill real (DB local de desarrollo):** 23 filas-grupo → 23 `company_group`;
23 filas-grupo vacías borradas; 29 empresas con sede "Principal"; horario,
departamento y contrato existentes intactos. En Nuremberg corre el mismo
backfill: una fila-grupo con horarios (u otra cosa) colgando se conserva como
empresa miembro de su grupo, así que no hay pérdida de horarios.

## 1. Decisiones cerradas

| # | Decisión | Origen |
| --- | --- | --- |
| R1 | **Grupo = entidad propia** (`company_group`: `name`, `shared_employees`). No lleva RIF ni razón social. No tiene sedes, dispositivos ni contratos. `client_company.group_id` es nullable: una empresa puede no tener grupo. | plan.md |
| R2 | **Empresa 1 — 1..N Sede.** Una empresa se crea junto con su primera sede, y no puede quedarse sin ninguna sede activa. | plan.md |
| R3 | **Sede 1 — 0..N Dispositivo.** El dispositivo pertenece a una sola sede. La empresa del dispositivo se obtiene de su sede (se elimina `devices.company_id`). | plan.md |
| R4 | **Contrato de trabajo = tabla `employment`** (el nombre de la tabla no cambia; en la UI se llama "Contrato de trabajo"). **No lleva sede**: se elimina `employment.site_id`. | plan.md + Q1, Q4 |
| R5 | `user_id` en el equipo = cédula (ya implementado). El empleado se vincula con el usuario del equipo automáticamente por cédula; no hay paso manual. | plan.md (= `09` D4) |
| R6 | **Alcance** = unión, sobre los contratos activos, de los dispositivos de todas las sedes de la empresa del contrato. Si esa empresa está en un grupo con `shared_employees`, se suman los dispositivos de todas las empresas del grupo. | plan.md |
| R7 | **Reconciliador** (cron cada 30 min, parametrizable, más botón "Sincronizar ahora"): agrega lo que falta y **quita lo que ya no está en el alcance**. | plan.md + punto 7 + Q5 + Q10 |
| R8 | **Salvaguardas del borrado** (F1): solo se tocan cédulas de empleados que existen en el sistema. Un dispositivo sin sede queda congelado. Nunca se borran MANAGER ni OPERATOR. Hay un freno por borrado masivo. La baja es `DELETE_USER` completo. Toda acción de la UI que reduzca el alcance muestra antes su impacto. | F1 |
| R9 | **Registro de procedencia de huellas** por slot de dispositivo (`device_fingerprint_slot`). `employee_fingerprint` deja de identificarse por `(employee, slot)`. | Q6 |
| R10 | Límite de 10 huellas: se propagan **las 10 primeras + alerta** (T9b mostró que no se puede sobrescribir un slot; decisión O8). | Q9 + F4 |
| R11 | **Asistencia = dos crons**: (a) recuperar los marcajes perdidos con `GET_LOG_DATA`, diario, por dispositivo; (b) correr el motor de Hito 4 (`attendance_day`) después de (a). Los dos tienen botón manual. | Q7 |
| R12 | **Atribución de marcajes**: el marcaje crudo pertenece a la empresa **donde se marcó** (la empresa de la sede del dispositivo). El día procesado y la exportación a nómina se imputan al **contrato** del empleado, que tiene el horario. *"Por ahora"*: se puede revisar después. **En pantalla lo reemplaza `11` C4 (2026-09-27):** Empresa → Asistencia muestra las marcaciones **por contrato** (lo mismo que se exporta); "dónde se marcó" queda en Equipo → Marcaciones. | Q8 + F3 |
| R13 | Se conservan en Nuremberg **departamentos y horarios** (`department`, `schedule_group`, `shift`). Nada de empresas ni grupos hace falta preservarlo. **Nunca se borra nada de los biométricos** como efecto de la migración de schema. | Q2 + F2 |
| R14 | El cron corre en un **proceso worker aparte, con la cola de trabajos en Postgres (`pg-boss`)** (§5.1). | F6 |

---

## 2. Conflictos con documentos anteriores (plan.md gana)

| Tema | Decía | Dice ahora |
| --- | --- | --- |
| Qué es un grupo | `07` §1.1, `08` §4.1, `09` D1: fila de `client_company` con `is_group`, más `parent_id` apuntando a la misma tabla, con 2 niveles controlados por un trigger | Tabla propia `company_group`. Se eliminan `parent_id`, `is_group`, el trigger `client_company_two_levels` y el CHECK `is_group OR tax_id` |
| Qué se puede asignar al grupo | `07` §1.1 (ALCO A2): dispositivos y empleados se pueden asignar "a la hoja o al padre" | El grupo no tiene sedes, dispositivos ni contratos. `lib/enrollment.ts` trata hoy la fila raíz como una empresa más: eso desaparece |
| Dónde vive `shared_employees` | Fila del grupo en `client_company` (`09` §7.1 ítem 5) | `company_group.shared_employees`. El valor por defecto sigue siendo `true` |
| Sede en el contrato | `07` §1.4: `employment.site_id` opcional. El filtro "empleados por sede" (`app/admin/empleados/page.tsx:52`) depende de esa columna | Se elimina. **Choca con `09` §3.12**: Ezequiel pidió ver "solo los de Babylon, solo los de Arca", y esos nombres son sedes. Si vuelve a pedirlo, se resuelve con un filtro calculado del tipo "marcó en la sede X", sin cambiar el schema |
| Empresa sin sede | 0..N sedes | 1..N sedes (R2) |
| Dispositivo ↔ empresa | `devices.company_id` y `site_id`, ambos nullable e independientes | Solo `site_id`. En la DB sigue nullable (ver §3.3), y "sin sede" significa pendiente de asignar |
| Vinculación manual | `07` §3 "Enrolamiento" y §5.3: el operador mapea `device_user_id` → empleado | Es automática por cédula. Enrolamiento pasa a ser una vista de solo lectura para detectar desajustes |
| Cuándo se propaga al grupo | `09` §7.1 ítem 6: al activar el contrato, más el botón "re-sincronizar grupo" | Reconciliador periódico que también borra (R7). El alta del contrato solo adelanta una corrida para esa persona |
| Sin grupo o con compartir apagado | `fanOutEmployeeToGroup` no hace nada: **no enrola en ningún dispositivo** | Se enrola en los dispositivos de las sedes de la propia empresa (R6) |
| Qué dispara la propagación | Solo la operación manual `CAPTURE_FINGERPRINT` (`fanOutCapturedFingerprint`) | Que el reconciliador detecte la huella en el dispositivo (§4.3) |
| `employee_fingerprint` | Único por `(employee_id, finger_index)`, con finger_index = slot de origen | Id propio más procedencia por slot (R9). El índice anterior mezcla huellas distintas que quedaron en el mismo número de slot |
| Alta manual en un equipo de otro grupo | `AddEmployeeToDeviceDialog` para "la excepción" (`02`, 2026-09-22) | El reconciliador la borraría en la siguiente corrida. Se elimina (§6). Si Ezequiel necesita excepciones, van por el punto de extensión DT1 (§8 O3) |
| Modelo de negocio heredado del grupo | `09` §7.1 ítem 10 / D18: nullable en la empresa → hereda del grupo → si no, se pide | El grupo no tiene atributos propios (plan.md): **ya no hay herencia**. Nullable en la empresa; se elige en su formulario |
| Exportación "por grupo" | `export_run.scope = group` con `scope_company_id` = raíz del grupo | La raíz ya no es una empresa. Sin cambio de schema hasta el Hito 5 → §8 O10 |
| `employment_status` y el alcance | `07` §5.6: "opcionalmente desactivar sus enrollments" | Obligatorio y automático: cuando termina el contrato se ajusta el alcance y el dispositivo borra al usuario |

Lo que **ya existía** y no es nuevo: la cédula como ID (código `740964a`), el contrato
N:M con datos propios, el flag de compartir en el grupo con `true` por defecto, el
soft-delete, y la receta de migración de huellas (`GET_USER_INFO` 612 B → patch en el
offset 608 → `SET_ENROLL_DATA`).

---

## 3. DB / schema

Se hace **una sola migración Prisma** (siguiendo el ítem 8 de §7.1 de `09`). Solo
existe Nuremberg: **no hay datos de producción**. La migración no toca ningún
dispositivo físico.

### 3.1 Cambios de modelo

| Cambio | Detalle | Reversible |
| --- | --- | --- |
| **+ `company_group`** | `id`, `name`, `shared_employees Boolean @default(true)`, `status record_status`, `created_at`, `updated_at` | Sí |
| `client_company` **+ `group_id Int?`** | FK → `company_group`, `onDelete: Restrict`, con `@@index` | Sí |
| `client_company` **− `parent_id`, `is_group`, `shared_employees`** | Además se hace `DROP TRIGGER client_company_two_levels`, `DROP FUNCTION client_company_enforce_two_levels` y `DROP CONSTRAINT` del CHECK de RIF | **No** (los datos de la jerarquía se pierden; ver 3.2) |
| `client_company.tax_id` | En la DB sigue nullable. **La app lo exige al crear o editar.** Se endurece a NOT NULL en una migración posterior, cuando ya no queden filas de prueba sin RIF | Sí |
| `devices` **− `company_id`** | La empresa se obtiene con `site.company_id`. Hay que ajustar `app/admin/dispositivos/actions.ts`, `[devId]/page.tsx`, `asistencia/page.tsx`, `lookups.ts` y `enrollment.ts` | **No** (se puede reconstruir desde `site_id`) |
| `devices.site_id` | **Sigue nullable en la DB** (§3.3) | — |
| `employment` **− `site_id`** | Hay que ajustar `EmploymentFields.tsx`, `empleados/actions.ts`, `empleados/page.tsx` y `lookups.ts` | **No** (los datos son de prueba) |
| `employee_fingerprint` (**nueva forma**) | Se elimina `@@unique([employee_id, finger_index])`. `finger_index` → `source_backup_number Int?` (solo informativo). Se agregan `captured_at` (ya existe; sirve para ordenar "las 10 más recientes"), `status record_status` y `superseded_by Int?` (para consolidar duplicados, §4.4). Sigue teniendo `id` propio | Sí |
| **+ `device_fingerprint_slot`** | `id`, `dev_id` FK, `device_user_id String`, `backup_number Int` (0–9), `fingerprint_id Int?` FK → `employee_fingerprint`, `origin enum{physical, propagated}`, `state enum{present, pending_write, pending_delete, error}`, `last_seen_at timestamptz`, `last_error String?`. `@@unique([dev_id, device_user_id, backup_number])` | Sí |
| `employee_device_enrollment` | **Se mantiene** como estado de sincronización persona × dispositivo: indica si el usuario existe en el equipo, con qué privilegio y cuándo se sincronizó. Se agregan `last_synced_at timestamptz?`, `device_privilege String?` y `desired enum{present, absent}`. `device_user_id` es siempre la cédula. Se conserva el unique parcial activo | Sí |
| **+ `sync_run`** | Auditoría de cada corrida del reconciliador o de asistencia: `id`, `kind enum{fingerprints, attendance_pull, attendance_compute}`, `trigger enum{cron, manual, event}`, `dev_id?`, `started_at`, `finished_at`, `stats Json`, `actor_app_user_id?` | Sí |
| **+ `sync_hold`** | Freno de borrado masivo (R8): `id`, `dev_id`, `planned_removals Json`, `created_at`, `resolved_at?`, `resolved_by?`, `resolution enum{approved, rejected}?` | Sí |
| `commands` **+ `priority Int @default(100)`** | Tabla de protocolo. El dequeue ([protocol-handlers.ts:79](../lib/handlers/protocol-handlers.ts#L79)) pasa a `ORDER BY priority ASC, created_at ASC`: el panel usa 100, el reconciliador 200. **Es el único cambio al camino crítico (hot path).** Índice `(dev_id, status, priority, created_at)` | Sí |

Los nombres nuevos (`company_group`, `device_fingerprint_slot`, `sync_run`,
`sync_hold`, los enums `origin`/`state`/`desired`) respetan la convención de `08`
§1 (snake_case en inglés, sin `@map`). **Se confirman al revisar el PR de la
migración (§8 O1).**

### 3.2 Backfill (dentro de la misma migración, en orden)

1. **Preflight (se corre a mano en Nuremberg antes de desplegar):** listar las filas
   con `is_group = true` que tengan algo colgando (`site`, `schedule_group`,
   `employment`, `devices`). Por R13, lo que importa preservar son los
   `schedule_group` (horarios).
2. Por cada fila con `is_group = true` → `INSERT company_group (name, shared_employees, status)`.
   Las hijas (`parent_id` = esa fila) reciben `group_id`.
3. **Una fila grupo con dependientes** (en la práctica, horarios) **no se borra**:
   queda como `client_company` miembro de su propio `company_group`, con el mismo
   nombre. Las filas grupo sin dependientes se borran (son datos de prueba).
   **Nunca se hace reset de empresas**: `schedule_group.company_id` tiene
   `onDelete: Cascade`, y un reset se llevaría los horarios que Jesús quiere conservar.
4. Por cada `client_company` sin sede → `INSERT site (company_id, name='Principal')`.
5. `devices` con `company_id` y sin `site_id` → se asigna la sede "Principal" de esa
   empresa. Después se hace `DROP COLUMN company_id`.
6. `employee_fingerprint`: las filas existentes quedan con `status = active`. Se
   genera un `device_fingerprint_slot` con `origin = physical` a partir de
   `source_dev_id` + `finger_index`, solo si `source_dev_id` no es null.
7. `DROP` de columnas, trigger, función y CHECK.

Departamentos, cargos, modelos de negocio y horarios no se tocan (salvo el caso del
paso 3).

### 3.3 Por qué `devices.site_id` no puede ser NOT NULL

El dispositivo **se registra solo** en su primer `receive_cmd` (el `INSERT … ON
CONFLICT` de `handleReceiveCmd`), antes de que alguien lo asigne a una sede. Ponerle
NOT NULL rompería el alta de cualquier equipo nuevo o re-apuntado desde Adempiere. La
regla de plan.md se cumple así:

- En la UI, el dispositivo está "Pendiente de asignar" hasta que tenga sede.
- "Sin sede" significa **congelado**: el reconciliador no lo lee ni le escribe (R8).
  Es la salvaguarda que protege a los equipos recién migrados.

### 3.4 "Empresa con ≥1 sede" en la DB

Se implementa con un **constraint trigger `DEFERRABLE INITIALLY DEFERRED`** en `site`
y `client_company`. Al hacer commit rechaza cualquier empresa `active` sin ninguna
sede `active`. Así se puede crear la empresa y su sede en la misma transacción, y se
impide desactivar la última sede. La UI (§6) también lo valida, para mostrar un error
legible antes de llegar a la DB.

---

## 4. Backend

### 4.1 Función de alcance (`lib/scope.ts`, nueva)

```
applicableDevices(employee) =
  ⋃ contrato activo c:
      empresas = {c.company} ∪ (c.company.group.shared_employees ? empresas activas del grupo : ∅)
      dispositivos de todas las sedes activas de esas empresas
```

Tiene una versión inversa, `employeesInScope(dev_id)`, para rellenar un dispositivo
nuevo o movido. Es **pura (solo SQL de lectura)**: la usan el reconciliador y la
vista previa de impacto de la UI (R8). Un contrato "activo" es `status = active` y
`start_date <= hoy` y (`end_date` null o `end_date >= hoy`).

### 4.2 Reconciliador de huellas: estado deseado vs. estado real, por dispositivo

Una corrida por dispositivo con sede (los que no tienen sede se saltan). Cada corrida
**solo encola operaciones** en la cola `commands` que ya existe, con prioridad 200. La
entrega al equipo sigue siendo por polling. No hay I/O síncrono con el equipo.

1. **Leer el estado real (barato):** `GET_DEVICE_STATUS`. Si `stat_fp_count` y
   `stat_user_count` no cambiaron desde la última corrida, se salta al paso 3.
   *(Depende de que T1 lo valide.)*
2. **Detectar cambios:** `GET_USER_ID_LIST` trae los usuarios con al menos una
   huella. Se compara contra `device_fingerprint_slot`:
   - un usuario nuevo en la lista → `GET_USER_INFO` a ese usuario;
   - el conteo de huellas subió pero la lista no cambió (alguien agregó otro dedo) →
     `GET_USER_INFO` a cada usuario con huella de ese equipo. El costo está acotado.

   Cada slot que no esté en el registro y cuyo `device_user_id` sea una cédula de un
   empleado del sistema → **ingesta**: blob de 612 B → `employee_fingerprint` nueva y
   `device_fingerprint_slot(origin=physical)`. Una cédula desconocida → vista de
   desajustes, sin ingesta.
3. **Calcular el estado deseado:** `employeesInScope(dev)`. Para cada uno, se toman
   sus `employee_fingerprint` activas, las 10 más recientes (R10).
4. **Diferencias:**
   - *Falta el usuario* → `ADD_EMPLOYEE_TO_DEVICE` (sonda + `SET_USER_INFO` sin
     huella + verificación).
   - *Falta una huella* → `PUSH_FINGERPRINT` (`SET_ENROLL_DATA` + verificación) →
     slot `origin = propagated`. Si el equipo responde `DUPLICATED ERROR` → no se
     hace nada, se marca el slot como `present` y se reconcilia la huella (§4.4).
   - *Sobra un usuario* → se pasa por las salvaguardas (4.5) → `DELETE_USER` +
     verificación → `employee_device_enrollment.status = inactive` y se borran sus
     slots del registro.
5. Se escribe `sync_run` con los contadores.

**Idempotencia:** la garantiza el registro de procedencia, no el error del equipo.
Una huella `propagated` nunca se vuelve a ingerir como nueva, lo que corta el ciclo
de ida y vuelta entre equipos. `DUPLICATED ERROR` queda como segunda red de seguridad
si T8b confirma que también salta al escribir por software.

### 4.3 Qué dispara una corrida

- **Cron** cada `SYNC_FINGERPRINTS_INTERVAL_MIN` (por defecto 30): se encola un
  trabajo por dispositivo con sede.
- **Evento**: cualquier cambio de alcance (se crea o termina un contrato, cambia el
  flag del grupo, una empresa entra o sale de un grupo, se asigna o mueve un
  dispositivo, se desactiva una sede) encola ya la corrida de los dispositivos
  afectados. No se espera al intervalo.
- **Manual**: "Sincronizar ahora", global, por empresa o por dispositivo.
- **`realtime_enroll_data`**: si T3 confirma que el equipo lo envía al enrolar en el
  teclado, se usa como disparador (se encola la corrida de ese dispositivo). La
  ingesta sigue pasando por `GET_USER_INFO` para tener la forma limpia de 612 B.

Los trabajos llevan una clave única por `dev_id`: **nunca corren dos corridas del
mismo dispositivo a la vez**, y un disparo que llega mientras una corrida ya está
pendiente se fusiona con ella.

### 4.4 Dedupe de huellas

No se pueden comparar plantillas byte a byte (`05`: el equipo refina la plantilla).
La única señal de "es el mismo dedo" es que el propio equipo lo diga. Si al propagar
la huella F al dispositivo D este responde `DUPLICATED ERROR`, entonces F coincide
con una huella que D ya tiene. El reconciliador marca `superseded_by` y conserva la
más reciente. Si T8b muestra que la escritura remota no detecta duplicados, este
dedupe **no se puede automatizar**. En ese caso el límite de 10 se aplica sobre
huellas posiblemente repetidas, y queda como riesgo aceptado (§8 O2).

### 4.5 Salvaguardas del borrado (R8)

Un usuario solo se borra de un dispositivo si se cumplen **todas** estas condiciones:

1. su `device_user_id` es la cédula de un `employee` del sistema;
2. el dispositivo tiene sede (no está congelado);
3. su `device_privilege` (según el último `GET_USER_INFO`) no es `MANAGER` ni `OPERATOR`;
4. la corrida no supera el umbral de borrado masivo
   (`SYNC_MAX_REMOVALS_PER_DEVICE`, por defecto 5, **o** el 20% de los usuarios del
   dispositivo). Si lo supera, **no se borra nada** en ese dispositivo, se crea un
   `sync_hold` y aparece en el panel para aprobar o rechazar. Las altas sí siguen.

Todo borrado se registra en `audit_log` (`device_user.remove`, con la causa). Si la
persona vuelve a entrar en el alcance, sus huellas se re-propagan desde la copia
canónica, sin captura física.

**Dedos repetidos entre user_id (verificado 2026-09-26, §7.3).** Si un mismo dedo
queda en dos user_id de un equipo, **el marcaje siempre se asigna al registro
original o más antiguo**, sin importar cuál ID es más bajo. La copia queda tapada,
pero sigue siendo válida: cuando se borra el original, la copia empieza a marcar.
Reglas para el reconciliador:

- **Nunca se deja un dedo en dos user_id del mismo equipo** como estado final. Como la
  escritura por software no revisa duplicados, lo evita el registro de procedencia
  (una huella canónica se propaga a un único `device_user_id` por equipo = la cédula).
- **Receta de migración para un ID viejo que no es cédula** (equipos de Adempiere): (1)
  se empuja la copia con la cédula, que queda tapada y deja los marcajes en el ID viejo;
  (2) un humano confirma en Enrolamiento que el ID viejo X corresponde a la persona con
  cédula C; (3) se hace `DELETE_USER X` y los marcajes pasan a la cédula al instante.
  Esto no ocurre solo: el paso (2) no se puede automatizar, porque el equipo no dice
  qué ID viejo corresponde a qué persona.

### 4.6 Asistencia (R11)

- **(a) `attendance_pull`**, diario (`SYNC_ATTENDANCE_CRON`, por defecto 02:00 hora
  de Caracas), por dispositivo con sede: `GET_LOG_DATA` con
  `begin_time = last_sync_at` (o 7 días, si no hay valor). El unique natural
  `ux_attendance_natural` descarta los duplicados; `devices.last_sync_at` se
  actualiza solo si el pull termina bien.
- **(b) `attendance_compute`**, al terminar (a): corre el motor de Hito 4 sobre los
  días afectados. Mientras el motor no exista, este trabajo no hace nada.
- **Resolución de `attendance_logs.employee_id`**: pasa a ser por cédula directa
  (`user_id` = dígitos de `national_id`). No depende de un enrolamiento previo.
  Empresa del marcaje = `site.company_id` del dispositivo (R12).

### 4.7 Cambios puntuales de código

| Archivo | Cambio |
| --- | --- |
| `lib/enrollment.ts` | Se reemplazan `fanOutEmployeeToGroup` y `fanOutCapturedFingerprint` por "encolar reconciliación de los dispositivos afectados" (§4.3) |
| `lib/handlers/protocol-handlers.ts` | Dequeue por prioridad. `handleRealtimeEnrollData` encola la corrida (si T3 lo confirma). El resto del hot path no cambia |
| `lib/db.ts` | No cambia (los 4 helpers siguen). La consulta de dequeue cambia en el handler, no acá |
| `lib/operations/*` | `PUSH_FINGERPRINT` y `ADD_EMPLOYEE_TO_DEVICE` escriben en `device_fingerprint_slot`. Nueva `REMOVE_EMPLOYEE_FROM_DEVICE` (`DELETE_USER` + verificación, más las salvaguardas). `PUSH_FINGERPRINT` reconoce `DUPLICATED ERROR` y el error de huella número 11 (el código exacto sale de T8/T9) |
| `lib/scope.ts` (nuevo) | §4.1 |
| `worker/` (nuevo) | §5 |
| `app/admin/*/actions.ts` | Toda acción que cambie el alcance: calcula el impacto antes de guardar (R8) y encola la corrida después de guardar |

---

## 5. Dónde corren los crons (F6)

### 5.1 Recomendación: proceso worker aparte, con la cola en Postgres (`pg-boss`)

**Qué es.** Un segundo proceso Node (`npm run worker`, entrada en `worker/index.ts`,
se corre con `tsx`), construido con **la misma imagen Docker** que la app. En Coolify
se despliega como un servicio aparte cuyo comando de arranque es distinto al de la
app.

**Cómo funciona.** `pg-boss` usa las tablas de Postgres como cola de trabajos, con
reintentos, cron (`boss.schedule`), claves únicas y `SKIP LOCKED`. El worker
programa los crons y consume los trabajos. **La app de Next solo encola**: el botón
"Sincronizar ahora" y los eventos de cambio de alcance hacen `boss.send(...)`
dentro de la server action y responden al instante.

**Por qué esta opción:**

| Opción | Problema |
| --- | --- |
| `setInterval` o `instrumentation.ts` dentro de Next | Se muere o se duplica con cada deploy o réplica. Mezcla trabajo pesado con los requests del panel y del protocolo |
| Tarea programada de Coolify (`docker exec … tsx script`) | Simple, pero no tiene cola ni reintentos, no evita que se solapen dos corridas y el botón manual necesita otro camino. No escala más allá de una máquina |
| Redis + BullMQ | Suma infraestructura (Redis) que hoy no necesitamos |
| **Worker + `pg-boss`** | Sin infra nueva (Postgres ya existe). Evita corridas solapadas por dispositivo, tiene reintentos y los trabajos quedan auditables en la DB |

**Escalabilidad.** Hay un trabajo por dispositivo. Varias instancias del worker se
reparten los trabajos solas gracias a `SKIP LOCKED`, sin coordinarse. El cuello de
botella real no es el worker sino **el equipo, que acepta un comando cada ~11 s**
(T0 lo mide). Por eso el worker solo encola y nunca espera al equipo. Además, este
worker es el embrión de `sync-worker-alco` (`02-architecture.md`, plan de
separación): cuando se haga la separación, el protocolo se muda a este mismo proceso
y no hace falta rediseñar nada.

**Costo.** Una dependencia (`pg-boss`), una carpeta `worker/`, un servicio más en
Coolify con las mismas variables de entorno y un `schema` propio en Postgres
(`pgboss`) que crea la librería. Es reversible: si se descarta, los trabajos se
vuelven a llamar desde cualquier otro disparador.

### 5.2 Parámetros (variables de entorno)

`SYNC_FINGERPRINTS_INTERVAL_MIN=30`, `SYNC_ATTENDANCE_CRON="0 2 * * *"`,
`SYNC_MAX_REMOVALS_PER_DEVICE=5`, `SYNC_MAX_REMOVALS_PCT=20`, `SYNC_TZ=America/Caracas`.

---

## 6. Frontend / UI-UX (`app/admin`)

| Área | Cambio | Reversible |
| --- | --- | --- |
| **Grupos** (nuevo, en Empresas) | CRUD de `company_group` (nombre y toggle "Compartir empleados") y asignación de empresas al grupo. Se retira de `CompanyFormDialog` la lógica de padre/hija/`is_group` | Sí |
| **Alta de empresa** | Formulario en dos pasos dentro del mismo diálogo: datos de la empresa + **primera sede obligatoria**, guardados en una sola transacción. "Desactivar sede" se bloquea si es la última activa | Sí |
| **Empresa > Empleados** (nuevo, reemplaza el filtro global por sede) | Empleados con contrato activo en la empresa. Por empleado: huella sí/no, en cuántos dispositivos del alcance está y cuántos tienen su huella, fecha de la última sincronización | Sí |
| **Empresa > Asistencia** (nuevo) — *superado por `11` C4: ahora por contrato* | Marcajes de los dispositivos de las sedes de la empresa (R12), más la capa procesada cuando exista el motor. Botón "Sincronizar asistencia" (encola `attendance_pull` de esos dispositivos). Reemplaza `/admin/asistencia` como vista principal; la vista global queda en Diagnóstico | Sí |
| **Empleados** (global) | Se quita el filtro de sede. Quedan los filtros por grupo y por empresa | Sí |
| **Contrato** (`EmploymentFields`) | Se quita el campo sede. Al terminar o trasladar un contrato, se muestra el aviso de impacto ("X pierde acceso a N dispositivos: …") | Sí |
| **Enrolamiento** — *superado por `11` E6/E8: vive en Equipo → Usuarios* | Vista de solo lectura para ver desajustes: usuarios en un dispositivo con una cédula desconocida, empleados en alcance que faltan en un dispositivo, usuarios que sobran pendientes de borrar, `sync_hold` pendientes (aprobar/rechazar), última corrida por dispositivo y huellas sincronizadas por usuario. Se eliminan `AssignEnrollmentDialog` y `UnlinkEnrollmentButton` | Sí |
| **Ficha de empleado** | Se eliminan "+ Agregar a equipo" (`AddEmployeeToDeviceDialog`) y "Copiar a otro equipo" (`PushFingerprintDialog`). Queda la lista de huellas (procedencia y en qué dispositivos está cada una) y "Sincronizar ahora" para esa persona. `ResyncGroupButton` se reemplaza por el botón general | Sí |
| **Dispositivos** | Única vista fuera de Empresa. Se asigna **solo la sede** (la empresa se obtiene de ella). "Pendiente de asignar" = congelado. Al mover un dispositivo de sede se muestra el aviso de impacto. Se ven la última corrida, los errores y el botón "Sincronizar ahora" | Sí |
| **Operaciones manuales por dispositivo** | Se eliminan las que el reconciliador desharía: `CREATE_USER`, `DELETE_USER`, `PUSH_FINGERPRINT` y `CAPTURE_FINGERPRINT` manuales. Se mantienen `SYNC_CLOCK`, `RENAME_DEVICE`, `REFRESH_STATUS`, `CHANGE_PRIVILEGE` (para designar al admin local), `VIEW_BIOMETRICS` y `SYNC_LOGS`. `CLEAR_LOGS` y `CLEAR_ENROLL` quedan **solo en Diagnóstico**, con doble confirmación | Sí |
| **Diagnóstico** | La consola de comandos crudos (`DiagnosticoCommandForm`) se mantiene como herramienta de desarrollo. Un aviso deja claro que lo que se escriba ahí a mano puede ser revertido por el reconciliador | Sí |

---

## 7. Comunicación con el dispositivo y plan de pruebas

### 7.1 Acciones a volver a probar por este cambio

| Acción | Por qué | Prueba |
| --- | --- | --- |
| `receive_cmd` | El dequeue ahora ordena por prioridad | T0, T6 |
| `send_cmd_result` (incluido fragmentado `blk_no`) | Resultados de `GET_USER_INFO` con varias huellas y de `GET_LOG_DATA` grande | T6, T13 |
| `realtime_glog` | Resolución por cédula y atribución a la empresa de la sede | T13 |
| `realtime_enroll_data` | ¿Llega al enrolar en el teclado? ¿Con qué blob? | T3 |
| `GET_DEVICE_STATUS` | Detector de cambios (`stat_fp_count`, `stat_user_count`) | **T1** |
| `GET_USER_ID_LIST` | Qué usuarios lista: con huella, ¿y los MANAGER sin huella? | T2 |
| `GET_USER_INFO` | Ingesta de 612 B; sonda de cédula (timeout de 30 s) | T4, T6 |
| `SET_USER_INFO` | Alta sin huella con cédula de 8 dígitos (`05` documenta que falló el 2026-08-18; Eibar dice que funciona) | **T4** |
| `SET_ENROLL_DATA` | Propagación, `DUPLICATED ERROR` por software, huella número 11, sobrescribir un slot | T6, T8, T9 |
| `DELETE_USER` | Borrado por salida de alcance, con verificación | T10 |
| `SET_USER_PRIVILEGE` | Que no afecte al reconciliador | T10 |
| `GET_LOG_DATA` | Pull diario con `begin_time` | T13 |
| `SET_TIME` | La zona horaria se lee de `site` sin pasar por `devices.company_id` | T14 |
| `SET_USER_NAME`, `SET_FK_NAME`, `GET_ENROLL_DATA`, `CLEAR_*` | No cambian. Prueba rápida de humo después de la migración | T14 |

### 7.2 Plan de pruebas con 2 dispositivos físicos

Equipos: **A** = `2023081133`, **B** = `2023081158` (firmware `WS535BW1_BSCS_v1.5.31`),
contra Nuremberg, con el sniffer (`raw_traffic`) activo. Se usan cédulas de prueba del
equipo (Eibar, Jesús). **Nunca se usa el equipo de prueba de Ezequiel** (§7.1 ítem 12
de `09`: no se borra nada de ese equipo). Cada hallazgo se documenta en `05` en el
mismo cambio.

**Bloque 0: medir la plataforma (antes de escribir el reconciliador)**

- **T0: rendimiento de la cola.** Encolar 10 `GET_DEVICE_STATUS` en A. Medir cuánto
  pasa entre resultados: ¿el equipo pide el siguiente comando enseguida después de
  `send_cmd_result`, o espera al siguiente poll de ~11 s? Esto fija cuánto cuesta una
  corrida y si 30 min alcanza.
- **T1: `stat_fp_count` como detector (prioridad #1).** Leer el estado → enrolar un
  dedo en el teclado a un usuario existente → leer. Repetir con (a) un segundo dedo
  al mismo usuario, (b) un usuario nuevo creado en el teclado, (c) `DELETE_USER`,
  (d) `SET_ENROLL_DATA` por software. **Resultado esperado:** el conteo cambia en
  todos los casos. Si no cambia en alguno, el paso 1 de §4.2 se reemplaza por un
  recorrido completo de ese caso.
- **T2: `GET_USER_ID_LIST`.** Confirmar que incluye exactamente a los usuarios con al
  menos una huella. Revisar dos casos: un MANAGER sin huella, y un usuario con solo
  contraseña o tarjeta.
- **T3: `realtime_enroll_data`.** Enrolar en el teclado de A y ver en el sniffer si
  llega el evento, con qué campos y de qué tamaño es el blob (612 o 524).

**Bloque 1: primitivas de escritura**

- **T4: alta sin huella.** `SET_USER_INFO {user_id: <cédula de 8 dígitos>, USER}`
  → `GET_USER_INFO` → confirmar también **en la pantalla del equipo**. Si falla,
  **se detiene todo**: el paso 1 de plan.md no se puede hacer y hay que replantearlo.
- **T5: cédula como uint32.** Una huella propagada a un usuario con cédula de 8
  dígitos: patch del offset 608 → reconocimiento físico. Revisar que no haya
  truncado ni overflow (el máximo de uint32 es 4.294.967.295, de sobra).

**Bloque 2: flujo completo (con el reconciliador ya implementado)**

- **T6: enrolamiento en el teclado + propagación, misma empresa.** Empresa E1 con
  sedes S1 (A) y S2 (B). Crear un contrato de X en E1 → X aparece sin huella en A y
  en B (T4). Enrolar el dedo de X en el teclado de A → en ≤1 corrida la huella
  llega a B → **X marca en B** (`realtime_glog` en B, `verify_mode = 1`).
- **T7: variantes de alcance.**
  - (a) E1 (A) y E2 (B) en el grupo G con `shared_employees = true` → contrato en E1 → X
    en A y en B.
  - (b) Apagar el flag de G → la vista previa avisa "X pierde acceso a B" → la corrida
    borra a X de B; A no cambia.
  - (c) E1 sin grupo → solo A.
  - (d) X con contratos en E1 y en E2 sin grupo → A y B (la unión).
- **T8: duplicado.**
  - (a) Línea base: volver a enrolar el mismo dedo de X en el teclado de A → capturar el
    mensaje y el código.
  - (b) **F5**: `SET_ENROLL_DATA` de la copia de X a B, donde ya está → ¿responde
    `DUPLICATED ERROR` o la acepta? Si la acepta, ¿se duplica el slot?
  - (c) Enrolar en el teclado de B el mismo dedo que ya llegó propagado → ¿el equipo lo
    rechaza como duplicado?
- **T9: límite de 10.**
  - (a) Llenar A con 10 huellas de X → `SET_ENROLL_DATA` de la número 11 → capturar el
    código de error.
  - (b) **F4**: `SET_ENROLL_DATA` sobre un `backup_number` ocupado → verificar
    físicamente que el dedo anterior ya no pasa y el nuevo sí. Esto decide R10.
- **T10: salida del alcance y salvaguardas.**
  - (a) Terminar el contrato de X → X desaparece de A y B (`DELETE_USER` verificado)
    → X no puede marcar.
  - (b) Un MANAGER con cédula de un empleado fuera del alcance → **no se borra**.
  - (c) Una cédula desconocida en A → no se toca, aparece en Enrolamiento.
  - (d) Sacar a A de su sede (pendiente de asignar) → nada cambia en A.
  - (e) Con 6 empleados en B, terminar los 6 contratos → se crea un `sync_hold` y no se
    borra nada; se aprueba → se borran.
- **T11: regreso.** Nuevo contrato de X en E1 → X vuelve a A y B **con su huella**,
  sin captura física.
- **T12: mover un dispositivo.** Mover B de S2 (E1) a una sede de E3 → aviso de
  impacto → se borran los de E1 y se rellena B con los de E3.
- **T13: asistencia.** X marca en B (E2, grupo compartido, contrato en E1) → el
  marcaje sale en `E2 > Asistencia`. Desconectar la red de B, marcar 3 veces,
  reconectar → ver si el equipo reenvía los marcajes por `realtime_glog` o si los
  recupera `attendance_pull`. En ambos casos, sin duplicados.
- **T14: humo después de la migración.** `SET_TIME` (zona horaria de la sede),
  `SET_FK_NAME`, `SET_USER_NAME`, `CHANGE_PRIVILEGE` a MANAGER con huella.

**Criterios de salida:** T1, T4, T6, T7 y T10 en verde son **obligatorios** antes de
re-apuntar cualquier dispositivo real de Adempiere. T8 y T9 definen R10 y §4.4.

### 7.3 Resultados (2026-09-26, servidor local, equipos A `2023081133` y B `2023081158`)

| Prueba | Resultado | Impacto en el diseño |
| --- | --- | --- |
| **T0** | ✅ **El equipo encadena comandos:** después de `send_cmd_result` vuelve a pedir el siguiente de inmediato. 10 `GET_DEVICE_STATUS` en 3,7 s (~370 ms c/u). Solo el primero espera al poll (~10 s) | Una corrida del reconciliador cuesta segundos, no minutos. 30 min sobra |
| **T1** | ✅ `stat_fp_count` / `stat_user_count` detectan: un dedo agregado a un usuario existente desde el teclado (+1 fp, lista igual), el primer dedo de un usuario (+1 fp, entra a la lista), una escritura `SET_ENROLL_DATA` (+1 fp) y un borrado desde la interfaz (−1 usuario, −1 fp, sale de la lista) | El paso 1 de §4.2 queda validado |
| **T2** | ✅ `GET_USER_ID_LIST` trae **exactamente** los usuarios con ≥1 huella (en A y en B, los que no aparecen son USER sin huella). Los MANAGER con huella sí aparecen | El paso 2 de §4.2 queda validado |
| **T3** | ✅ `realtime_enroll_data` llega **en el momento** del enrolamiento por teclado, con la ficha completa y **todas** las plantillas del usuario (binario = N × (4 + 612 B)). Si el equipo estaba desconectado, llega al reconectar | La ingesta puede reaccionar al evento; el cron queda de respaldo. El handler hoy descarta el binario: hay que guardarlo |
| **T4** | ✅ `SET_USER_INFO` crea un usuario **sin huella** con cédula de 8 dígitos (`30000001`, `30000002`, `111`). Se verificó con `GET_USER_INFO` y en pantalla. El nombre se trunca a 8 caracteres | El paso 1 de plan.md es viable. La advertencia de `05` (fallos del 2026-08-18) queda desactualizada |
| **T5** | ✅ En el blob de 612 B, el offset 608 contiene `30000001` como uint32 LE y el offset 597 el nombre | La cédula como ID no tiene problema de tamaño |
| **T8a** | ✅ Desde el teclado, `DUPLICATED` se revisa **contra todo el equipo**: un dedo que ya está en el usuario 5 no se puede enrolar en el usuario 8 | — |
| **T8b** | ✅ **`SET_ENROLL_DATA` no revisa duplicados:** acepta con `OK` un dedo que ya está en otro user_id del equipo | El dedupe automático del equipo no existe para escrituras (O2 cerrado: la idempotencia depende solo de la procedencia) |
| **T8c** | ✅ Con un dedo en dos user_id, **siempre gana el registro original o más antiguo**. A: 5 (original) contra 30000002 (copia) → 45/45 al 5. B: 999 (original, ID alto) contra 111 (copia, ID bajo) → 13/13 al 999. Al borrar 999 → 111 marca de inmediato | §4.5: regla de dedos repetidos y receta de migración de IDs viejos |
| **T9a** | ✅ (observado por Jesús en el teclado) Una huella número 11 en el mismo usuario da error | Por software no hay slot 11: el caso se reduce a sobrescribir un slot (T9b) |
| **T9b** | ❌ **Sobrescribir no funciona:** `SET_ENROLL_DATA` sobre un slot **ocupado** responde `OK` y no cambia nada (2 intentos en B: `fp_count` igual, bytes del slot sin cambios, y el dedo viejo sigue marcando). ✅ En un slot **libre** agrega la huella (+1 `fp_count`), y el meñique izquierdo copiado de A a B marcó en B | R10: "las 10 más recientes" no se puede hacer sobrescribiendo. El reconciliador **siempre** escribe en un slot libre y **siempre** verifica releyendo (el `OK` no garantiza nada). §8 O8 |
| **T13 (parcial)** | ✅ **El equipo guarda las marcaciones hechas sin red y las reenvía solo** por `realtime_glog` al reconectar: B estuvo desconectado ~13 min, se marcaron 5 veces a las 15:34, y al reconectar (15:47) llegaron las 5 en 1 segundo, con su `io_time` original. Hubo un salto de id (194): un duplicado que descartó `ux_attendance_natural` | El cron diario `attendance_pull` (§4.6) queda como **red de seguridad** (memoria del equipo llena, servidor caído mucho tiempo), no como el camino principal |
| Observación | `verify_mode` = 33 en usuarios MANAGER y 1 en USER, en los dos equipos | El resolvedor de asistencia acepta cualquier `verify_mode` |
| Observación | El reloj de A estaba en 2015 (B, bien) | `SET_TIME` en el checklist de alta de cada equipo |

Pendientes: T6 (propagación A→B con el reconciliador), T7, T10–T14.

---

## 8. Pendientes

| # | Tema | Bloquea |
| --- | --- | --- |
| O1 | Confirmar los nombres de las tablas y enums nuevos (§3.1) al revisar el PR de la migración | La migración |
| O2 | Si T8b muestra que la escritura remota no detecta duplicados: aceptar huellas posiblemente repetidas dentro del límite de 10, o pedir a Ezequiel que capture siempre en un solo equipo | Dedupe automático (§4.4) |
| O3 | Excepciones al alcance (sumar a alguien a un equipo fuera de su alcance): hoy no hay forma. Se preverá con una tabla de overrides cuando llegue DT1 (torniquetes) o si Ezequiel lo pide | — |
| O4 | R12 "por ahora": validar con Ezequiel que el día procesado se impute al contrato y no a la empresa donde marcó | Hito 4 / 5 (export) |
| O5 | Umbrales del freno de borrado masivo (5 usuarios / 20%): ajustarlos después de ver datos reales de la migración | — |
| O6 | Migración desde Adempiere: los dumps de datos se definen más adelante (Jesús). El reconciliador ya los protege: las cédulas sin contrato no se tocan y los dispositivos sin sede están congelados | Hito 5 |
| O7 | El filtro "empleados por sede" que pidió Ezequiel (`09` §3.12) queda sin soporte en el schema. Si lo vuelve a pedir, se hace un filtro calculado por marcajes | — |
| O8 | ~~R10 después de T9b~~ **Decidido (2026-09-26): las 10 primeras + alerta.** Como no se puede sobrescribir un slot, no se recrea al usuario para meter huellas más recientes. Si la unión de huellas pasa de 10, las que sobran quedan en la copia canónica sin propagarse, y se muestra una alerta en la ficha del empleado | — |
| O9 | **`GET_USER_INFO` se cuelga de forma intermitente también con usuarios que SÍ existen** (visto en A el 2026-09-26: usuario 2 a las 19:27, y `30000001` a las 18:45, que seguía existiendo; un reintento minutos después respondió en 1 s). La regla "si no responde, no existe" de `ADD_EMPLOYEE_TO_DEVICE` y de la verificación de `DELETE_USER` **no es segura**: dio por borrado a `30000001` cuando su `DELETE_USER` había devuelto `Error`. El reconciliador verifica con `GET_DEVICE_STATUS` (cambio en los contadores) + `GET_USER_ID_LIST`, nunca por silencio, y **nunca manda `SET_USER_INFO` si hay duda de que el ID exista** (reindexado destructivo) | ✅ **Bug corregido en el código actual (2026-09-26):** `DELETE_USER` verifica con `total_user_count` antes y después (tiene que bajar exactamente 1; si no, `mismatch`); las sondas de `CREATE_USER`/`ADD_EMPLOYEE_TO_DEVICE` ya no toman el silencio como "libre": lo cruzan con `GET_USER_ID_LIST` (`probeListVerdict`) y no crean si la cédula aparece o si la lista no se puede leer |
| O10 | `export_run` con `scope = group`: apuntaba a la empresa raíz (`scope_company_id`), que ya no existe como concepto. Cuando se implemente el Hito 5, agregar `scope_group_id` (FK a `company_group`) — **cerrado (2026-09-27, `11` R2/R7): no hay export por grupo, no hace falta** | — |
| O11 | Contratos con fecha de inicio futura: el fan-out del PR 1 solo enrola contratos **vigentes hoy** (§4.1). Hasta que exista el cron (PR 2), un contrato futuro se enrola con "Re-sincronizar enrolamientos" en la empresa cuando empieza | PR 2 lo resuelve solo |
| O12 | Aviso de impacto al desactivar una empresa o un grupo (hoy solo lo protege el freno de borrado masivo) | — |

---

## 9. Documentación a actualizar (cuando se implemente, en el mismo cambio)

- `07-admin-ux-spec.md`: §1.1 (grupo), §1.2 (1..N), §1.4 (sin sede), §1.6 (solo
  sede), §1.7 y §1.8 (sincronización y procedencia), §3 (vistas), §5.1–§5.7
  (flujos).
- `08-data-model.md`: §4.1, §4.2, §4.5, §4.6, §5 (ERD), §6 (se quitan el trigger de 2
  niveles y el CHECK de RIF; se agrega el trigger diferido de ≥1 sede), §7
  (migración nueva), adenda.
- `09-reunion-3.md`: nota en §7 / §7.1 ítems 5 y 6 → "superado por `10`".
- `02-architecture.md`: fan-out → reconciliador, worker + `pg-boss`,
  `commands.priority`.
- `05-commands-catalog.md`: resultados de T1–T4, T8 y T9 (`DUPLICATED ERROR`,
  límite de 10, sobrescribir un slot, `GET_USER_ID_LIST`, alta sin huella).
- `06-infrastructure.md`: servicio `worker` en Coolify.
- `qa-hito-3.md`: flujos de empresa, sede y contrato.
- `CLAUDE.md` (root): contexto operativo (reconciliador, worker).
