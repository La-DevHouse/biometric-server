# Ventanas: Registro de Asistencia (Dispositivos, Reportes, Grupos, Turnos)

**Ruta:** Gestión de Recursos Humanos y Nómina → Recursos Humanos → Registro de Asistencia
**Prioridad alta** — mapea directo a Hito 2 (dispositivos) e Hito 4 (horarios/turnos) del alcance de Fase 1.

## Dispositivos de Asistencia

La ventana real de gestión de equipos biométricos en Adempiere. **23 dispositivos registrados** (footer `1/23`).

| Campo                                     | Ejemplo visto                                                 | Notas                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organización                              | `UNIDAD EDUCATIVA COLEGIO ILUSTRE AMERICANO BARQUISIMETO C.A` | Un dispositivo pertenece a una empresa cliente                                                                                                                              |
| Número de Serie                           | (oculto tras dropdown en la captura)                          |                                                                                                                                                                             |
| Tipo de Aplicación                        | `Dispositivo de Control de Asistencia`                        |                                                                                                                                                                             |
| **Aplicación Soportada**                  | `TAD-Kafka-Command_Time_Attendance (Kafka Command)`           | **⚠️ Ver hallazgo de arquitectura abajo**                                                                                                                                   |
| Nombre / Descripción                      | `U.E. COLEGIO ILUSTRE AMERICANO BARQUISIMETO, C.A.`           | Coincide con el nombre de la organización — el dispositivo se nombra igual que la empresa, no por número de equipo                                                          |
| Servidor                                  | (enmascarado, tipo password)                                  | Dirección del servidor/broker al que se conecta — enmascarado en la UI                                                                                                      |
| Puerto                                    | `29.092`                                                      | Casi seguro `29092` — puerto default de Kafka en configuraciones Docker típicas                                                                                             |
| Administrador (Dispositivo de Asistencia) | `V12247978-Ezequiel`                                          | **Confirma con caso real** el campo ya documentado en `views/organizacion.md` — es Ezequiel Alvarado (contacto de la propuesta comercial), registrado como Socio de Negocio |
| Super Usuario (Dispositivo de Asistencia) | (vacío en el ejemplo)                                         |                                                                                                                                                                             |

### ⚠️ Hallazgo de arquitectura: el sistema legacy usa Kafka, no HTTP directo

`Aplicación Soportada: TAD-Kafka-Command_Time_Attendance` + puerto `29092` (puerto default de Kafka) confirma que el sistema que estamos reemplazando se comunica con los dispositivos vía un **broker Kafka** — un modelo de mensajería asíncrona, distinto por completo del protocolo HTTP push que ya implementamos y verificamos contra hardware real (ver `04-device-protocol-real.md`).

**No hay que replicar esto.** Es contexto histórico de cómo funcionaba el sistema legacy, no un requisito del sistema nuevo — nuestro protocolo HTTP ya está probado y funcionando. Se anota para que el equipo no se confunda si aparece infraestructura o datos residuales de Kafka en el entorno de ALCO, y para tenerlo presente si en algún momento se pregunta "¿por qué el sistema viejo hacía esto distinto?".

## Reporte de Registro de Asistencia

Pantalla de parámetros de reporte (no se ejecutó todavía — es de solo lectura, no hay riesgo en dejarla sin correr).

**Descripción en pantalla:** _"Éste reporte muestra todos los registros de asistencia. Muestra todas las asistencias de los trabajadores en un rango de fecha y hora."_

| Parámetro                   | Notas                                                                          |
| --------------------------- | ------------------------------------------------------------------------------ |
| Organización                | Filtro opcional                                                                |
| Código de Dispositivo       | Filtro opcional                                                                |
| Código de Validación        | Filtro opcional — mismo campo visto en `views/importar-registro-asistencia.md` |
| Empleado (Socio de Negocio) | Filtro opcional                                                                |
| Hora de Asistencia          | **Requerido** — rango de fecha/hora                                            |
| Procesado                   | Filtro opcional                                                                |

Salida configurable: HTML, con opción de guardar el set de parámetros para reuso.

### Salida real capturada (29/ago) — `exports/marcajes.csv` del kit

Se corrió el reporte contra `A.C. GRUPO ALCO` (la organización interna de ALCO, no una empresa cliente real — usada como sandbox de prueba). 5 registros reales, dos empleados de prueba (`V12247978-Ezequiel`, el mismo visto como admin de dispositivo en la sección anterior; `V15668159-XIOLEIDY`; `V15777167-NAYDALI DE LOS ANGELES`).

**Columnas de salida:** `Empresa, Empleado (Socio de Negocio), Hora de Asistencia` — más una fila de subtotal por empresa (`<Empresa> №, <count>`) y una fila de total general (`Conteo, <total>`) al final del archivo.

