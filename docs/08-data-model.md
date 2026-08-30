# Modelo de datos — schema Postgres / Prisma

Estado: **firmado (2026-08-30)**. Deriva de `07-admin-ux-spec.md`. Define el
schema completo: las 8 tablas de protocolo que ya existen (porteadas de SQLite)
más las entidades de dominio nuevas.

Decisiones del §9 confirmadas; alcance del §8 decidido (Fase 1 **sí** incluye el
motor de cálculo de asistencia). Cambios de schema a partir de acá son
migraciones nuevas, no ediciones.

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
```

---

## 4. Modelos de dominio (`schema.prisma`)

Migración `0002_domain` (PR3 de Fase 2). Se crean **vacías**.

### 4.1 Empresas y sedes

```prisma
model client_company {
  id               Int              @id @default(autoincrement())
  parent_id        Int?
  parent           client_company?  @relation("company_hierarchy", fields: [parent_id], references: [id], onDelete: Restrict)
  children         client_company[] @relation("company_hierarchy")
  name             String
  tax_id           String?          // RIF J/G+dígitos. Requerido si is_group=false (CHECK §6)
  is_group         Boolean          @default(false)
  shared_employees Boolean          @default(false)
  status           record_status    @default(active)
  address          String?

  // fallback de umbrales de asistencia (ver 07 §1.9). null → sin default de empresa
  late_tolerance_min        Int?
  early_leave_tolerance_min Int?
  absence_rule              absence_rule?
  absence_min_hours         Int?

  created_at DateTime @default(now()) @db.Timestamptz(6)
  updated_at DateTime @updatedAt @db.Timestamptz(6)

  sites           site[]
  employments     employment[]
  employee_groups employee_group[]
  devices         device[]

  @@index([parent_id])
}

model site {
  id         Int            @id @default(autoincrement())
  company_id Int
  company    client_company @relation(fields: [company_id], references: [id], onDelete: Cascade)
  name       String
  code       String?
  status     record_status  @default(active)
  created_at DateTime        @default(now()) @db.Timestamptz(6)
  updated_at DateTime        @updatedAt @db.Timestamptz(6)

  devices     device[]
  employments employment[]

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
  site_id           Int?
  site              site?             @relation(fields: [site_id], references: [id], onDelete: SetNull)
  employee_group_id Int?
  employee_group    employee_group?   @relation(fields: [employee_group_id], references: [id], onDelete: SetNull)
  position_id       Int?
  position          position?         @relation(fields: [position_id], references: [id], onDelete: SetNull)
  department_id     Int?
  department        department?       @relation(fields: [department_id], references: [id], onDelete: SetNull)
  payroll_ref       String?           // "Empleado Nómina" de Adempiere
  start_date        DateTime          @db.Date
  end_date          DateTime?         @db.Date
  status            employment_status @default(active)
  created_at        DateTime          @default(now()) @db.Timestamptz(6)
  updated_at        DateTime          @updatedAt @db.Timestamptz(6)

  attendance_days   attendance_day[]

  @@index([employee_id])
  @@index([company_id, status])
  @@index([employee_group_id])
}
```

`department_id` directo en `employment` **además** de `position.department_id`: es
intencional, espeja Adempiere ("Departamento Nómina" y "Puesto Nómina" eran campos
separados) y permite que el puesto cambie sin arrastrar el departamento.

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

  employments   employment[]

  @@index([department_id])
}
```

### 4.4 Grupos de horario y turnos

```prisma
model employee_group {
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
  employee_group_id Int
  employee_group    employee_group  @relation(fields: [employee_group_id], references: [id], onDelete: Cascade)
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

  @@index([employee_group_id, effective_from])
}
```

**Decisión: `start_time` como `String "HH:MM"`**, no `@db.Time`. Motivo: la hora
de turno es config, no dato calculado; `@db.Time` en Prisma vuelve como `Date` en
1970-01-01 y es confuso en JS. El motor de asistencia parsea la string. Revisar
si el cálculo SQL-side lo hace incómodo.

### 4.5 Biométrico a nivel empleado

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
  company_id        Int?
  company           client_company? @relation(fields: [company_id], references: [id], onDelete: SetNull)
  site_id           Int?
  site              site?           @relation(fields: [site_id], references: [id], onDelete: SetNull)
  last_sync_at      BigInt?         // última sync EXITOSA de marcajes (≠ last_seen_at heartbeat)
  device_admin_note String?         // admin del lado de la empresa (texto libre, NO app_user)

  enrollments          employee_device_enrollment[]
  sourced_fingerprints employee_fingerprint[]

  @@index([company_id])
}

