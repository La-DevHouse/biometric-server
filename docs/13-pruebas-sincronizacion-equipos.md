# Plan de pruebas con equipos físicos: alcance, contratos y sincronización

Estado: **por ejecutar.** Cubre todo lo que hace el reconciliador de huellas
(`docs/10` §4), el worker de cron (`docs/10` §5) y lo que cambia el alcance: equipos,
sedes, empresas, grupos y contratos de trabajo. Retoma los pendientes de `10` §7.2
(T6, T7, T10–T14); cada prueba de acá dice a cuál corresponde.

**Material:** 2 equipos (**A** = `2023081133`, **B** = `2023081158`) y tus 10 dedos.
**Truco central:** cada dedo es una persona de prueba distinta (una cédula ficticia
por dedo), así se prueban varios empleados con una sola mano.

Resultado de cada prueba: ✅ / ❌ + nota. Todo hallazgo del equipo va a `05` y a `10`
§7.3 en el mismo cambio.

---

## 0. Antes de empezar

### 0.1 Seguro contra el lockout (obligatorio, en A y en B)

En **cada** equipo, desde su teclado:

1. Crear un usuario **`9001`** con privilegio **Administrador (MANAGER)**, **con
   huella y con contraseña** (por si el lector falla).
2. Verificar que en el panel, Equipo → **Usuarios**, `9001` aparece como:
   - **IDs que no son la cédula de ningún empleado (no se tocan)**, y además
   - privilegio **Admin**.

Queda doblemente protegido: el reconciliador **nunca** toca un ID que no sea la cédula
de un empleado, ni un MANAGER u OPERATOR (`10` §4.5). **No uses nunca `9001` como
cédula de un empleado** y no lo borres desde el panel. Si en algún momento no aparece en
Usuarios, **se frena todo** hasta entender por qué.

Antes de cada bloque, revisá que `9001` siga en los dos equipos (entrar al menú del
equipo con su huella alcanza).

### 0.2 Entorno

- Servidor local + worker, con los equipos apuntando a tu máquina (como en `10` §7.3).
- En `.env` (lo leen la app **y** el worker; reiniciar los dos al cambiarlo):
  - `SYNC_FINGERPRINTS_INTERVAL_MIN=2` → el cron corre cada 2 min (en vez de 30), así
    se ven las corridas automáticas sin esperar.
  - `SYNC_ATTENDANCE_CRON="*/10 * * * *"` → el pull de asistencia cada 10 min (en vez de
    02:00), solo para el bloque G.
- `npm run dev` (puerto 4000) y en otra terminal `npm run worker:dev` (tiene que decir
  `[worker] listo`). Salud del worker: `curl localhost:3001/health`.
- Dejá abiertos los logs de las dos terminales y el panel **Procesando**.

### 0.3 Datos de prueba

**Personas** (Empleados → +). Cédulas ficticias, un dedo cada una. Anotá qué dedo es
cuál y no los mezcles:

| Persona | Cédula | Dedo |
| --- | --- | --- |
| P1 | V-30000011 | pulgar derecho |
| P2 | V-30000012 | índice derecho |
| P3 | V-30000013 | medio derecho |
| P4 | V-30000014 | anular derecho |
| P5 | V-30000015 | meñique derecho |
| P6 | V-30000016 | pulgar izquierdo |
| P7 | V-30000017 | índice izquierdo |
| P8 | V-30000018 | medio izquierdo |

Quedan libres el anular y el meñique izquierdos para los casos de duplicados (bloque E).

**Empresas** (Empresas → +), cada una con su sede:

| Empresa | Sedes | Grupo |
| --- | --- | --- |
| E1 "Prueba Uno" | S1a, S1b | G "Grupo Prueba" (Compartir empleados **sí**) |
| E2 "Prueba Dos" | S2 | G |
| E3 "Prueba Tres" | S3 | sin grupo |

Los equipos arrancan **sin sede** (pendiente de asignar).

### 0.4 Dónde mirar en cada paso

| Qué | Dónde |
| --- | --- |
| Quién está en un equipo, con cuántas huellas (físicas / copiadas), qué falta o sobra | Equipo → **Usuarios** (y "Releer usuarios" para forzar la lectura) |
| En qué equipos está una persona y con cuántas huellas | Empleado → **Equipos y huellas** |
| Estado de todos los empleados de una empresa | Empresa → **Empleados** |
| Última corrida, bajas frenadas | Equipo → **Información** |
| Lo que se está ejecutando | Panel **Procesando** |
| La verdad física | La pantalla del equipo (Gestión de usuarios) y **marcar con el dedo** |

