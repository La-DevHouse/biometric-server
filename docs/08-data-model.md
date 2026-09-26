# Modelo de datos — schema Postgres / Prisma

Estado: **firmado (2026-08-30)**. Deriva de `07-admin-ux-spec.md`. Define el
schema completo: las 8 tablas de protocolo que ya existen (porteadas de SQLite)
más las entidades de dominio nuevas.

Decisiones del §9 confirmadas; alcance del §8 decidido (Fase 1 **sí** incluye el
motor de cálculo de asistencia). Cambios de schema a partir de acá son
migraciones nuevas, no ediciones.

> **⚠️ Reestructura 2026-09-26 (`docs/10-reestructura-dominio-sync.md`) — lo vigente:**
> el grupo de empresas ya **no** es una fila de `client_company`: es la tabla
> propia `company_group` (`name`, `shared_employees`), y `client_company.group_id`
> es nullable. Se eliminaron `parent_id`/`is_group`/`shared_employees`, el trigger
> de 2 niveles y el CHECK de RIF; `devices.company_id` (la empresa sale de la
> sede) y `employment.site_id` (el contrato no lleva sede). Toda empresa activa
> tiene al menos una sede activa (constraint trigger diferido). Migración
> `20260926200000_company_group_and_site_scope`. §4.1, §4.2, §4.6, §5, §6 y §7
> ya reflejan esto; la historia de abajo queda como contexto.
>
> **Historia de la jerarquía padre/hijas (leer en orden, no te quedes con la
> primera línea):** la jerarquía de `client_company`
> (`parent_id`/`is_group`/`shared_employees`) se **quitó por error** el
> 2026-09-08 (migración `20260908155808_remove_company_hierarchy`, con el
> razonamiento — equivocado — de que ningún cliente real de ALCO necesitaba
> varias razones sociales compartiendo empleados). Reunión 3 (2026-09-10)
> confirmó que **sí la necesita** (Grupo Farmalido, Grupo Perfume Factory —
> ver `docs/09-reunion-3.md` §3.1), así que se **restauró** en
> `20260910120000_restore_hierarchy_and_domain_refinements`, junto con los
> refinamientos de esa reunión (`business_model`, `payroll_type`, logo/rep.
> legal — ver la "Adenda 2026-09-10" más abajo). **El estado vigente es el que
> está en `prisma/schema.prisma` hoy: la jerarquía SÍ existe.** El bloque de
> `prisma` de este documento (§4 más abajo) es el borrador firmado
> originalmente el 2026-08-30 — para el schema real, siempre `prisma/schema.prisma`.

---

## 1. Convenciones

- **Nombres:** todo en `snake_case` — nombres de modelo, campos y tablas. Sin
  `@map`. Consistente con las tablas de protocolo actuales y con el SQL crudo del
  hot path. (Prisma avisa que la convención es PascalCase; se ignora a propósito
  por uniformidad.)
- **IDs:** `Int @id @default(autoincrement())` en todo el dominio. `device` sigue
  con `dev_id String @id` (número de serie, viene del equipo).
- **Timestamps — asimetría deliberada (ver `07` y plan de Fase 2):**
  - Tablas de **protocolo**: `BigInt` epoch-millis (`created_at`, `updated_at`,
    `last_seen_at`, …). No se tocan — el hot path hace aritmética con
    `Date.now()`. Type-parser int8→`Number` en `lib/db.ts`.
  - Tablas de **dominio**: `DateTime @db.Timestamptz(6)` con `@default(now())` /
    `@updatedAt`. Fechas sin hora (`start_date`, `date`): `DateTime @db.Date`.
- **Enums:** nativos de Postgres (greenfield, tipados por el cliente Prisma). Las
  tablas de protocolo siguen con `text` + `CHECK` crudo (no enum) — decisión del
  plan de Fase 2.
- **Soft-delete:** entidades con ciclo de vida usan `status` (`record_status` /
  `employment_status`). No se borra físicamente `employee`, `client_company`,
  `employment`.
