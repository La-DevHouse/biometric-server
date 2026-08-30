# Ventana: Empleado

**Ruta:** Gestión de Recursos Humanos y Nómina → Recursos Humanos → Empleado
**Estado: COMPLETO con datos reales (29/ago).** Se abrió el registro de Ezequiel Alvarado Isea (`C.I. V12247978`) — mismo Ezequiel visto como admin de dispositivo en `views/registro-asistencia.md` y en el reporte de marcajes. Estructura y valores reales documentados abajo.

## ⚠️ Hallazgo crítico: un Socio del Negocio puede tener múltiples "Contrato de Empleado"

El tab raíz `Socio del Negocio` es único por persona (footer `[1/1]`), pero el sub-tab `Contrato de Empleado` mostró **`1/2` — Ezequiel tiene dos contratos**, aparentemente uno por organización (el capturado está scoped a `UNIDAD EDUCATIVA COLEGIO ILUSTRE...`, no a `A.C. GRUPO ALCO`).

**Esto es evidencia real, no solo hipótesis, de que el modelo permite que una misma persona esté activa en más de una empresa a la vez** — responde con datos concretos la pregunta correspondiente del cuestionario. Falta confirmar con ALCO si esto es un uso intencional (ej. Ezequiel administra ambas) o dato de prueba/inconsistencia — pero el modelo de datos en sí ya lo soporta.

## Hallazgo de modelo de datos: Empleado es un rol sobre "Socio de Negocio"

**Empleado no es una entidad independiente en Adempiere — es un rol sobre el modelo unificado de "Socio de Negocio" (Business Partner)**, el mismo que se usa para proveedores y clientes (confirmado en el popup de búsqueda inicial, que trae flags `Proveedor`/`Cliente`/`Empleado`/`Prospecto Activo` sobre el mismo registro base).

**Implicación para el sistema nuevo:** no hace falta replicar ese modelo unificado — el sistema nuevo solo necesita la porción de "empleado", como entidad propia y simple. Es una simplificación deliberada respecto a Adempiere, no una omisión.

## Estructura y valores reales — Tab 1: "Socio del Negocio"

| Campo                                                           | Valor real (Ezequiel)        | Notas                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C.I                                                             | `V12247978`                  |                                                                                                                                                                                                                     |
| R.I.F                                                           | `V12247978`                  | **Mismo valor que C.I.** — confirma que para personas naturales el RIF es un duplicado sin aporte real. Baja prioridad para el esquema nuevo.                                                                       |
| Nombres / Apellidos                                             | `Ezequiel` / `Alvarado Isea` |                                                                                                                                                                                                                     |
| Descripción                                                     | `Colegio Ilustre Americano`  | Curioso — no es una descripción de persona, parece residuo del contexto de organización de este contrato específico. Los datos reales no están perfectamente limpios, no asumir estructura perfecta en ningún lado. |
| Grupo de Socio del Negocio                                      | `Empleados`                  |                                                                                                                                                                                                                     |
| Cumpleaños                                                      | `09/05/1973`                 |                                                                                                                                                                                                                     |
| Género / Grupo Sanguíneo / Lugar de Nacimiento / Estado Marital | Todos vacíos                 |                                                                                                                                                                                                                     |
| **Nombre de los Padres**                                        | **Vacío**                    | Refuerza (no confirma al 100% con un solo ejemplo) que no se usa en la práctica                                                                                                                                     |

## Tab 2: "Contrato de Empleado" (este ejemplo: scoped a UNIDAD EDUCATIVA COLEGIO ILUSTRE...)

| Campo                                | Valor real                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Imagen del Empleado                  | ✅ Foto real cargada                                                                           |
| **Imagen de Pulgar**                 | **Vacío** — refuerza que no es el vínculo funcional con la huella real del dispositivo         |
| Organización de la Trans.            | `J305399131-UNIDAD EDUCATIVA COLEGIO ILUSTRE AMERICANO BARQUISIMETO C.A`                       |
| Nómina                               | `Nómina Quincenal` — primer dato real de periodicidad de nómina                                |
| Departamento Nómina / Puesto Nómina  | `Gerencia` / `ENCARGADO`                                                                       |
| Fecha Inicio                         | `01/04/2021`                                                                                   |
| Grupo de Trabajo                     | `Grupo A_A`                                                                                    |
| Grupo de Turno                       | `GERENCIA GENERAL_GG` — mismo patrón `Nombre_ABREVIATURA` visto antes con `Administrativo_ADM` |
| Estado del Empleado                  | `Active`                                                                                       |
| Educación (todos los campos)         | Vacíos — confirma con dato real lo que ya sospechábamos sobre esta sección                     |
| Estructura Salarial / Rango Salarial | Vacíos                                                                                         |
| Salario Diario / Mensual             | `0,0` / `0,0`                                                                                  |
| Regla de Pago                        | `Efectivo`                                                                                     |

## Tab 3: "Atributo" — registro real de cálculo de nómina

| Campo           | Valor                          |
| --------------- | ------------------------------ |
| Concepto Nómina | `FA_SD_Factor Salario por Día` |
| Monto           | `66,666666667`                 |
| Válido Desde    | `01/01/2023`                   |

Confirma que el motor de atributos de nómina sí está en uso real (aunque fuera de alcance de Fase 1).

## Tab 4: "Cuenta Bancaria" — vacío

Todos los campos requeridos (Banco, C.I, No. de Cuenta, Nombre, Correo) sin llenar para este empleado. Confirma que en la práctica no siempre se carga.

## Tab 5: "Localización" — vacío

Dirección y teléfonos sin llenar para este empleado.

## Tab 6: "Contacto (Usuario)"

| Campo    | Valor                                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nombre   | `Ezequiel Alvarado Isea`                                                                                                                                         |
| Teléfono | `04145299886`                                                                                                                                                    |
| Email    | `admgrupoalco@gmail.com` — nota: es un correo administrativo compartido, no uno personal; no asumir que el email de "Contacto" siempre es personal del empleado. |

## Pendiente

- Confirmar con ALCO si los dos "Contrato de Empleado" de Ezequiel (uno por organización) son un patrón intencional en su operación, o dato de prueba.
- Idealmente, revisar un segundo empleado real (no un admin/usuario de prueba como Ezequiel) para confirmar que los patrones vistos (Educación vacía, campos bancarios vacíos, etc.) se sostienen y no son solo particularidades de este caso.

## Preguntas abiertas (→ `cuestionario-alco.md`)

1. ¿"Nombre de los Padres" se usa para algo en la práctica de RRHH de ALCO? (evidencia real: vacío en el único ejemplo visto)
2. ¿Qué contiene realmente el campo "Imagen de Pulgar"? (evidencia real: vacío en el único ejemplo visto — refuerza que no es el vínculo funcional con la huella del dispositivo)
3. ¿El R.I.F. duplicado del C.I. tiene algún uso real, o se puede omitir del esquema nuevo? (evidencia real: mismo valor exacto en ambos campos)
4. Los dos "Contrato de Empleado" de Ezequiel — ¿es un patrón intencional (una persona con rol en más de una empresa) o particularidad de este caso?
