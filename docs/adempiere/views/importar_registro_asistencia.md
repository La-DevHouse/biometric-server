# Ventanas: Importar Registro de Asistencia (batch y por empleado)

**Ruta:** Gestión del Sistema → Datos → Importar Datos
**Confirmado:** es la ruta de importación manual/batch de marcajes — resuelve la pregunta abierta en `cuestionario-alco.md` sobre para qué se usa.

## Hipótesis fuerte (29/ago, sin confirmar con ALCO todavía)

**Probablemente no se usa en el día a día, y tiene sentido por qué:** si el sistema nuevo está conectado en vivo a los dispositivos (push/poll cada ~11s, ver `03-device-network.md`), no hay necesidad de un mecanismo de importación batch — los marcajes llegan solos. La única razón para que algo así exista sería una **migración de histórico** de datos de asistencia previos al sistema nuevo — y eso ya está explícitamente fuera del alcance de Fase 1 salvo que se contrate como trabajo adicional (`01-requirements.md`, sección "Explícitamente fuera de Fase 1").

**Implicación para el diseño:** el sistema nuevo no necesita replicar este mecanismo de importación batch como parte de su operación normal. Si más adelante se contrata una migración de histórico como proyecto aparte, ahí sí vale la pena entender por qué fallaban estos 157,674 registros — pero no antes, y no como parte de Fase 1.

**Pendiente:** confirmar con ALCO que efectivamente no lo usan activamente, antes de descartarlo del todo — la hipótesis es razonable pero no verificada.

## Ventana 1: "Importar Registro de Asistencia" (batch, todos los empleados)

### Popup de filtro al abrir ("Encontrar registro: Importador")

| Campo                       | Notas                                     |
| --------------------------- | ----------------------------------------- |
| Hora de Asistencia          | Rango de fechas (dos campos, desde/hasta) |
| Empleado (Socio de Negocio) | Búsqueda por empleado específico          |

Se puede cerrar sin filtrar — abre la grilla completa sin restricción.

### Grilla (tabla de staging/importación)

| Columna                     | Ejemplo                                                   | Notas                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compañía                    | `Grupo Alco`                                              | Fijo, tenant raíz                                                                                                                                          |
| Organización                | `INVERSIONES AQUIRA, C.A.`                                | Empresa cliente — coincide con la ventana `Organización` ya documentada                                                                                    |
| Activo                      | ✅                                                        | Boolean                                                                                                                                                    |
| Lote de Asistencia          | (vacío en la muestra)                                     | Posible agrupador de importaciones por lote/corrida                                                                                                        |
| Registro de Asistencia      | (vacío en la muestra)                                     | Presumiblemente el link al registro final una vez procesado — vacío porque nada se procesó                                                                 |
| Código de Validación        | `7393015`                                                 | **?** — coincide numéricamente con la cédula de varias filas (sin el prefijo `V`). Posible ID crudo del dispositivo antes de resolverse contra el empleado |
| Empleado Nómina             | `1000540`                                                 | ID numérico de nómina — sistema de identificación separado de la cédula                                                                                    |
| Código de Dispositivo       | `2022085388`                                              | Igual en todas las filas visibles — confirmar si varía en otras muestras                                                                                   |
| Hora de Asistencia          | `18/05/2023`                                              | Timestamp del marcaje                                                                                                                                      |
| Importado                   | ☐ (todas sin marcar en la muestra)                        | Boolean de estado                                                                                                                                          |
| Procesado                   | ☐ (todas sin marcar en la muestra)                        | Boolean de estado                                                                                                                                          |
| Mensaje Error Importación   | `Turno de Trabajo * No encontrado *` (todas las visibles) | Ver hallazgo crítico arriba                                                                                                                                |
| Empleado (Socio de Negocio) | `V7393015-Maria Guillermina`                              | Formato cédula venezolana + nombre — segundo sistema de identificación del empleado, distinto de "Empleado Nómina"                                         |

**Patrón reconocible:** esto es una tabla de staging típica de import de ERPs tipo Adempiere — los datos crudos aterrizan aquí primero, se validan (de ahí el proceso "solo validar" de la ventana 2), y solo si pasan validación se promueven a un registro final de asistencia. El estado `Importado`/`Procesado` y el mensaje de error son el resultado de ese proceso de validación.

## Ventana 2: "Importar Registro de Asistencia (Por Empleado)"

Formulario de parámetros, no grilla directa:

| Campo                              | Default                | Notas                                                                                                                                                                                     |
| ---------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organización                       | (vacío)                | Filtro por empresa                                                                                                                                                                        |
| Socio del Negocio                  | (vacío)                | Filtro por empleado específico                                                                                                                                                            |
| Borrar viejos registros importados | ☐ sin marcar           | Si se marca, presumiblemente limpia importaciones previas antes de repetir                                                                                                                |
| Sólo validar datos                 | ✅ marcado por default | **Modo dry-run** — valida sin importar de verdad. Confirma que el proceso de validación (el que está fallando masivamente arriba) es un paso explícito y separado de "importar de verdad" |

## Preguntas abiertas (→ `cuestionario-alco.md`)

1. **¿Es este mecanismo de importación un flujo activo que ALCO usa hoy, o quedó abandonado?** Los 157,674 registros con error masivo de "Turno de Trabajo no encontrado" y fechas de 2023 sugieren que puede llevar tiempo sin funcionar. Crítico confirmar antes de diseñar algo equivalente en el sistema nuevo.
2. **¿Qué causa el error "Turno de Trabajo _ No encontrado _"?** ¿Es que el empleado no tiene un turno/horario asignado en Adempiere al momento de la importación? Si es así, ¿por qué son _todos_ los registros visibles, no solo algunos?
3. **¿Por qué existen dos sistemas de identificación de empleado en paralelo** (`Empleado Nómina` numérico vs. `Empleado / Socio de Negocio` por cédula)? ¿Cuál es la fuente de verdad?
4. **¿Qué es exactamente "Código de Validación" y por qué "Código de Dispositivo" se repite igual en todas las filas de la muestra?**
5. **¿Existe un "Lote de Asistencia" real en uso**, o ese campo casi siempre queda vacío en la práctica?