- **FKs:** el dominio usa `@relation` completo. Las tablas de protocolo **no**
  tienen FKs en la migración baseline (el hot path inserta sin garantizar orden
  — ver plan de Fase 2). Las columnas nuevas que enganchan protocolo→dominio se
  agregan en una migración posterior, con FK solo donde es seguro (las gestiona
  el admin, no el hot path).

---

## 2. Tablas de protocolo (ya existen — recap)

Porteadas 1:1 de SQLite en la migración `0001_protocol_baseline` (PR1 de Fase 2).
Detalle completo en el plan de Fase 2 y `docs/02-architecture.md`. Resumen:

| Tabla | Rol | Cambios respecto a hoy |
| --- | --- | --- |
| `devices` | identidad/heartbeat de equipos | **+ columnas de dominio** (§4.6), en migración `0002` |
| `commands` | cola de comandos al equipo | ninguno (pliega `op_id`, `stat_*` ya están) |
| `attendance_logs` | marcaje crudo (ingesta inmutable) | **+ `employee_id Int?`** en `0002` |
| `users` | enrolados del equipo (`dev_id`,`user_id`) | ninguno |
| `enroll_data` | plantilla biométrica **por dispositivo** | ninguno |
| `block_buffer` | reensamblado de respuestas fragmentadas | ninguno |
| `raw_traffic` | log de auditoría de tráfico | ninguno |
| `operations` | orquestación de acciones de alto nivel | ninguno |

`users` y `enroll_data` **no** se relacionan por FK con el dominio: sus filas solo
existen después de una sincronización, mientras que el vínculo del lado de la app
(`employee_device_enrollment`) puede crearse antes. La referencia es blanda, por
`(dev_id, device_user_id)`.

---

## 3. Enums de dominio

```prisma
enum record_status      { active  inactive }
enum employment_status  { active  inactive }
enum enrollment_status  { active  inactive }
enum attendance_status  { present late early_leave absent }
enum absence_rule       { no_check_in no_marks under_hours }
enum export_scope       { company group combined }
enum app_user_role      { admin operator viewer }   // Fase 1: todos 'admin'
enum payroll_type       { quincenal semanal }       // en employment (Reunión 3, docs/09 §3.5)
```

---

## 4. Modelos de dominio (`schema.prisma`)

Migración `0002_domain` aplicada 2026-08-31. Migraciones posteriores en §7.

> **Historia de la jerarquía de empresas:** `0002_domain` la creó (padre/hijas,
> `is_group`, `shared_employees`). El 2026-09-08 se quitó por error
> (`20260908155808_remove_company_hierarchy`, commit `6ba1169`). Reunión 3
> (2026-09-10) confirmó que ALCO sí la necesita → restaurada en
> `20260910120000_restore_hierarchy_and_domain_refinements`, junto con
> `business_model`, `payroll_type`, `logo`/rep. legal y `company_linked_at`.
> Ver `docs/09-reunion-3.md` §3.1, §3.5.1 y §7.1 ítem 8.

### 4.1 Grupos, empresas y sedes

Vigente desde `20260926200000` (docs/10 R1–R3). Cardinalidades de plan.md:
`Grupo 1 — 0..N Empresa` (`group_id` nullable), `Empresa 1 — 1..N Sede`,
`Sede 1 — 0..N Dispositivo`.

