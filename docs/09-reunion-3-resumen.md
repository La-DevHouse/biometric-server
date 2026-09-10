# Reunión 3 con Ezequiel — resumen legible

Versión de lectura. El análisis técnico completo (segmentación del transcript,
gap analysis contra el código, action items priorizados) está en
[`09-reunion-3.md`](./09-reunion-3.md).

Reunión presencial de ~2 horas, grabada. Habla casi todo Ezequiel Alvarado
(cliente, Grupo ALCO); el equipo (Eivar y Jesús) muestra el panel web y cierra
decisiones.

---

## De qué se trató la reunión

Ezequiel abrió Adempiere en vivo y fue mostrando cómo trabaja hoy: cómo registra
empleados, cómo les crea contratos, cómo configura los biométricos. Sobre esa
demostración fue marcando qué está mal, qué le falta, y qué tiene que hacer el
sistema nuevo.

La frase que resume su expectativa de la Fase 1: **"que el sistema de ustedes me
haga exactamente lo mismo que Adempiere, más terminar los detalles que la gente
de Adempiere nunca terminó"**. No quiere reinventar su flujo de trabajo; quiere el
mismo flujo, sin los huecos, y presentado como algo visiblemente mejor.

También dedicó un tramo largo a hablar de la relación comercial y de las fases
siguientes (nómina y recursos humanos), que no son parte de este proyecto pero
condicionan cómo seguir.

---

## Los temas que se tocaron

**1. Estructura de empresas: grupo → empresa → sede → dispositivos.**
Ezequiel dejó claro que necesita los tres niveles. Hay grupos (Grupo Farmalido,
Grupo Perfume Factory) que agrupan varias empresas distintas, cada una con su
propio RIF, y cada empresa puede tener varias sedes, y cada sede puede tener uno o
más dispositivos. Quitar la "empresa padre" en los últimos cambios fue un error:
hay que reponerla.

**2. La empresa padre no lleva RIF.**
El grupo es una agrupación, no una empresa legal. Ezequiel la llamó de varias
maneras (grupo, organización, corporación, franquicia) — no quedó fijado el nombre
que va a usar el sistema, pero sí que no tiene RIF.

**3. Compartir empleados entre las empresas del grupo, automático.**
Cuando registrás un empleado en cualquier empresa de un grupo, su huella tiene que
ir a **todos** los dispositivos de **todas** las empresas de ese grupo, sin que
haya que elegir a mano. Es como funciona Adempiere hoy y lo quiere igual. Nació de
un problema real: un trabajador que marcaba en un local no podía marcar en otro y
había que registrarlo dos veces. "Para el biométrico, un usuario más o menos no
mueve la aguja."

**4. El contrato de trabajo es la relación empleado–empresa, y tiene datos
propios.**
Un empleado puede tener varios contratos activos a la vez (trabaja en varias
empresas). El contrato no es solo un vínculo: lleva fecha de inicio (lo que
Ezequiel más recalca), tipo de nómina, cargo, y estado (activo / inactivo /
retirado). Cuando alguien se va y vuelve, se le crea un contrato nuevo con fecha
nueva; el viejo queda retirado, no se borra.

**5. Nada se borra de verdad.**
En Adempiere no se puede borrar una empresa ni un trabajador "por cuestiones de
auditoría", y a Ezequiel eso le parece bien: hay trabajadores con 20 años de
historial de salarios que no se pueden perder. El sistema nuevo tiene que
comportarse igual (dar de baja, no borrar).

