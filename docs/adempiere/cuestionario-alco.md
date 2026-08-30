# Cuestionario para Grupo ALCO — lo que Adempiere no responde solo

Respondé lo que sepas; el resto se lo pasamos a ALCO. Cada respuesta acota una decisión de modelo de datos que es cara de cambiar después. Las preguntas marcadas **(baja prioridad)** no bloquean el diseño — respondé primero el resto.

## 1. Empresas cliente

- Las ~40 empresas cliente, ¿se agrupan en grupos empresariales (una empresa "madre" con varias empresas del mismo grupo)? ¿Cuántos grupos hay, aproximadamente? _(confirmado en Adempiere que la jerarquía existe — ver ejemplo real "GRUPO FARMALIDO, C.A." con 5 empresas hijas — falta saber si el sistema nuevo debe replicarla)_
- Cuando ALCO arma un reporte o un export de nómina, ¿lo hace **por empresa individual**, **por grupo**, o ambos?
  _Deberia poderse Ambos_
- ¿Los dispositivos y los empleados se asignan siempre a una empresa individual (la hija), nunca directo al grupo?
  _Deberia poderse Ambos_
- ¿Una empresa puede pertenecer a más de un grupo? (esperado: no)
  _NO_
- ¿Puede haber grupos de grupos (3+ niveles)? (esperado: no, tope 2)
  _TOPE 2_
- ¿Qué significa el campo "Entidad Acumulada" en la ficha de organización de Adempiere? ¿Marca las que son solo agrupadoras (sin empleados/dispositivos propios)?
  _Marca en Adempiere las que son o pueden ser empresas padre_
- El total de organizaciones cargadas en Adempiere (~32) vs. las "~40 empresas cliente" mencionadas en la propuesta — ¿a qué se debe la diferencia?
  _Redondeo_

## 2. Empleados

- ¿Qué identifica a un empleado de forma única? ¿Cédula? ¿Un código interno de ALCO? ¿Ambos? _(el sistema nuevo va a usar cédula como identificador principal — confirmar que no hay ningún caso donde eso no alcance, ej. extranjeros sin cédula venezolana)_
- **Traslado de empleado** entre empresas o categorías: ¿es el **mismo legajo** que cambia de empresa (conservando su historia), o se da de baja en una y se crea de nuevo en la otra?
  _Seria bueno mantener el historial, ALCO tambien hace de reclutadores_
- Cuando un empleado se va (**baja**): ¿se borra, o queda marcado como inactivo con fecha de egreso? ¿Se siguen consultando sus marcajes históricos después?
  _Se mantiene como inactivo o sin vincular a una empresa_
- Un mismo empleado, ¿puede estar activo en dos empresas a la vez? _(evidencia real en Adempiere: un mismo Socio del Negocio puede tener múltiples "Contrato de Empleado", uno por organización — ver `views/empleado.md`. El modelo lo soporta técnicamente; falta confirmar si es un patrón intencional en la operación de ALCO o dato de prueba)_
- El campo "Nombre de los Padres" que aparece en la ficha de Adempiere — ¿tiene uso real hoy, o es un campo del sistema genérico que nunca se llenó? **(baja prioridad)**
  _No importa_
- La ficha de empleado tiene un campo "Imagen de Pulgar" (una imagen, no un template biométrico binario) — ¿qué contiene realmente? ¿Es una foto de referencia, o tiene relación con la huella real que usa el dispositivo? Importante no confundirlo con el dato biométrico funcional del protocolo.
  _Ni idea, ignorar, las huellas van a ser parte de la info del empleado para en el nuevo sistema poder ser usadas en diferentes biometricos_
- El campo "R.I.F." aparece como requerido en la ficha de un empleado (persona natural) — ¿se usa realmente para empleados, o es un campo heredado del modelo genérico?
  _Deberia ser requerido, en Venezuela se pide eso para emplear_

## 3. Vínculo con el biométrico

- En el equipo biométrico cada persona es un número (`user_id`, ej. "1", "2"). ¿Cómo se sabe hoy qué empleado es el `user_id` 5 del equipo de la sede X? ¿Hay una tabla/campo que los relaciona, o se hace "de memoria"?
_Deberia haber una relacion entre `user_id` interno del dispositivo X y el id del empleado como tal del sistema._
- ¿Un mismo empleado está enrolado en **varios equipos** (su sede + backup), o siempre en uno solo?
_Varios_
- Si a un empleado lo mueven de sede, ¿hay que re-enrolar su huella en el equipo nuevo, o se copia? **Confirmado: ALCO indicó que la migración de huellas entre dispositivos sí debe ser posible, y que hoy no se ha logrado hacer funcionar** — si tienen más detalle de qué intentaron y por qué falló, ayuda mucho.Nota: _Esto debe ser automatico en la misma empresa padre si se marca como "Empleados Compartidos"_
- Los dispositivos legacy en Adempiere muestran un campo "Servidor" enmascarado y puerto `29092` (Kafka) — ¿saben si hoy realmente usan/dependen de esa conexión, o es de una integración vieja que ya no corre? **(baja prioridad, solo para descartar)**
_No importa_

## 4. Categorización