```prisma
model company_group {
  id               Int           @id @default(autoincrement())
  name             String
  shared_employees Boolean       @default(true)   // extiende el alcance de la huella a todas las empresas del grupo
  status           record_status @default(active)
  created_at       DateTime      @default(now()) @db.Timestamptz(6)
  updated_at       DateTime      @updatedAt @db.Timestamptz(6)

  companies client_company[]
}

model client_company {
  id       Int            @id @default(autoincrement())
  group_id Int?
  group    company_group? @relation(fields: [group_id], references: [id], onDelete: Restrict)
  name     String
  tax_id   String?        // RIF. Nullable en la columna (filas viejas); la app lo exige
  status   record_status  @default(active)
  address  String?

  business_model_id Int?                               // tipo de comercio; ya NO se hereda del grupo (docs/10 §2)
  business_model    business_model?  @relation(fields: [business_model_id], references: [id], onDelete: SetNull)

  logo                  Bytes?                         // → recibo de pago (docs/09 §3.11)
  legal_rep_name        String?
  legal_rep_national_id String?
  legal_rep_phone       String?

  late_tolerance_min        Int?                       // fallback de umbrales (07 §1.9)
  early_leave_tolerance_min Int?
  absence_rule              absence_rule?
  absence_min_hours         Int?

  created_at DateTime @default(now()) @db.Timestamptz(6)
  updated_at DateTime @updatedAt @db.Timestamptz(6)

  sites           site[]
  employments     employment[]
  schedule_groups schedule_group[]
  export_runs     export_run[]

  @@index([group_id])
  @@index([business_model_id])
}

model site {
  id         Int            @id @default(autoincrement())
  company_id Int
  company    client_company @relation(fields: [company_id], references: [id], onDelete: Cascade)
  name       String
  code       String?
  timezone   String         @default("America/Caracas")
  status     record_status  @default(active)
  created_at DateTime       @default(now()) @db.Timestamptz(6)
  updated_at DateTime       @updatedAt @db.Timestamptz(6)

  devices devices[]                                     // el contrato NO apunta a la sede (docs/10 R4)

  @@unique([company_id, code])
  @@index([company_id])
}
```

### 4.2 Personas y vínculo laboral

```prisma
model employee {
  id          Int       @id @default(autoincrement())
  national_id String    @unique          // V/E/J/G + dígitos, validado en app
  tax_id      String?
  first_name  String
  last_name   String
  birth_date  DateTime? @db.Date
  photo       Bytes?
  created_at  DateTime  @default(now()) @db.Timestamptz(6)
  updated_at  DateTime  @updatedAt @db.Timestamptz(6)

  employments      employment[]
  enrollments      employee_device_enrollment[]
  fingerprints     employee_fingerprint[]
  attendance_days  attendance_day[]
  attendance_logs  attendance_log[]      // lado nullable de la resolución

  @@index([last_name, first_name])
}

model employment {
  id                Int               @id @default(autoincrement())
  employee_id       Int
  employee          employee          @relation(fields: [employee_id], references: [id], onDelete: Restrict)
  company_id        Int
  company           client_company    @relation(fields: [company_id], references: [id], onDelete: Restrict)
  schedule_group_id Int?
  schedule_group    schedule_group?   @relation(fields: [schedule_group_id], references: [id], onDelete: SetNull)
  position_id       Int?
  position          position?         @relation(fields: [position_id], references: [id], onDelete: SetNull)
  department_id     Int?
  department        department?       @relation(fields: [department_id], references: [id], onDelete: SetNull)
  payroll_ref       String?           // "Empleado Nómina" de Adempiere
  payroll_type      payroll_type?     // quincenal | semanal. Null = sin nómina (contrato "en prueba")
  start_date        DateTime          @db.Date
  end_date          DateTime?         @db.Date
  status            employment_status @default(active)
  created_at        DateTime          @default(now()) @db.Timestamptz(6)
  updated_at        DateTime          @updatedAt @db.Timestamptz(6)

  attendance_days   attendance_day[]

  @@index([employee_id])
  @@index([company_id, status])
  @@index([schedule_group_id])
}
```

**Contrato sin sede (docs/10 R4, 2026-09-26):** `employment.site_id` se eliminó.
La pertenencia es con la empresa; el alcance de la huella sale de las sedes de
esa empresa (y de su grupo si comparte empleados) — ver `lib/scope.ts`. En la UI
la entidad se llama "Contrato de trabajo"; la tabla conserva `employment`.

**Tres ejes de categorización** (Reunión 3, `docs/09` §3.5.1):

- **Modelo de negocio** — vive en `client_company.business_model_id`, no en el
  contrato. Es el "Departamento de Nómina" de Adempiere renombrado. Filtra qué
  `position` se ofrecen al crear el contrato (vía `position_business_model`).