**6. El gran hueco de Adempiere: no se puede ver la lista de empleados de una
empresa.**
Lo repitió cuatro veces. En Adempiere no hay un listado de empleados; abrís un
registro y ya. Ezequiel necesita poder ver los empleados filtrando por grupo, por
empresa y por sede ("todos los del Grupo Factory, pero también solo los de
Babylon, solo los de Arca"). Y que en la ficha del empleado se vea a qué empresa
pertenece (hoy lo meten a mano en el campo de descripción del biométrico).

**7. El ID del usuario en el biométrico es la cédula. En todos los equipos.**
Esto simplifica todo. Es la llave de la migración: por un lado están los
biométricos (cédula + nombre), por el otro un Excel que van a exportar de
Adempiere (todo lo demás), y se cruzan por la columna de cédula.

**8. La migración: re-apuntar cada biométrico sin que nadie se entere.**
El plan es ir sede por sede con una laptop, cambiarle a cada equipo la IP y el
puerto del servidor (de Adempiere al sistema nuevo), y que el sistema jale todos
los usuarios que ya tiene el equipo. Los trabajadores siguen marcando igual, el
cliente ni lo nota. Ezequiel entregó un biométrico de prueba (hoy apuntando a
Adempiere, con unos 4 empleados cargados) para que el equipo pruebe todo el ciclo.

**9. El biométrico envía más de lo que uno cree.**
Cuando mandás información a un equipo, no viaja solo el nombre y la cédula:
también el rol de administrador, el tipo de usuario y el cargo. Si mandás un
administrador sin querer, te quedás afuera del menú. Ezequiel tiene un "truco":
deja el menú abierto mientras envía y va viendo llegar los registros uno por uno.
Así descubrió que 8 de más de 100 usuarios no tenían huella.

**10. Ver desde el sistema si un empleado tiene huella o no.**
No le interesa ver la imagen de la huella, solo saber sí/no. La idea es confiar en
el sistema y dejar de tener que meterse físicamente en cada equipo a revisar.

**11. Escanear cédula y RIF para autocompletar.**
Ezequiel quiere subir el PDF del RIF y que el sistema saque razón social,
dirección y número; a él solo le quedaría llenar el representante legal (nombre,
cédula, teléfono). Y subir una foto de la cédula del empleado y que la IA saque
nombre, fecha de nacimiento y dirección. El motivo es concreto: tiene dislexia,
transpone números y letras al escribir, y hoy pierde tiempo copiando y pegando
desde las páginas del CNE y el SENIAT.

**12. Faltan datos de la empresa: logo y representante legal.**
El logo tiene que poder subirse por empresa para que salga en el recibo de pago
(esto ya es tema de la fase de nómina, pero el logo se captura desde ahora). El
representante legal hace falta para generar contratos más adelante.

**13. "Departamento de nómina" hay que renombrarlo a "Modelo de negocio".**
Los valores serían tipos de comercio: farmacia, restaurante, colegio, panadería,
librería, distribuidora, etc. Y el modelo de negocio determina qué cargos
aparecen disponibles (restaurante → cocinero, mesonero, cajero...; farmacia →
analista de compras, administrativo...). Esas listas ya las tiene armadas Grupo
ALCO. Idea extra: que el sistema intuya el modelo de negocio a partir del nombre
de la empresa. Además, "tipo de nómina" debería decir solo quincenal o semanal
(mensual es ilegal en Venezuela).

Cómo lo vamos a modelar (decidido después de la reunión, detalle en `09-reunion-3.md`
§3.5.1): el modelo de negocio es un dato **de la empresa**, no del contrato, y se
relaciona con los cargos en muchos-a-muchos (un cargo sin modelo asignado es
"genérico" y aparece siempre — administrativo, seguridad, cajero). El cargo se
guarda en el contrato de trabajo, así que la misma persona puede ser gerente en
una empresa y cocinero en otra sin conflicto. Se mantiene además un campo
"departamento" real en el contrato (Orientación, COVI, Administración...),
opcional y sin usar en Fase 1, listo para nómina. La migración necesita una tabla
que traduzca los cargos/departamentos que vengan como texto en el Excel de
Adempiere.

**14. La letra del panel tiene que ser más grande.**
"Todos en Grupo ALCO tenemos más de 40, menos Yamilé." El equipo ya lo había
notado.

**15. Torniquetes / control de acceso: para después.**
Hoy los biométricos solo cuentan asistencia. Pero una empresa que le alquila 5
equipos a Grupo ALCO ya usa torniquetes, y ahí "meter a todos en todos los
equipos" deja de servir (habría gente abriendo puertas que no debería). Se acordó
dejarlo como deuda técnica consciente y prever el punto donde se va a enganchar.
Relacionado: nadie recuerda la diferencia entre "superusuario" y "admin" en el
equipo, y no hay documentación del fabricante.

**16. El panel web ya está andando (crudo).**
Está en un servidor en la nube, con login. Ya crea empresas y sedes, lista
dispositivos, y permite vincular un usuario del biométrico con una ficha de
empleado (incluso a varias). El paso de huella entre dos equipos ya funciona y se
verificó físicamente.

**17. Fases del proyecto y plata.**
La Fase 1 (este proyecto, control de asistencia) se cobra por hito, y el primer
pago es al Hito 3 — el equipo le avisa a Ezequiel cuando llegue. El código es de
Ezequiel. La Fase 2 es nómina, y se subdivide en nómina propiamente dicha y en
recursos humanos integral (ligado a la web que le hizo Emanuel: preselección,
psicotécnicos, contratación). El concepto que Ezequiel le pone es "RH 2.0". Antes
de arrancar la Fase 2 quiere una semana de investigación: pedir demos de sistemas
de nómina (mencionó Sairet), ver cómo trabaja Yamilé en Galexo, revisar repos.
Ezequiel insiste en pagar y facturar "para poder exigir" — dice que el proyecto
de Adempiere se murió justamente porque él nunca pagó. El modelo que propone para
el sistema nuevo es pago por biométrico (unos 10 dólares por equipo) más soporte
técnico.

**18. Hosting propio.**
Ezequiel tiene el dominio alcolegaltech.com (vacío) y quiere que el sistema viva
ahí, en un subdominio tipo admin., sobre un servidor dedicado propio. La página
actual que le maneja Emanuel se cae cada dos o tres días. El equipo lo va a
conectar con Emanuel para coordinar.

**19. Presentación a Grupo ALCO.**
Ezequiel va a presentar el sistema a las decisoras de la empresa (incluida su
esposa) y quiere que cause "efecto wow". Puede que el equipo tenga que viajar a
Acarigua a presentarlo.

---

## Cosas importantes que se dijeron (lista rápida)

- Reponer la empresa padre / grupo. No lleva RIF.
- Jerarquía: **grupo → empresa (con RIF) → sede → dispositivo(s)**. Una sede puede
  tener más de un dispositivo.
- Empleado asignado a una empresa del grupo → su huella va a **todos** los equipos
  del grupo, **automático**.
- El **contrato de trabajo** es N:M y tiene datos: fecha de inicio, tipo de
  nómina, cargo, estado. Re-ingreso = contrato nuevo con fecha nueva.
- **Nada se borra**: dar de baja, nunca borrado físico. Historial salarial se
  conserva por años.
- El **ID del biométrico es la cédula**, en todos los equipos. Es la llave para
  cruzar el Excel de Adempiere con lo que hay en los dispositivos.
- **Migración = re-apuntar la IP/puerto de cada equipo** sin borrar usuarios y
  jalar todo al sistema. Ezequiel entregó un equipo de prueba.
- Al enrolar, el equipo también empuja **rol de admin + tipo de usuario + cargo**;
  cuidado con quedarse afuera del menú.
- El sistema debe mostrar **si cada empleado tiene huella o no** (sí/no, sin
  imagen).
- **Poder listar/filtrar empleados por grupo, empresa y sede** — es el hueco #1 de
  Adempiere y el mayor golpe de efecto para la demo.
- **Autocompletar desde el RIF (PDF)** los datos de la empresa y **desde la foto
  de la cédula (IA)** los del empleado. Ezequiel tiene dislexia; esto le resuelve
  un dolor real.
- La empresa necesita **logo** (para el recibo de pago) y **representante legal**
  (nombre, cédula, teléfono).
- Renombrar **"departamento de nómina" → "modelo de negocio"**; el modelo de
  negocio filtra los cargos disponibles. "Tipo de nómina" = solo quincenal o
  semanal.
- **Letra más grande** en todo el panel.
- **Torniquetes / control de acceso = más adelante**; dejar previsto el enganche.
  Investigar la diferencia superusuario vs admin.
- **Primer pago al Hito 3.** El equipo avisa al llegar.
- **Modelo comercial propuesto:** pago por biométrico + soporte técnico. El código
  es del cliente.
- **Fase 2 (nómina + RRHH "RH 2.0")** después, con una semana previa de
  investigación (Sairet, Galexo vía Yamilé, repos).
- **Hosting propio** en alcolegaltech.com sobre servidor dedicado. Conectar con
  Emanuel.
- **Presentación a Grupo ALCO** con "efecto wow"; posible viaje a Acarigua.
- Pendiente: **depurar de la grabación** las cédulas y RIFs reales que Ezequiel
  dictó en voz alta durante la demo (lo pidió él).

---

## Decisiones cerradas en la reunión

1. Vuelve la jerarquía grupo → empresa → sede → dispositivos.
2. La entidad padre no lleva RIF.
3. Compartir empleados a todo el grupo es automático (no seleccionable en el flujo
   normal); si molesta, se ajusta después.
4. El ID del usuario es la cédula, en todos los equipos.
5. El contrato de trabajo es N:M con datos propios; re-ingreso = contrato nuevo.
6. Soft-delete (baja lógica) para empresas, empleados y contratos.
7. La migración se hace re-apuntando la IP/puerto del equipo, sin borrar usuarios.
8. El equipo de prueba se queda con el equipo dev.
9. "Departamento de nómina" → "modelo de negocio"; "tipo de nómina" → quincenal /
   semanal.
10. Autocompletado desde RIF (PDF) y desde cédula (foto + IA) como objetivo.
11. Logo de empresa para el recibo de pago.
12. Letra más grande en el panel.
13. Torniquetes = deuda técnica diferida; prever el enganche.
14. Primer pago al Hito 3; el equipo avisa.
15. Una semana de investigación de sistemas de nómina antes de la Fase 2.
16. Sistema alojado en servidor dedicado propio bajo el dominio de Ezequiel.
17. (Propuesto, no firmado) Modelo comercial de pago por biométrico + soporte.

---

## Lo que sigue (acciones grandes)

- **Antes de tocar la migración:** reponer grupo/empresa padre y el flag de
  compartir empleados en el modelo de datos; construir la importación masiva de
  usuarios y huellas desde un equipo re-apuntado; hacer un reporte de
  reconciliación (IDs en el equipo que no cruzan con el Excel de Adempiere);
  probar el ciclo completo con el equipo de prueba.
- **Para la demo a Grupo ALCO:** el listado de empleados filtrable por
  grupo/empresa/sede; el autocompletado desde el RIF; el indicador de huella
  sí/no; la UI de jerarquía de empresas; la letra más grande.
- **Coordinación con Ezequiel:** cerrar las preguntas abiertas (nombre de la
  entidad padre, nombre del producto, catálogo de modelos de negocio → cargos,
  muestras reales de un RIF PDF y de un export de Adempiere, alcance del soporte);
  contacto de Emanuel y de Yamilé; fecha tentativa de la presentación; depurar la
  grabación.
- **Fase 2 (después):** demos de nómina, shadowing de Yamilé en Galexo,
  documentar requerimientos (nómina plana vs dinámica, multimoneda / BCV,
  conceptos de la ley laboral, contratos colectivos), diseñar la generación de
  contratos.