**Formato de fecha/hora:** `DD/MM/YYYY hh:mm:ss a. m./p. m.` (12 horas, locale es-VE) — ej. `22/05/2026 08:27:42 a. m.`. Referencia útil si el sistema nuevo necesita generar algo visualmente compatible con lo que ALCO ya conoce.

**Hallazgo importante: este reporte es un log crudo de marcajes, no el "consolidado".** Solo trae Empresa + Empleado + Hora de Asistencia — sin horas trabajadas, tardanzas ni ausencias calculadas. Es el equivalente de Adempiere a nuestra tabla `attendance_logs`, no al "consolidado del período" que pide el PDF para el Hito 5. Ese cálculo probablemente no existe armado en Adempiere, o vive en un reporte distinto que falta identificar — ver pregunta en `cuestionario-alco.md`.

**Quirk del exportador:** el CSV trae una línea en blanco entre cada registro — artefacto del exportador de Adempiere, no replicar.

## Grupo de Turnos → Turno de Trabajo → Incidencia de Turno

Jerarquía de tres niveles, por organización (empresa cliente):

### Grupo de Turnos (nivel 1)

Ejemplo real visto: `Nombre: Administrativo`, `Descripción: Grupo Administrativo (administración, control de estudio, coordinadores, dirección y subdirección)`, `Organización: UNIDAD EDUCATIVA COLEGIO ILUSTRE...`

**Sección "Días de Descanso"** (a nivel del grupo completo): checkboxes Domingo–Sábado. Ejemplo: Domingo y Sábado marcados como descanso, Lunes–Viernes no.

### Turno de Trabajo (sub-tab, nivel 2 — hijo de Grupo de Turnos)

Ejemplo real visto:
| Campo | Valor |
|---|---|
| Código | `8/12-2/6` |
| Nombre | `6:30 AM ~ 1:30 PM` |
| Hora de Inicio / Fin de Turno | `06:30` / `13:30` |
| Hora Inicio / Fin de Descanso | `12:00` / `13:00` |
| Número de Horas | `6,00` |
| Entrada y Salida Variable | ✅ marcado |
| **Día de Trabajo** (checkboxes) | Lunes–Viernes marcados, Domingo y Sábado no |

**Nota importante:** "Días de Descanso" (a nivel Grupo de Turnos) y "Día de Trabajo" (a nivel Turno de Trabajo) son **dos campos de días de la semana distintos, en dos niveles distintos de la jerarquía** — no es redundante por error, parecen tener granularidad diferente (descanso general del grupo vs. días activos de un turno específico dentro de ese grupo). Confirmar con ALCO si ambos niveles son necesarios en el sistema nuevo o si se puede simplificar a uno solo.

### Incidencia de Turno (sub-tab, nivel 3 — no explorado)

Aparece **deshabilitado/en gris** en las capturas — probablemente requiere guardar un registro de `Turno de Trabajo` primero antes de habilitarse. Pendiente de explorar.

## Grupo de Trabajo → Planificación de Turno

Estructura paralela y aparentemente **distinta** de "Grupo de Turnos" — no está claro todavía cómo se relacionan entre sí.

### Grupo de Trabajo (nivel 1)

Ejemplo real: `Nombre: Grupo A`, `Secuencia: 0`, checkbox `Asignación de Turno` (sin marcar en el ejemplo).

### Planificación de Turno (sub-tab, nivel 2)

Grid con columnas: `Compañía, Organización, Grupo de Trabajo, Activo, Descripción, Período Nómina, Turno de Trabajo`. Ejemplo visto: fila `Grupo Alco | Grupo A_A | ...` — mayormente vacía, pero **confirma la relación**: un Grupo de Trabajo se vincula a un `Turno de Trabajo` a través de esta planificación.

## Preguntas abiertas (→ `cuestionario-alco.md`)

1. **¿En qué se diferencian `Grupo de Trabajo` y `Grupo de Turnos`?** Ambos terminan relacionándose con `Turno de Trabajo`, pero por caminos distintos (uno directo como hijo, otro vía "Planificación de Turno"). ¿Son dos conceptos reales distintos en la operación de ALCO, o redundancia del sistema legacy?
2. ¿Qué es "Incidencia de Turno"? No se pudo abrir (aparece deshabilitado) — ¿qué contiene y cuándo se habilita?
3. ¿Por qué existen dos niveles de "días de la semana" (Días de Descanso en Grupo de Turnos, Día de Trabajo en Turno de Trabajo)? ¿Ambos son necesarios en el sistema nuevo?
4. El campo `Servidor` enmascarado en `Dispositivos de Asistencia` — ¿es la dirección del broker Kafka legacy? Confirmar que es puramente histórico y no algo que el sistema nuevo deba leer o migrar.
