# Ventanas: RRHH → Departamento, Puesto, Configuración del Empleado

**Ruta:** Gestión de Recursos Humanos y Nómina → Recursos Humanos
**Nota de formato:** estas nueve ventanas son formularios chicos y temáticamente relacionados (categorización de empleado) — se consolidan aquí en un solo archivo en vez de uno por ventana, por eficiencia. Avisar si se prefiere separarlas.

## Con uso real confirmado (tienen datos cargados)

### Departamento (45 registros)

| Campo                   | Ejemplo                          | Notas                                                                 |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------- |
| Compañía / Organización | `Grupo Alco` / (requerido)       |                                                                       |
| Código                  | `A55`                            |                                                                       |
| Nombre\*                | `DOCENTES`                       |                                                                       |
| Descripción             | `TODOS LOS DOCENTES VAN POR ACA` |                                                                       |
| Activo                  | ✅                               |                                                                       |
| Manager                 | (vacío en el ejemplo)            | Dropdown — probablemente referencia a un empleado                     |
| Fuerza Actual           | `658`                            | Aparenta ser de solo lectura — conteo de empleados en el departamento |
| Fuerza Requerida        | `0`                              | Editable                                                              |

**Sub-tab "Límite de consumo"** (`Compañía, Organización, Departamento Nómina, Producto, Desde Fecha, A Fecha, Comentarios, Expected Consumption`) — **fuera de alcance**, es control de consumo/presupuesto por departamento ligado a inventario/compras, sin relación con asistencia.

**Sección "Cuentas"** (`Actividad, Centro de Costos, Usuario 2/3/4`) — **fuera de alcance**, son dimensiones contables genéricas de Adempiere (reporting financiero), no relevantes para el sistema nuevo.

### Puesto (288 registros)

| Campo               | Ejemplo                | Notas                                                           |
| ------------------- | ---------------------- | --------------------------------------------------------------- |
| Código              | `1000002`              |                                                                 |
| Nombre\*            | `Operador de Maquina`  |                                                                 |
| Descripción         | `Manejo de maquinaria` |                                                                 |
| Departamento Nómina | `Area de maquinas`     | **FK a Departamento** — cada Puesto pertenece a un Departamento |

Misma sección "Cuentas" que Departamento — fuera de alcance por la misma razón.

**288 registros es un volumen considerable** — sugiere que "Puesto" se usa como catálogo detallado y específico (no solo 5-10 cargos genéricos). Confirmar con ALCO si esperan poder cargar/gestionar un catálogo de este tamaño en el sistema nuevo, o si en la práctica solo un subconjunto pequeño está realmente en uso activo.

### Nivel de Estudio (6 registros)

Lista simple de niveles educativos. Ejemplo visto: `Analfabeta`. Catálogo pequeño y estable — candidato a lista fija/enum en el esquema nuevo en vez de tabla editable, salvo que ALCO quiera poder agregar niveles.

### Grado (24 registros)

Ejemplo visto: `Cuarto Año` — sugiere fuertemente que es específico de empresas cliente tipo institución educativa (varias aparecen en la lista de "Organización": `UNIDAD EDUCATIVA COLEGIO ILUSTRE`, `COLEGIO ALEJANDRO HUMBOLDT`, `ASOCIACION CIVIL COLEGIO SIMON DIAZ`). **Ver pregunta abierta** — confirmar si este campo debe condicionarse a que la empresa cliente sea un colegio, o si aplica genéricamente.

## Sin registros reales confirmados (formulario se abrió vacío — footer `+*1/1`)

Adempiere abre un formulario en blanco cuando no hay registros existentes que mostrar — esa fue la señal en las cuatro ventanas siguientes. Tratar como **posiblemente sin uso real**, pendiente de confirmar con ALCO (puede que Adempiere simplemente no tuviera datos cargados en el momento del relevamiento, no necesariamente que nunca se usen).

### Estructura Salarial

Campos: `Nombre*`, `Descripción`, `Válido Hasta*` (fecha, requerida). Sub-tab "Línea de Estructura Salarial": `Secuencia, Salary component, Porcentaje, Activo`. **Es configuración de cálculo de nómina** (componentes salariales con porcentajes) — confirma que está fuera del alcance de lógica de negocio de Fase 1, más allá de si tiene datos o no.

### Designación

Campos: `Nombre*`, `Tipo de Empleado` (dropdown), `Nómina` (dropdown), `Estructura Salarial*` (dropdown, requerido). Depende de `Estructura Salarial` — como esta última parece no tener datos, es coherente que `Designación` tampoco.

### Tipo de Habilidad

Solo `Nombre*` y `Descripción`. Simple, pero sin datos visibles.

### Tipo de Empleado

Campos: `Nombre*`, `Nómina*` (requerido), `Nivel Salarial*` (requerido). También atado a conceptos de nómina.

### Carrera

El popup de búsqueda no mostró ningún resultado — mismo patrón, sin datos visibles.

## Preguntas abiertas (→ `cuestionario-alco.md`)

1. ¿`Estructura Salarial`, `Designación`, `Tipo de Habilidad`, `Tipo de Empleado` y `Carrera` realmente no se usan, o simplemente no tenían datos cargados en el momento de la captura?
2. ¿El campo `Grado` (24 registros, ej. "Cuarto Año") debe condicionarse a empresas cliente tipo colegio/institución educativa, o aplica de forma genérica a cualquier empresa?
3. Con 288 `Puesto` cargados, ¿todos están realmente en uso activo, o hay un subconjunto pequeño que se usa en la práctica y el resto es histórico/legado?
4. `Departamento.Manager` — ¿referencia a un empleado? ¿Es relevante para el sistema nuevo (ej. quién aprueba correcciones de marcaje de ese departamento)?