"Marca" = el equipo reconoce el dedo y la marcación aparece en Equipo → Marcaciones con
la persona correcta. **La única prueba de que una huella llegó es que marque.**

---

## A. Equipos y sedes

| # | Pasos | Esperado | T |
| --- | --- | --- | --- |
| A1 | Con A y B sin sede, contratos de P1 en E1 (bloque B lo crea; acá alcanza con que exista) | A y B figuran **Pendiente de asignar**. No se agrega ni se quita a nadie (congelados). "Actualizar" solo lee el estado | T10d |
| A2 | Asignar **A → S1a** (E1). Mirar el aviso de impacto antes de guardar | El aviso dice cuántos ganan acceso. Al guardar arranca una corrida sola: los empleados de E1 (y de G) aparecen en A | — |
| A3 | Asignar **B → S1b** (E1, otra sede) | B se llena con las mismas personas que A (mismo alcance: sedes de la misma empresa) | T6 |
| A4 | Sacar a **A** de su sede (dejarla pendiente de asignar) | **Nadie se borra de A** (congelado); sigue marcando todo el mundo. Vuelve a S1a: sin cambios | T10d |
| A5 | Mover **B de S1b (E1) a S3 (E3)**. Mirar el aviso de impacto | El aviso lista quién pierde acceso a B. Se borran de B los de E1/G y se agregan los de E3; `9001` intacto | T12 |
| A6 | Desactivar la sede **S3** (B queda en una sede inactiva) | B queda **congelado**: no se borra a nadie. Reactivar S3: vuelve a sincronizar | — |
| A7 | **Equipo nuevo:** borrar B del registro no se puede; simularlo con "Asignar" desde cero: dejar B sin sede, borrar de B por teclado a todos menos `9001`, asignarla a S1a | B se rellena solo con todos los del alcance **con sus huellas** (copiadas, sin captura) | — |
| A8 | Sincronizar hora en A y B | La hora del equipo coincide con la de la zona de la sede | T14 |

## B. Contratos de trabajo

A → S1a (E1), B → S2 (E2), G comparte empleados.

| # | Pasos | Esperado | T |
| --- | --- | --- | --- |
| B1 | Contrato de **P1 en E1**, sin huella todavía | P1 aparece en A **y en B** (grupo compartido) sin huella; en pantalla, usuario `30000011` sin dedo | T6, T7a |
| B2 | Enrolar el **pulgar derecho** para `30000011` en el teclado de **A** | En ~1 min: la huella llega a B (Usuarios de B: 0 físicas / 1 copiada). **P1 marca en B** | T6 |
| B3 | Enrolar un **segundo dedo** de P1 en el teclado de **B** (usar el índice izq. solo para P1 en esta prueba y borrarlo al final, o repetir con P2) | Llega a A. P1 queda con 2 huellas en los dos equipos | T6 |
| B4 | **Editar** el contrato de P1 (puesto, horario) | Nada cambia en los equipos | — |
| B5 | Editar la **fecha de inicio** de P1 a una **futura** | Antes de guardar, el aviso dice que P1 pierde acceso. Al guardar, P1 sale de A y B. Volver la fecha a hoy → vuelve **con sus 2 huellas**, sin capturar | — |
| B6 | **Dar de baja** a P1 con fecha de hoy | Aviso de impacto; P1 se borra de A y B; **P1 no marca** en ninguno | T10a |
| B7 | **Reingreso:** contrato nuevo de P1 en E1 | P1 vuelve a A y B **con sus huellas** (desde la copia de referencia, sin capturar). Marca en los dos | T11 |
| B8 | Dar de baja con **fecha futura** (ej. dentro de 7 días) | ⚠️ **Hoy sale de los equipos en el momento** (la baja deja el contrato inactivo ya). Anotar si es lo que queremos o si debería seguir hasta esa fecha → decisión | — |
| B9 | **Dos contratos:** P2 con contrato en E1 **y** en E3 (sin grupo). Mover B a S3 | P2 está en A (por E1) y en B (por E3) = la unión. Dar de baja el de E3 → sale solo de B | T7d |
| B10 | **Traslado:** P3 en E1 → dar de baja en E1 + contrato nuevo en E3 (B en S3) | P3 sale de A, entra en B con su huella; en el historial quedan los dos contratos | — |
| B11 | Contrato con **inicio futuro** desde el alta (P4, empieza mañana) | P4 no entra a ningún equipo hoy. Al día siguiente (o poniendo la fecha a hoy) entra en la próxima corrida del cron | O11 |
| B12 | Persona **sin contrato** (P8, pool) con huella enrolada por teclado en A con su cédula | Ver bloque E4 | — |

