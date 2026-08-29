# Cuestionario para ALCO — lo que Adempiere no responde solo

Respondé lo que sepas; el resto se lo pasamos a ALCO. Cada respuesta acota una
decisión de modelo de datos que es cara de cambiar después.

## 1. Empresas cliente

- Las ~40 empresas cliente, ¿se agrupan en grupos empresariales (una empresa
  "madre" con varias empresas del mismo grupo)? ¿Cuántos grupos hay,
  aproximadamente?
- Cuando ALCO arma un reporte o un export de nómina, ¿lo hace **por empresa
  individual**, **por grupo**, o ambos?
- ¿Los dispositivos y los empleados se asignan siempre a una empresa
  individual (la hija), nunca directo al grupo? Confirmar.
- ¿Una empresa puede pertenecer a más de un grupo? (esperado: no)
- ¿Puede haber grupos de grupos (3+ niveles)? (esperado: no, tope 2)

## 2. Empleados

- ¿Qué identifica a un empleado de forma única? ¿Cédula? ¿Un código interno de
  ALCO? ¿Ambos?
- **Traslado de empleado** entre empresas o categorías: ¿es el **mismo legajo**
  que cambia de empresa (conservando su historia), o se da de baja en una y se
  crea de nuevo en la otra?
- Cuando un empleado se va (**baja**): ¿se borra, o queda marcado como inactivo
  con fecha de egreso? ¿Se siguen consultando sus marcajes históricos después?
- Un mismo empleado, ¿puede estar activo en dos empresas a la vez?

## 3. Vínculo con el biométrico

- En el equipo biométrico cada persona es un número (`user_id`, ej. "1", "2").
  ¿Cómo se sabe hoy qué empleado es el `user_id` 5 del equipo de la sede X?
  ¿Hay una tabla/campo que los relaciona, o se hace "de memoria"?
- ¿Un mismo empleado está enrolado en **varios equipos** (su sede + backup), o
  siempre en uno solo?
- Si a un empleado lo mueven de sede, ¿hay que re-enrolar su huella en el equipo
  nuevo, o se copia? (contexto: hoy no se logra copiar huellas entre equipos)

## 4. Categorización

- ¿Qué categorías se le ponen a un empleado? (cargo, departamento, tipo de
  jornada, centro de costo, ...). Listá las que usen.
- ¿Esas listas de categorías son fijas, o ALCO las edita seguido (agrega cargos,
  departamentos)?
- ¿Alguna categoría afecta el cálculo de asistencia (ej. "tipo de jornada"
  define el horario)?

## 5. Horarios y asistencia (contexto para Hito 4 — no bloquea el schema base)

- ¿El horario se define **por empresa**, por grupo de empleados, o por empleado
  individual?
- Turno diurno vs nocturno: ¿qué lo distingue exactamente? (ej. el nocturno
  cruza medianoche)
- Tolerancias: ¿cuántos minutos de atraso antes de contar "tardanza"? ¿Hay
  tolerancia de salida anticipada?
- ¿Qué cuenta como "ausencia"? (no marcó entrada / no marcó nada / marcó menos de
  X horas)
- **Corrección manual de marcaje:** ¿quién puede hacerla? ¿Se exige un motivo?
  ¿Queda registro de quién y cuándo? (el contrato lo exige — confirmar cómo lo
  hace Adempiere hoy)

## 6. Reportes y export a nómina (Hito 5)

- ¿Cada cuánto se genera el archivo para nómina? (quincenal, mensual)
- ¿El archivo es uno solo para todas las empresas, o uno por empresa?
- Adjuntá una muestra real en `exports/nomina-actual.xlsx`. ¿Las columnas de ese
  archivo están fijas hace tiempo, o cambian?
- ¿El sistema de nómina de destino cómo se llama? ¿Importa un CSV, un Excel con
  formato específico, otra cosa?
- Además del consolidado, ¿qué otros reportes sacan hoy de Adempiere para
  biométricos? (listado de tardanzas, de ausencias, de horas extra, ...)

## 7. Usuarios de la plataforma (los 4 de ALCO)

- ¿Quiénes son los 4 y qué hace cada uno? ¿Todos hacen de todo, o hay roles
  distintos (ej. uno solo administra empresas, otro solo revisa asistencia)?
- ¿Alguna acción debería estar restringida a ciertos usuarios? (borrar empresa,
  corregir marcaje, exportar nómina)
- En Adempiere, ¿ALCO usa distintos "Roles" para esto, o todos entran con el
  mismo usuario?