- **Cargo / puesto** — `employment.position_id`. El cargo vive en el contrato,
  no en la persona: alguien puede ser gerente en una empresa y cocinero en otra.
- **Departamento organizacional** — `employment.department_id` (+ `department`).
  Opcional, **sin uso en Fase 1**; queda previsto para nómina/reportes (ej.
  "Orientación", "COVI" en colegios). `position.department_id` deja de usarse como
  eje de filtrado (lo reemplaza el modelo de negocio).

### 4.3 Categorización de cargo

```prisma
model department {
  id          Int           @id @default(autoincrement())
  code        String?
  name        String
  description String?
  status      record_status @default(active)
  created_at  DateTime      @default(now()) @db.Timestamptz(6)
  updated_at  DateTime      @updatedAt @db.Timestamptz(6)

  positions   position[]
  employments employment[]
}

model position {
  id            Int           @id @default(autoincrement())
  code          String?
  name          String
  description   String?
  department_id Int?
  department    department?    @relation(fields: [department_id], references: [id], onDelete: SetNull)
  status        record_status @default(active)
  created_at    DateTime      @default(now()) @db.Timestamptz(6)
  updated_at    DateTime      @updatedAt @db.Timestamptz(6)

  employments     employment[]
  business_models position_business_model[]   // sin filas → cargo genérico (todos los modelos)

  @@index([department_id])
}

// Reunión 3 (docs/09 §3.5.1): tipo de comercio de la empresa; filtra el catálogo
// de cargos. Reemplaza el "Departamento de Nómina" de Adempiere como concepto.
model business_model {
  id         Int           @id @default(autoincrement())
  code       String?
  name       String
  status     record_status @default(active)
  created_at DateTime      @default(now()) @db.Timestamptz(6)
  updated_at DateTime      @updatedAt @db.Timestamptz(6)

  companies client_company[]
  positions position_business_model[]
}

// M:N position ↔ business_model. position sin ninguna fila acá = genérico.
model position_business_model {
  position_id       Int
  position          position       @relation(fields: [position_id], references: [id], onDelete: Cascade)
  business_model_id Int
  business_model    business_model @relation(fields: [business_model_id], references: [id], onDelete: Cascade)

  @@id([position_id, business_model_id])
  @@index([business_model_id])
}
```

### 4.4 Horarios y turnos

> Renombrado 2026-09-26: `employee_group` → `schedule_group` (UI: "Horario"). Motivo:
> la palabra "Grupo" ya se usa en la UI para `client_company.is_group` (grupos de
> empresa, ej. "Grupo Farmalido") — mantenerla acá también colisionaba con ese
> concepto. Es un rename puro (migración `ALTER TABLE/COLUMN ... RENAME`), sin
> cambio de comportamiento ni pérdida de datos.

```prisma
model schedule_group {
  id         Int            @id @default(autoincrement())
  company_id Int
  company    client_company @relation(fields: [company_id], references: [id], onDelete: Cascade)
  name       String
  code       String?
  status     record_status  @default(active)

  // umbrales de asistencia. null → hereda de client_company
  late_tolerance_min        Int?
  early_leave_tolerance_min Int?
  absence_rule              absence_rule?
  absence_min_hours         Int?

  created_at DateTime @default(now()) @db.Timestamptz(6)
  updated_at DateTime @updatedAt @db.Timestamptz(6)

  shifts      shift[]
  employments employment[]

  @@index([company_id])
}

model shift {
  id                Int             @id @default(autoincrement())
  schedule_group_id Int
  schedule_group    schedule_group  @relation(fields: [schedule_group_id], references: [id], onDelete: Cascade)
  code              String?
  name              String
  start_time        String          // "HH:MM" 24h, hora local de sede
  end_time          String
  break_start       String?
  break_end         String?
  hours             Decimal?        @db.Decimal(4, 2)
  variable_in_out   Boolean         @default(false)
  workdays          Int[]           // [1..7] = Lun..Dom
  crosses_midnight  Boolean         @default(false)
  effective_from    DateTime        @db.Date
  effective_to      DateTime?       @db.Date
  created_at        DateTime        @default(now()) @db.Timestamptz(6)
  updated_at        DateTime        @updatedAt @db.Timestamptz(6)

  attendance_days   attendance_day[]

  @@index([schedule_group_id, effective_from])
}
```