## C. Grupos y empresas

Estado inicial: A → S1a (E1), B → S2 (E2), G comparte. P1 (E1) y P5 (E2), ambos con huella.

| # | Pasos | Esperado | T |
| --- | --- | --- | --- |
| C1 | Situación inicial | P1 y P5 están en A y en B, marcan en los dos | T7a |
| C2 | **Apagar "Compartir empleados"** en G. Mirar el aviso | Aviso: P1 pierde B, P5 pierde A. Se borran cruzados; cada uno queda solo en el equipo de su empresa | T7b |
| C3 | Volver a prenderlo | Vuelven cruzados **con huellas** | — |
| C4 | Sacar **E2 del grupo** (editar empresa → sin grupo) | Igual que C2 para P5/P1 | — |
| C5 | **Desactivar el grupo** G | Como C2 | — |
| C6 | **Desactivar la empresa E2** | B (sede de E2) queda **congelado**: P5 sigue en B. P5 sale de A (su contrato ya no da alcance). Anotar si esto es lo deseado (no hay aviso de impacto al desactivar empresa, `10` O12) | — |
| C7 | **Empresa nueva** E4 con sede S4, mover A a S4, contrato de P6 en E4 | A queda con P6 (+ `9001`); los de E1 salen de A (si son más de 5, ver D5) | — |

## D. Salvaguardas

| # | Pasos | Esperado | T |
| --- | --- | --- | --- |
| D1 | En cualquier momento | `9001` sigue en A y B, nunca aparece como "se quita" | — |
| D2 | Poner a P1 como **Admin** en B (Usuarios → privilegio) y darle de baja | P1 **no se borra de B** (aparece en "Admins fuera del alcance, nunca se tocan"); sí se borra de A | T10b |
| D3 | Crear por teclado en A un usuario **`777`** (no es cédula de nadie) con un dedo libre | No se toca; aparece en "IDs que no son la cédula…". Borrarlo a mano al final | T10c |
| D4 | **Borrar a mano** desde el panel (Usuarios → eliminar) a P1 de A, estando en alcance | El diálogo avisa que se va a volver a crear. En la siguiente corrida P1 vuelve a A con su huella | — |
| D5 | **Freno de bajas masivas.** Con `SYNC_MAX_REMOVALS_PER_DEVICE=1` (y reiniciar app + worker): 3 personas en B, dar de baja a las 3 | No se borra nadie de B; Información de B muestra **Bajas frenadas** con los 3. **Rechazar** → no pasa nada. Repetir y **Aprobar** → se borran los 3. Volver el valor a 5 | T10e |
| D6 | Enrolar por teclado un dedo a un usuario cuyo privilegio el sistema aún no leyó (recién creado en el teclado) y sacarlo del alcance antes de la próxima lectura | No se borra mientras su privilegio sea desconocido (se trata como admin por las dudas) | — |

## E. Huellas: duplicados, límites y casos raros

| # | Pasos | Esperado | T |
| --- | --- | --- | --- |
| E1 | **El mismo dedo físico en los dos equipos para la misma persona:** con B desconectado de la red, enrolar el medio derecho de P3 en A **y** en B; reconectar B | Se copian cruzados: P3 queda con 2 copias del mismo dedo en cada equipo. Marca bien (es el mismo usuario). Anotar el conteo de huellas: el límite de 10 cuenta esos duplicados (`10` O2) | T8 |
| E2 | **El mismo dedo en dos personas** (enrolar el anular izquierdo para P4 en A y para P5 en B) | El equipo no detecta duplicados en escrituras (T8b): el dedo queda en P4 y en P5; **marca siempre el registro más antiguo** del equipo (T8c). Anotar a quién se le imputa en cada equipo. Borrar uno al final | T8c |
| E3 | **Más de 10 huellas:** P6 con 6 dedos enrolados en A y 6 distintos en B, con los equipos desconectados entre sí (B sin red); reconectar | Cada equipo recibe copias hasta llegar a 10 por persona; las que sobran quedan solo en la copia de referencia. Ficha de P6: **alerta** de huellas sin propagar | O8 |
| E4 | **Huella de alguien fuera del alcance:** P8 (sin contrato) creado por teclado en A con su cédula y un dedo | Se ingiere su huella (queda en su ficha), y como no tiene alcance en A **se borra de A** (si su privilegio es USER). Después, contrato de P8 en E1 → vuelve con esa huella sin capturar | — |
| E5 | **Borrar un dedo** de P1 desde el teclado de A (queda el usuario con 1 dedo) | Anotar qué hace el sistema: hoy la copia de referencia sigue activa y la vuelve a escribir en A (el dedo "reaparece"). Decidir si es lo deseado | — |
| E6 | Enrolar un dedo en A para P2 **mientras B está desconectado**; reconectar B | Al reconectar, B recibe la huella en su siguiente corrida (ver F4) | — |