model attendance_log {
  // ... campos de protocolo existentes ...
  employee_id Int?
  employee    employee? @relation(fields: [employee_id], references: [id], onDelete: SetNull)

  @@index([employee_id])
}
```

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
client_company ──(parent_id, self, 2 niveles, mutable)──┐
   │                                                     └── client_company
   ├──< site ──< device* ──< employee_device_enrollment >── employee
   │        │            └──< enroll_data*      (por dispositivo)
   │        │            └──< employee_fingerprint (source)
   │        └──< employment
   ├──< employee_group ──< shift
   │            └──< employment
   └──< employment >── employee
          ├── position >── department
          ├── department
          └──< attendance_day ──< attendance_correction >── app_user
attendance_log* >── employee            (employee_id nullable, resuelto)
employee ──< employee_fingerprint
app_user ──< audit_log
app_user ──< export_run

(*) tabla de protocolo existente
```

---

## 6. Constraints que Prisma no expresa (SQL crudo en la migración)

| Constraint | Dónde | Forma |
| --- | --- | --- |
| Jerarquía de 2 niveles | `client_company` | trigger `BEFORE INSERT/UPDATE`: rechazar si `parent_id` apunta a una fila cuyo `parent_id IS NOT NULL`. (CHECK no puede — necesita subquery.) |
| RIF requerido en empresas hoja | `client_company` | `CHECK (is_group OR tax_id IS NOT NULL)` |
| Un enrolado activo por slot | `employee_device_enrollment` | `CREATE UNIQUE INDEX … (dev_id, device_user_id) WHERE status = 'active'` |
| Corrección apunta a día **o** log, no ambos ni ninguno | `attendance_correction` | `CHECK ((attendance_day_id IS NULL) <> (attendance_log_id IS NULL))` |
| Rangos de fecha coherentes | `employment`, `shift` | `CHECK (end_date IS NULL OR end_date >= start_date)` / `effective_to` |
| CHECKs de protocolo (`status`, `stage`, `direction`) | tablas de protocolo | ya previstos en `0001` (plan de Fase 2) |

---

## 7. Orden de migraciones

| Migración | PR | Contenido |
| --- | --- | --- |
| `0001_protocol_baseline` | Fase 2 · PR1 | Las 8 tablas de protocolo tal cual (bigint millis, CHECKs crudos, `@@unique` de asistencia, sin FKs, sin columnas de dominio). |
| `0002_domain` | Fase 2 · PR3 | Todos los modelos de §4 + enums de §3 + columnas nuevas en `device` / `attendance_log` (§4.6) + constraints crudos de §6. Tablas vacías. |

Se puede partir `0002` en `0002_domain_core` (empresas/sedes/personas/categorías/
grupos-turnos/biométrico) y `0003_attendance_platform` (attendance_day/correction/
app_user/audit/export) si la revisión lo pide. Por defecto, una sola migración de
dominio.

**Seeds mínimos** (script aparte, no migración): 1 `app_user` inicial para poder
entrar al panel una vez que exista auth.

---

## 8. Alcance del cálculo de asistencia (de `07` §8) — DECIDIDO

**Fase 1 incluye el motor de cálculo de asistencia.** `attendance_day`,
`attendance_correction` y las columnas de umbral en `employee_group` /
`client_company` se pueblan y usan en Fase 1. El detalle de qué calcula el motor
y qué queda para Fase 2 (valoración legal, feriados) está en `07-admin-ux-spec.md`
§8. No hay cambios de schema por esta decisión — el diseño de §4 ya lo contempla.

---

## 9. Checklist de firma — CONFIRMADO (2026-08-30)

- [x] Jerarquía de empresas: adjacency list `parent_id`, 2 niveles, mutable, sin historia
- [x] `employee` (persona) + `employment` (N, sin constraint de exclusividad)
- [x] `site` y `employee_group` como entidades propias
- [x] Umbrales de tardanza/ausencia en `employee_group` con fallback a `client_company`
- [x] `app_user` con `role` pero sin matriz de permisos en Fase 1
- [x] `employee_fingerprint` (copia canónica por empleado) separada de `enroll_data` (por dispositivo)
- [x] Timestamps: protocolo `bigint` millis, dominio `timestamptz`
- [x] Alcance §8: **Fase 1 incluye el motor de cálculo de asistencia** (valoración legal → Fase 2)