**Decisión: `start_time` como `String "HH:MM"`**, no `@db.Time`. Motivo: la hora
de turno es config, no dato calculado; `@db.Time` en Prisma vuelve como `Date` en
1970-01-01 y es confuso en JS. El motor de asistencia parsea la string. Revisar
si el cálculo SQL-side lo hace incómodo.

### 4.5 Biométrico a nivel empleado

> **Vigente desde `20260927100000` (docs/10 R9):** `employee_fingerprint` ya no es
> único por `(employee_id, finger_index)` — el slot es orden de registro de un
> equipo, no identidad de dedo. Tiene id propio, `source_backup_number` (el slot de
> origen, informativo) y `status`. Dónde está cada copia lo dice
> `device_fingerprint_slot` (`physical` = enrolada en el teclado e ingerida;
> `propagated` = escrita por el sistema y verificada). "Las 10 primeras" = las 10
> activas más antiguas por `captured_at`. El bloque de abajo es el borrador original.

```prisma
model employee_device_enrollment {
  id             Int               @id @default(autoincrement())
  employee_id    Int
  employee       employee          @relation(fields: [employee_id], references: [id], onDelete: Cascade)
  dev_id         String
  device         device            @relation(fields: [dev_id], references: [dev_id], onDelete: Cascade)
  device_user_id String            // "1","2"… — coincide con users.user_id del protocolo
  status         enrollment_status @default(active)
  enrolled_at    DateTime          @default(now()) @db.Timestamptz(6)
  ended_at       DateTime?         @db.Timestamptz(6)
  updated_at     DateTime          @updatedAt @db.Timestamptz(6)

  @@index([employee_id])
  @@index([dev_id, device_user_id])
  // unique parcial (dev_id, device_user_id) WHERE status='active' → SQL crudo (§6)
}

model employee_fingerprint {
  id            Int      @id @default(autoincrement())
  employee_id   Int
  employee      employee @relation(fields: [employee_id], references: [id], onDelete: Cascade)
  finger_index  Int      // backup_number: 0–9 dedos, 10 password, 11 tarjeta, 12 rostro
  template      Bytes
  source_dev_id String?
  source_device device?  @relation(fields: [source_dev_id], references: [dev_id], onDelete: SetNull)
  captured_at   DateTime @default(now()) @db.Timestamptz(6)
  updated_at    DateTime @updatedAt @db.Timestamptz(6)

  @@unique([employee_id, finger_index])
  @@index([employee_id])
}
```

### 4.6 Columnas nuevas en tablas de protocolo (migración `0002`)

```prisma
// se AGREGAN a los modelos existentes device y attendance_log

model device {
  // ... campos de protocolo existentes ...
  site_id           Int?            // SIN company_id: la empresa sale de la sede (docs/10 R3, 2026-09-26)
  site              site?           @relation(fields: [site_id], references: [id], onDelete: SetNull)
  company_linked_at DateTime?       @db.Timestamptz(6)  // cuándo se asoció a su sede actual (docs/09 §3.13)
  last_sync_at      BigInt?         // última sync EXITOSA de marcajes (≠ last_seen_at heartbeat)
  device_admin_note String?         // admin del lado de la empresa (texto libre, NO app_user)

  enrollments          employee_device_enrollment[]
  sourced_fingerprints employee_fingerprint[]

  @@index([site_id])
}

model attendance_log {
  // ... campos de protocolo existentes ...
  employee_id Int?
  employee    employee? @relation(fields: [employee_id], references: [id], onDelete: SetNull)

  @@index([employee_id])
}
```