## F. Cron, worker y equipos desconectados

| # | Pasos | Esperado | T |
| --- | --- | --- | --- |
| F1 | Con `SYNC_FINGERPRINTS_INTERVAL_MIN=2`, no tocar nada 5 min | Log del worker: `huellas: 2 corrida(s) encolada(s)` cada 2 min; en Información de cada equipo, "Última corrida" se actualiza (disparo `cron`). Sin cambios en los equipos | — |
| F2 | Parar el worker, hacer un cambio de contrato, arrancarlo | El cambio igual se aplica al momento (los disparos por evento los hace la app, no el worker); el worker retoma el cron | — |
| F3 | Parar la app 1 min con el worker corriendo | Worker: `/health` sigue en 200; las corridas que encola esperan a que los equipos consulten | — |
| F4 | **Equipo desconectado:** sacar de la red a B, dar de alta un contrato (P7 en E2), esperar 12 min, reconectar | Mientras está desconectado, la operación queda en cola y **a los 10 min se cancela** (comportamiento actual). Al reconectar, B se pone al día **en la siguiente corrida del cron** (≤ 2 min en prueba, ≤ 30 en producción) | — |
| F5 | "Sincronizar ahora" sobre B desconectado | Anotar el mensaje. Hoy no avisa antes de confirmar (pendiente de decidir, ver conversación de equipos desconectados) | — |
| F6 | Reiniciar el worker durante una corrida | No se duplican corridas del mismo equipo (una activa por equipo) | — |

## G. Asistencia

| # | Pasos | Esperado | T |
| --- | --- | --- | --- |
| G1 | P1 (contrato en E1) marca en **B** (sede de E2, grupo compartido) | La marcación sale en Equipo B → Marcaciones y en **E1 → Asistencia** (por contrato), no en E2 → Asistencia | T13 |
| G2 | Sacar B de la red, marcar 3 veces, reconectar | Llegan solas al reconectar, con su hora original, sin duplicados | T13 |
| G3 | Con `SYNC_ATTENDANCE_CRON="*/10 * * * *"` | Log del worker: `asistencia: N pull(s)`; no aparecen marcaciones duplicadas | T13 |
| G4 | Exportar E1 → Asistencia (rango de hoy) a Excel | Están las marcaciones de P1 en A y en B, con el nombre completo; ninguna de `9001` ni `777` | — |
| G5 | Dar de baja a P1 con fecha de ayer y exportar el día de hoy | Las marcaciones de hoy de P1 **no** salen (fuera del período del contrato) | — |

---

## Criterios de salida

Obligatorios antes de re-apuntar cualquier equipo real de Adempiere: **A2–A5, B1–B7,
C1–C2, D1–D5, F4 y G1** en ✅, y `9001` presente en los dos equipos al terminar.

Decisiones que salen de este plan (anotarlas en `10` §8): **B8** (baja con fecha
futura), **C6** (desactivar empresa sin aviso de impacto), **E5** (dedo borrado en el
equipo que el sistema vuelve a escribir), **F4/F5** (operaciones sobre equipos
desconectados).

## Limpieza al terminar

1. Dar de baja todos los contratos de prueba (los equipos se vacían solos de P1–P8).
2. Borrar a mano `777` y los duplicados de E2 si quedaron.
3. Confirmar que en A y B solo queda `9001` (y lo que tenías antes).
4. Volver `SYNC_FINGERPRINTS_INTERVAL_MIN`, `SYNC_ATTENDANCE_CRON` y
   `SYNC_MAX_REMOVALS_PER_DEVICE` a sus valores por defecto (sacarlos del `.env`).
