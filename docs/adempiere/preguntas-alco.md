# Preguntas para Grupo ALCO

Lista corta, en lenguaje simple. Lo que necesitamos que ustedes confirmen para
terminar de definir cómo va a funcionar el sistema nuevo. Respondan lo que puedan;
si algo no aplica o no lo tienen claro, decir "no aplica" / "no sé" también sirve.

Marcamos con 🔴 lo urgente (lo necesitamos pronto para no frenar) y con ⚪ lo que
puede esperar un poco.

---

## A. Empresas y grupos

1. ⚪ Confirmar: hoy tienen ~32 empresas cargadas en el sistema viejo, la
   propuesta hablaba de ~40. ¿El número real de empresas cliente activas hoy es
   ~32, o hay clientes que todavía no están cargados?
   R: Reales 32 ahorita mismo

2. ⚪ Cuando una empresa es un "grupo" (una madre con varias empresas del mismo
   grupo, tipo GRUPO FARMALIDO con sus 5 farmacias): ¿los reportes de asistencia
   y el archivo de nómina los arman **por cada empresa por separado**, **por el
   grupo entero junto**, o **a veces uno y a veces el otro**?
   R: El sistema debe dar todas las opciones.

3. ⚪ ¿Puede una empresa cliente cambiar de grupo con el tiempo, o una vez que
   está en un grupo se queda ahí?
   R: Podria ser, deberia ser una relacion simple.

---

## B. Empleados

4. 🔴 El identificador principal de un empleado va a ser la **cédula**.
   ¿Hay empleados sin cédula venezolana (extranjeros, por ejemplo) que igual
   haya que registrar? Si sí, ¿con qué documento se los identifica?
   R: Todos los trabajadores tienen cedula. El formato si deberia ser flexible (V,E,J,G). Bajo las normas de la cedula/rif venezolanas.

5. 🔴 En el sistema viejo vimos que una misma persona puede estar cargada en
   **más de una empresa a la vez** (un empleado con dos "contratos", uno por
   empresa). ¿Eso es algo que pasa de verdad en la operación —una persona
   trabajando/marcando en dos empresas del mismo grupo— o fue un caso de
   prueba? Si pasa de verdad, ¿es común o excepcional?
   R: Es excepcional pero puede ser posible

6. ⚪ Cuando un empleado **renuncia o lo despiden**: ¿lo necesitan seguir viendo
   en el sistema (con sus marcajes históricos) por cuánto tiempo? ¿O se puede
   archivar/ocultar apenas se va?
   R: La idea es que grupo ALCO tenga un registro de los trabajadores con historial para cuando quieran reclutar. Ahora bien en los reportes relacionados con la empresa se deberia ocultar a penas se desvincula.

7. ⚪ Cuando un empleado **cambia de una empresa a otra** (traslado): ¿es la misma
   ficha que se muda conservando su historia, o se cierra en una empresa y se
   abre nueva en la otra?
   R: Deberia ser la misma ficha para conservar su historia.

---

## C. Huellas y dispositivos

8. 🔴 Hoy, ¿cómo saben qué empleado corresponde a cada huella dentro de un
   equipo biométrico? ¿Hay una pantalla donde se asocia "empleado X = usuario 5
   del equipo de la sede Y", o se hace de memoria / en una planilla aparte?
   R: No importa el estado actual, la relacion entre usuario X en dispositivo Y con empleado Z deberia ser manejado por nosotros en el nuevo sistema, con las relaciones que corresponda el poder tener el mismo empleado con su huella en varios dispositivos.

9. 🔴 La **copia de huellas de un equipo a otro** (cuando alguien cambia de sede,
   o se reemplaza un equipo dañado): confirmaron que tiene que ser posible y que
   hoy no lo logran hacer. ¿Recuerdan qué intentaron y con qué herramienta? ¿El
   fabricante del equipo les dijo algo al respecto?
   R: Los que no hemos resuelto eso somos nosotros en la implementación actual, ellos (Grupo ALCO) no tienen conocimiento tecnico de la solucion de Adempiere.

10. ⚪ Un empleado, ¿está enrolado (con su huella) en **un solo equipo**, o
    normalmente en varios (su equipo principal + uno de respaldo)?
    R: Comunmente en un solo equipo pero si la empresa comparte empleados y tiene varias sedes allí es donde esta el caso de uso.

11. 🔴 **Acceso al equipo en cada sede.** Nos plantearon que cada empresa
    necesita poder tener un "administrador" que entre al equipo biométrico en su
    sede (por temas de distancia, ALCO no puede ser el único con acceso físico).
    Pregunta concreta: ese administrador, **¿necesita entrar al sistema web
    nuevo**, o solo necesita poder operar el equipo físico en la sede (agregar
    una huella, reiniciar el equipo)? Es importante porque lo primero amplía lo
    que se contrató (hoy: solo 4 usuarios de ALCO en la plataforma).
    R: Solo grupo ALCO tiene acceso a la app web. El administrador del lado de la empresa cliente tiene acceso admin al dispositivo.

---

## D. Categorías de empleado

12. ⚪ ¿Qué "etiquetas" le ponen a un empleado que les importen para asistencia y
    reportes? (departamento, cargo/puesto, tipo de jornada, sede...). Listar las
    que usan de verdad.
    R: Esto debe ser configurable, por ahora: departamento, cargo/puesto, tipo de jornada, sede.