`site_id` es nullable a propósito aunque plan.md diga "dispositivo pertenece a
exactamente una sede": el equipo se registra solo en su primer `receive_cmd`,
antes de que alguien lo asigne. Sin sede = "pendiente de asignar" = congelado
(docs/10 §3.3).

Agregar `@relation` a `device` / `attendance_log` en `0002` es seguro: las tablas
de dominio ya existen y estas columnas las escribe el admin / un resolver, no el
hot path (que sigue con SQL crudo e ignora las columnas nuevas nullable).

### 4.7 Asistencia procesada

```prisma
model attendance_day {
  id               Int                @id @default(autoincrement())
  employee_id      Int
  employee         employee           @relation(fields: [employee_id], references: [id], onDelete: Cascade)
  employment_id    Int?
  employment       employment?        @relation(fields: [employment_id], references: [id], onDelete: SetNull)
  date             DateTime           @db.Date
  shift_id         Int?
  shift            shift?             @relation(fields: [shift_id], references: [id], onDelete: SetNull)
  first_in         DateTime?          @db.Timestamptz(6)
  last_out         DateTime?          @db.Timestamptz(6)
  worked_minutes   Int?
  overtime_minutes Int?               // referencia, sin recargo legal
  status           attendance_status?
  computed_at      DateTime?          @db.Timestamptz(6)
  created_at       DateTime           @default(now()) @db.Timestamptz(6)
  updated_at       DateTime           @updatedAt @db.Timestamptz(6)

  corrections      attendance_correction[]

  @@unique([employee_id, date])
  @@index([date])
}

model attendance_correction {
  id                Int             @id @default(autoincrement())
  attendance_day_id Int?
  attendance_day    attendance_day? @relation(fields: [attendance_day_id], references: [id], onDelete: Cascade)
  attendance_log_id Int?            // ref blanda a attendance_logs.id (sin FK, tabla de protocolo)
  field             String
  old_value         String?
  new_value         String?
  reason            String?
  actor_app_user_id Int
  actor             app_user        @relation(fields: [actor_app_user_id], references: [id], onDelete: Restrict)
  created_at        DateTime        @default(now()) @db.Timestamptz(6)

  @@index([attendance_day_id])
  // CHECK: exactamente uno de (attendance_day_id, attendance_log_id) no nulo → §6
}
```

### 4.8 Plataforma: usuarios, auditoría, export

```prisma
model app_user {
  id            Int           @id @default(autoincrement())
  email         String        @unique
  name          String
  password_hash String
  role          app_user_role @default(admin)   // Fase 1: todos 'admin', sin matriz
  status        record_status @default(active)
  last_login_at DateTime?     @db.Timestamptz(6)
  created_at    DateTime      @default(now()) @db.Timestamptz(6)
  updated_at    DateTime      @updatedAt @db.Timestamptz(6)

  audit_logs  audit_log[]
  corrections attendance_correction[]
  export_runs export_run[]
}

model audit_log {
  id                Int       @id @default(autoincrement())
  actor_app_user_id Int?
  actor             app_user? @relation(fields: [actor_app_user_id], references: [id], onDelete: SetNull)
  action            String    // "company.delete", "attendance.correct", "employee.transfer", "export.run", …
  entity_type       String
  entity_id         String?
  before_json       Json?
  after_json        Json?
  created_at        DateTime  @default(now()) @db.Timestamptz(6)

  @@index([entity_type, entity_id])
  @@index([created_at(sort: Desc)])
}

model export_run {
  id               Int          @id @default(autoincrement())
  period_start     DateTime     @db.Date
  period_end       DateTime     @db.Date
  scope            export_scope
  scope_company_id Int?         // empresa individual o raíz del grupo
  generated_by     Int?
  generator        app_user?    @relation(fields: [generated_by], references: [id], onDelete: SetNull)
  generated_at     DateTime     @default(now()) @db.Timestamptz(6)
  file_ref         String?
  row_count        Int?

  @@index([period_start, period_end])
}
```

---

## 5. ERD