- ¿Qué categorías se le ponen a un empleado? (cargo, departamento, tipo de jornada, centro de costo, ...). Listá las que usen.
_Deberiamos controlar esto desde el panel_
- ¿Esas listas de categorías son fijas, o ALCO las edita seguido (agrega cargos, departamentos)?
_Dinamicas, como te dije arriba, deberiamos controlar esto desde el panel_
- ¿Alguna categoría afecta el cálculo de asistencia (ej. "tipo de jornada" define el horario)?
_Probablemente, en la implementación del sistema de nominas completo (fase 2)_
- En Adempiere, `Departamento` (45 registros) y `Puesto` (288 registros) sí tienen datos cargados — con 288 puestos, ¿todos están en uso activo, o hay un subconjunto chico que realmente se usa?
_Esto deberá subirse eventualmente_
- El campo "Manager" de `Departamento` — ¿referencia a un empleado responsable de ese departamento? ¿Es relevante (ej. para aprobar correcciones de marcaje)?
_No relevante en fase 1_
- El campo `Grado` (24 registros, ej. "Cuarto Año") — ¿aplica solo a empresas cliente tipo colegio/institución educativa, o es genérico?
_Probablemente no_
- `Estructura Salarial`, `Designación`, `Tipo de Habilidad`, `Tipo de Empleado` y `Carrera` aparecen sin ningún registro cargado en Adempiere — ¿realmente no se usan, o simplemente nunca se cargaron datos ahí? **(baja prioridad)**
_No relevante fase 1_

## 5. Horarios y asistencia

- ¿El horario se define **por empresa**, por grupo de empleados, o por empleado individual?
_Grupo de empleados_
- Turno diurno vs nocturno: ¿qué lo distingue exactamente? (ej. el nocturno cruza medianoche)
_No lo sé_
- Tolerancias: ¿cuántos minutos de atraso antes de contar "tardanza"? ¿Hay tolerancia de salida anticipada?
_Deberia ser configurable_
- ¿Qué cuenta como "ausencia"? (no marcó entrada / no marcó nada / marcó menos de X horas)
_No lo sé_
- **Corrección manual de marcaje:** ¿quién puede hacerla? ¿Se exige un motivo? ¿Queda registro de quién y cuándo? (el contrato lo exige — confirmar cómo lo hace Adempiere hoy)
_No sé como lo hace Adempiere (probablemente no lo haga) pero nosotros si_
- En Adempiere existen dos conceptos que parecen distintos pero se solapan: `Grupo de Trabajo` y `Grupo de Turnos` — ambos terminan asociados a un `Turno de Trabajo`, pero por caminos distintos. ¿Son dos cosas reales y separadas en cómo opera ALCO, o es redundancia del sistema viejo que se puede simplificar a una sola?
_Simplifiquemosla a 1 sola por ahora_
- ¿Qué es "Incidencia de Turno"? Aparece en Adempiere pero no se pudo abrir un registro para verlo.
_No lo sé_
- Vimos dos niveles de "días de la semana" configurables: "Días de Descanso" a nivel de Grupo de Turnos, y "Día de Trabajo" a nivel de Turno de Trabajo específico. ¿Hace falta esa distinción en dos niveles, o alcanza con uno?
_No lo sé_
- Existe en Adempiere un mecanismo de importación batch de marcajes con 157,674 registros cargados, todos fallando con el error "Turno de Trabajo no encontrado" y fechas de 2023. **Hipótesis nuestra: probablemente no se usa hoy**, porque con el sistema nuevo conectado en vivo a los dispositivos no debería hacer falta un import manual — ¿confirman que no lo usan activamente?
_No lo sé_

## 6. Reportes y export a nómina

- ¿Cada cuánto se genera el archivo para nómina? (quincenal, mensual)
- ¿El archivo es uno solo para todas las empresas, o uno por empresa?
- Adjuntá una muestra real en `exports/nomina-actual.xlsx`. ¿Las columnas de ese archivo están fijas hace tiempo, o cambian?
- ¿El sistema de nómina de destino cómo se llama? ¿Importa un CSV, un Excel con formato específico, otra cosa?
- Además del consolidado, ¿qué otros reportes sacan hoy de Adempiere para biométricos? (listado de tardanzas, de ausencias, de horas extra, ...) _(el "Reporte de Registro de Asistencia" que ya vimos es un log crudo de marcajes — sin cálculo de horas/tardanzas/ausencias — necesitamos saber si el consolidado real vive en otro reporte que no hemos visto, o si ALCO lo arma manualmente hoy a partir de este log crudo)_
- En el reporte de Adempiere aparecen los campos "Código de Validación" y "Código de Dispositivo" — ¿saben qué representa cada uno exactamente? **(baja prioridad)**

## 7. Usuarios de la plataforma (los 4 de ALCO)

- ¿Quiénes son los 4 y qué hace cada uno? ¿Todos hacen de todo, o hay roles distintos (ej. uno solo administra empresas, otro solo revisa asistencia)?
- ¿Alguna acción debería estar restringida a ciertos usuarios? (borrar empresa, corregir marcaje, exportar nómina)
- En Adempiere, ¿ALCO usa distintos "Roles" para esto, o todos entran con el mismo usuario?
- **Ya confirmado, no hace falta responder:** el admin de dispositivo por empresa (campo "Administrador (Dispositivo de Asistencia)" en Adempiere) es administración física del equipo en sitio, no un usuario dentro de la plataforma nueva — no hay conflicto con que solo los 4 de ALCO tengan acceso al sistema.