13. ⚪ En el sistema viejo hay 288 "puestos" cargados. ¿Los usan todos, o en la
    práctica manejan una lista más corta? ¿Quieren poder crear/editar esa lista
    ustedes mismos desde el panel nuevo?
    R: Esto debe ser configurable, la decision de migrar todos o solo un subconjunto vendra despues.

---

## E. Horarios, turnos y asistencia

14. 🔴 El horario de trabajo, ¿se define **por grupo de empleados** (ej. "turno
    administrativo", "turno de planta"), por empleado individual, o por empresa?
    R: Por grupo de empleados.

15. 🔴 ¿Qué distingue un **turno diurno de uno nocturno**? (por ejemplo: el
    nocturno arranca de noche y termina al día siguiente cruzando la medianoche)
    R: Pudiera ser que el nocturno arranca de noche y termina al día siguiente cruzando la medianoche pero no necesariamente.

16. 🔴 **Tardanza:** ¿cuántos minutos de atraso se toleran antes de contar la
    marca como tardanza? ¿Ese número es igual para todas las empresas o cada una
    pone el suyo?
    R: Deberia ser configurable por empresa y grupo de empleados. Sin embargo esto será manejado en el sistema de nomina.

17. 🔴 **Ausencia:** ¿cuándo cuentan que un empleado estuvo ausente un día? (no
    marcó entrada / no marcó nada en todo el día / marcó pero trabajó menos de X
    horas)
    R: Deberia ser configurable por empresa y grupo de empleados. Sin embargo esto será manejado en el sistema de nomina.

18. ⚪ **Salida anticipada:** ¿la controlan? Si sí, ¿con cuántos minutos de
    tolerancia?
    R: Deberia ser configurable por empresa y grupo de empleados. Sin embargo esto será manejado en el sistema de nomina.

19. ⚪ **Corrección de un marcaje** (cuando un empleado marcó mal o se olvidó):
    ¿quién de ALCO puede hacer esa corrección? ¿Se anota siempre un motivo?
    R: se deberia poder hacer desde el panel web(cualquiera de grupo ALCO). Seria buen tener un motivo.

20. ⚪ ¿Manejan feriados / días de descanso especiales que afecten el conteo, o
    eso queda todo para el sistema de nómina?
    R: Si, queda todo para el sistema de nómina.

---

## F. Reportes y archivo para nómina 🔴 TODO ESTE BLOQUE ES URGENTE

21. **Manden una muestra real del archivo** que hoy sacan del sistema viejo y
    cargan a su sistema de nómina. Aunque sea con datos de un período viejo.
    (guardarlo en `docs/adempiere/exports/`)
    R: El tema es que ellos usan un sistema de por medio para formatear lo que viene de Adempiere, es como un modulo interno de Adempiere que hace la traducción, sin embargo dejemos esto documentado para ajustar el formato luego.

22. ¿Cada cuánto generan ese archivo? (quincenal, mensual, semanal)
    R: Mensual o quincenal pero deberia ser manejable hacerlo semanal.

23. ¿Es **un archivo por empresa**, o uno solo con todas las empresas juntas?
    R: Deberia ser configurable.

24. ¿Cómo se llama el sistema de nómina al que lo cargan? ¿Qué formato exacto
    necesita — Excel con columnas fijas, un .txt, un .csv con cierto separador?
    R: No deberia importar en este momento, ellos suben un excel o csv al modulo de adempiere que llaman "el utilitario" y esto lo sube a un software llamado Galepso.

25. Además del archivo para nómina, ¿qué **otros reportes** sacan hoy para
    biométricos? (lista de tardanzas del período, lista de ausencias, horas
    trabajadas por empleado, etc.). ¿Cuáles usan de verdad?
    R: Podria ser un good-to-have pero centremonos en el reporte de asistencia que ira para la nomina como la salida principal de este software.

    **Una nota importante aquí**: Nosotros post fase 1 (fase 2 en adelante) construiremos el sistema de nomina completo. La idea es que todo esto no solo sea accesible via exports, deberá estar disponible en la aplicacion y lo mas probable o mejor es que haya una API para acceder a esto. Aunque escucho opiniones.

26. El "consolidado del período" (días trabajados, horas totales, tardanzas,
    ausencias por empleado): hoy, ¿lo arman **a mano** en Excel a partir del log
    de marcajes, o el sistema viejo ya se los da calculado en algún reporte?
    R: No entiendo la pregunta pero en caso de ser a mano, aqui no deberia ser a mano.

---

## G. Usuarios de la plataforma (los 4 de ALCO)

27. ⚪ ¿Quiénes son los 4 y qué hace cada uno en el día a día? ¿Todos hacen de
    todo, o hay división de tareas (uno administra empresas/empleados, otro
    revisa asistencia, otro genera reportes)?
    R: Hay division pero todos tienen el mismo acceso.

28. ⚪ ¿Alguna acción debería estar reservada a ciertas personas y no a todas?
    (ejemplos: borrar una empresa, corregir un marcaje, generar el archivo de
    nómina, borrar la memoria de un equipo)
    R: No.

---

## H. Del sistema viejo — para descartar

29. ⚪ La pantalla de "Importar Registro de Asistencia" del sistema viejo tiene
    ~157.000 registros con error, todos de 2023. ¿La usan hoy para algo, o quedó
    sin uso desde que los equipos están conectados en vivo?
    R: Sin uso

30. ⚪ ¿El sistema viejo les calcula algo de asistencia (tardanzas, horas), o
    solo guarda la lista de marcajes y el cálculo lo hacen ustedes por fuera?
    R: No.