```
company_group ──< client_company                 (group_id nullable)
client_company
   ├──< site ──< device*  (site_id nullable = pendiente de asignar)
   │                └──< employee_device_enrollment >── employee
   │                └──< enroll_data*      (por dispositivo)
   │                └──< employee_fingerprint (source)
   ├──< schedule_group ──< shift
   │            └──< employment
   └──< employment >── employee          (sin sede)
          ├── position >── department
          ├── department
          └──< attendance_day ──< attendance_correction >── app_user
attendance_log* >── employee            (employee_id nullable, resuelto)
employee ──< employee_fingerprint
app_user ──< audit_log
app_user ──< export_run

(*) tabla de protocolo existente
```

## 6. Constraints que Prisma no expresa (SQL crudo en la migración)

| Constraint | Dónde | Forma |
| --- | --- | --- |
| Empresa activa ⇒ ≥1 sede activa | `client_company`, `site` | Constraint triggers `DEFERRABLE INITIALLY DEFERRED` (`client_company_requires_active_site`, `site_keeps_company_active_site`, función `company_has_active_site`): se evalúan al COMMIT, así que empresa + sede en la misma transacción pasa. `20260926200000`. |
| ~~Jerarquía de 2 niveles~~ / ~~RIF requerido en hojas~~ | `client_company` | **Eliminados en `20260926200000`** (el grupo es tabla propia; el RIF lo exige la app). |
| Un enrolado activo por slot | `employee_device_enrollment` | `CREATE UNIQUE INDEX … (dev_id, device_user_id) WHERE status = 'active'` |
| Corrección apunta a día **o** log, no ambos ni ninguno | `attendance_correction` | `CHECK ((attendance_day_id IS NULL) <> (attendance_log_id IS NULL))` |
| Rangos de fecha coherentes | `employment`, `shift` | `CHECK (end_date IS NULL OR end_date >= start_date)` / `effective_to` |
| CHECKs de protocolo (`status`, `stage`, `direction`) | tablas de protocolo | ya previstos en `0001` (plan de Fase 2) |

---

## 7. Orden de migraciones

| Migración | Fecha | Contenido |
| --- | --- | --- |
| `20260830151045_protocol_baseline` | 2026-08-30 | Las 8 tablas de protocolo tal cual (bigint millis, `@@unique` de asistencia, sin FKs, sin columnas de dominio). |
| `20260830151600_protocol_check_constraints` | 2026-08-30 | CHECKs de `status`/`stage`/`direction` (SQL crudo). |
| `20260831211102_domain` | 2026-08-31 | Todos los modelos de §4 + enums de §3 + columnas nuevas en `device` / `attendance_log` (§4.6) + constraints crudos de §6. Tablas vacías. |
| `20260901165749_site_timezone` | 2026-09-01 | `site.timezone TEXT NOT NULL DEFAULT 'America/Caracas'`. |
| `20260908155808_remove_company_hierarchy` | 2026-09-08 | ⚠️ Quitó `parent_id`/`is_group`/`shared_employees` + trigger + CHECK. **Revertido por `20260910120000`.** |
| `20260926180000_rename_employee_group_to_schedule_group` | 2026-09-26 | Rename puro `employee_group` → `schedule_group`. |
| `20260927100000_fingerprint_provenance_and_sync` | 2026-09-27 | docs/10 PR 2: `employee_fingerprint.finger_index` → `source_backup_number` (rename, sin pérdida; se quita el unique `(employee_id, finger_index)`), `status`; `device_fingerprint_slot` (procedencia por slot, backfill desde las huellas existentes); `sync_run`; `sync_hold`; `commands.priority` + `operations.priority`; enums `fingerprint_origin`, `fingerprint_slot_state`, `sync_kind`, `sync_trigger`, `sync_hold_resolution`. |
| `20260926200000_company_group_and_site_scope` | 2026-09-26 | docs/10 PR 1: `company_group` + `client_company.group_id` (backfill desde las filas `is_group`/padres; las filas-grupo con algo colgando quedan como empresa miembro), sede "Principal" para toda empresa sin sede activa, equipos con empresa y sin sede → esa sede; drop `parent_id`/`is_group`/`shared_employees`, trigger de 2 niveles, CHECK de RIF, `devices.company_id`, `employment.site_id`; constraint trigger diferido "≥1 sede activa". |
| `20260910120000_restore_hierarchy_and_domain_refinements` | 2026-09-10 | Reunión 3: restaura jerarquía (columnas + FK + índice + trigger 2 niveles + CHECK de RIF), agrega `business_model` + `position_business_model` + enum `payroll_type` + `employment.payroll_type` + `client_company.{logo, legal_rep_*}` + `device.company_linked_at`. |

**Seeds mínimos** (script aparte, no migración): 1 `app_user` inicial para poder
entrar al panel una vez que exista auth.

---

## 8. Alcance del cálculo de asistencia (de `07` §8) — DECIDIDO

**Fase 1 incluye el motor de cálculo de asistencia.** `attendance_day`,
`attendance_correction` y las columnas de umbral en `schedule_group` /
`client_company` se pueblan y usan en Fase 1. El detalle de qué calcula el motor
y qué queda para Fase 2 (valoración legal, feriados) está en `07-admin-ux-spec.md`
§8. No hay cambios de schema por esta decisión — el diseño de §4 ya lo contempla.

---

## 9. Checklist de firma — CONFIRMADO (2026-08-30)

- [x] Jerarquía de empresas: adjacency list `parent_id`, 2 niveles, mutable, sin historia
- [x] `employee` (persona) + `employment` (N, sin constraint de exclusividad)
- [x] `site` y `schedule_group` (antes `employee_group`) como entidades propias
- [x] Umbrales de tardanza/ausencia en `schedule_group` con fallback a `client_company`
- [x] `app_user` con `role` pero sin matriz de permisos en Fase 1
- [x] `employee_fingerprint` (copia canónica por empleado) separada de `enroll_data` (por dispositivo)
- [x] Timestamps: protocolo `bigint` millis, dominio `timestamptz`
- [x] Alcance §8: **Fase 1 incluye el motor de cálculo de asistencia** (valoración legal → Fase 2)

### Adenda 2026-09-10 (Reunión 3)

- [x] Jerarquía de empresas restaurada tras el revert del 2026-09-08 (`20260910120000`)
- [x] `shared_employees` default `true`, vive en la fila del grupo → fan-out de enrolamiento
- [x] `business_model` + `position_business_model` (M:N; sin filas = cargo genérico)
- [x] `employment.payroll_type` (`quincenal` | `semanal`, nullable)
- [x] `client_company.{logo, legal_rep_name, legal_rep_national_id, legal_rep_phone}`
- [x] `device.company_linked_at`
- [x] `employment.department_id` se mantiene, sin uso en Fase 1 (departamento organizacional real)

Contexto y decisiones completas: `docs/09-reunion-3.md` §3.5.1, §7.1, §10.

### Adenda 2026-09-26 (reestructura, `docs/10`)

- [x] Grupo = tabla propia `company_group` (`name`, `shared_employees`); `client_company.group_id` nullable
- [x] Empresa 1..N sedes (constraint trigger diferido); sede "Principal" en el backfill
- [x] `devices.company_id` eliminado (empresa vía sede); `devices.site_id` sigue nullable (= pendiente de asignar)
- [x] `employment.site_id` eliminado (contrato sin sede)
- [x] `business_model` ya no se hereda del grupo
- [x] PR 2 (`20260927100000`): `employee_fingerprint` con id propio (sin unique por slot; `source_backup_number` informativo; `status`), `device_fingerprint_slot` (procedencia `physical`/`propagated` por `(dev_id, device_user_id, backup_number)`), `sync_run`, `sync_hold`, `commands.priority`/`operations.priority`. `employee_device_enrollment.desired` **no** se agregó (se recalcula desde el alcance — docs/10 §0). Modelos completos: `prisma/schema.prisma`.
