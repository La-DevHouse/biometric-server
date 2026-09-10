# Reunión 3 con Ezequiel

Análisis completo del transcript (`transcripcion.txt`). Reunión presencial de ~2h,
grabada. Speakers: **Ezequiel Alvarado** (cliente, Grupo ALCO — habla el 90%),
**Eivar** y **Jesús/París** (equipo dev). Fecha ≈ 2026-09-10 (fecha del archivo).

> El transcript es auto-generado y muy ruidoso (bloques largos sin puntuar, tramos
> ininteligibles, ráfagas de "Sí. Sí." y "Vamos a ver." que son relleno del ASR).
> Todas las referencias `[NNNN]` apuntan al segmento en
> `scratchpad/transcript_numbered.txt` (split por oraciones). Nombres de empresas
> transcritos fonéticamente — se dan con la grafía más probable.

> **Privacidad:** durante la demo Ezequiel dictó al aire cédulas y RIFs reales
> (suyos, de su esposa, de terceros) y pidió expresamente que se depuren de la
> grabación y de cualquier resumen [0261]. No se transcriben aquí.

---

## 1. Segmentación temática

| #   | Bloque                                                                                                     | Segmentos aprox.                |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------- |
| A   | Adempiere: socio de negocio, contratos de trabajo, N:M                                                     | 0001–0064, 0281–0431            |
| B   | Requerimiento mínimo Fase 1 = "hacer lo mismo que Adempiere + cerrar sus huecos"                           | 0065–0098                       |
| C   | Fases del proyecto (biométrico / nómina / RRHH "RH 2.0")                                                   | 0099–0131, 0583–0589            |
| D   | "Tipo de nómina" → simplificar; "Departamento de nómina" → "Modelo de negocio"                             | 0138–0178                       |
| E   | Modelo de negocio driftea los cargos/puestos disponibles                                                   | 0169–0178                       |
| F   | Borrado bloqueado por auditoría en Adempiere (y por qué está bien)                                         | 0179–0186                       |
| G   | Gap #1 de Adempiere: no hay listado de empleados por empresa/sede/grupo                                    | 0179, 0187–0234, 0664–0678      |
| H   | Relación comercial: cobrar para poder exigir, pago por biométrico, soporte                                 | 0235–0261, 0555–0602, 0740–0757 |
| I   | Hosting / dominio `alcolegaltech.com` / servidor dedicado / Emanuel                                        | 0247–0259                       |
| J   | Sistema de nómina Fase 2: flexibilidad, nómina plana vs dinámica, BCV, conceptos LOT                       | 0259–0261, 0281, 0583           |
| K   | Referentes de nómina a estudiar: Sairet, Galexo, "RH 2.0"; pausa de 1 semana                               | 0281                            |
| L   | ID del biométrico = cédula. Estandarización. Base de la migración                                          | 0261 (bloque largo)             |
| M   | El device empuja también admin flag + tipo de usuario + cargo; riesgo de lockout; "truco" del menú abierto | 0261–0270                       |
| N   | Huellas: 8 de ~100 sin huella; el sistema debe mostrar huella sí/no                                        | 0266–0270, 0731                 |
| O   | Migración: re-apuntar el device (IP/puerto) sin borrar usuarios; jalar usuarios + huellas al sistema       | 0179, 0261, 0687–0734           |
| P   | Device de prueba entregado (apunta a Adempiere, 4 empleados)                                               | 0271, 0281, 0687–0691           |
| Q   | Escaneo de cédula (foto + IA) y RIF (PDF) para autocompletar                                               | 0271–0279, 0281                 |
| R   | Dislexia de Ezequiel → por qué necesita el autocompletado                                                  | 0271–0279                       |
| S   | Logo de empresa → recibo de pago; campos de empresa que faltan                                             | 0281                            |
| T   | Empresa padre / hijas / sedes: **hacen falta las dos cosas**                                               | 0279–0281                       |
| U   | Compartir empleados a todo el grupo automáticamente (caso Yammer/Performance Factory)                      | 0441–0521, 0647–0680            |
| V   | Debate: auto-agregar a todo vs selector por sede; deuda técnica torniquetes                                | 0281, 0525–0543                 |
| W   | Tipos de usuario del device: normal / superusuario / admin — diferencia desconocida, sin docs              | 0281                            |
| X   | Letra más grande (plantilla +40 años)                                                                      | 0281                            |
| Y   | Demo del panel web ya construido (empresas, sedes, vincular device-user ↔ empleado)                        | 0271, 0281, 0694–0736           |
| Z   | "El cliente siempre tiene la razón" vs "el software se adapta al usuario"                                  | 0603–0653                       |
| —   | Tangentes sin acción: Cherokee, airbag, edificio en Acarigua, teléfonos                                    | 0270, 0740–0769                 |

---

## 2. Resumen ejecutivo

**Qué es esta reunión.** Ezequiel recorre Adempiere en vivo mostrando cómo trabaja
hoy, señala sus huecos, y define qué tiene que hacer el sistema nuevo en Fase 1:
**replicar el comportamiento de Adempiere y cerrar los huecos que la gente de
Adempiere nunca cerró**. El equipo muestra el panel web ya construido y se cierran
varias decisiones de dominio.

**Los 3 pilares de Fase 1 según Ezequiel** [0066, 0658–0664]:

1. Operaciones con el dispositivo que Adempiere no hace — **ya resuelto** por el
   equipo (designar administrador, borrar biométrico, migrar huella).
2. Poder **ver los empleados de una empresa / sede / grupo** — Adempiere no lo
   permite y es "un error grave" [0234]. Es el hueco más repetido de la reunión.
3. **Migrar** cada biométrico de Adempiere al sistema nuevo re-apuntando su IP sin
   borrar usuarios ni interrumpir marcajes.

**Decisiones de dominio cerradas hoy:**

- La jerarquía **Grupo de empresas → Empresa (con RIF) → Sede → Dispositivo(s)**
  vuelve. Quitar la empresa padre en los últimos commits fue un error [0279–0281].
- Al asignar un empleado a **cualquier** empresa de un grupo, su biometría se
  envía a **todos** los dispositivos del grupo, automáticamente (no seleccionable).
  Es el comportamiento de Adempiere y Ezequiel lo quiere igual [0502–0521, 0647–0656].
- El **ID del usuario en el biométrico es la cédula**, en todos los equipos. Se
  estandariza de nuestro lado y es la llave de la migración (join cédula ↔ cédula
  entre el export de Adempiere y lo que hay en los devices) [0261].
- El **contrato de trabajo** (relación empleado↔empresa) es N:M, con datos propios
  (fecha de inicio, tipo de nómina, cargo, estado activo/inactivo/retirado), no una
  simple join table [0005–0016, 0056–0064, 0431].
- Nada se borra en duro — **soft-delete por auditoría**, igual que Adempiere; el
  historial salarial se conserva 20+ años [0179–0186].

**Comercial / fases.** Fase 1 se cobra por hito; el primer pago es al **Hito 3**
[0745–0754]. Modelo propuesto: **pago por biométrico** (~10 USD/equipo/mes) +
soporte técnico [0261]. El código es del cliente. Fase 2 = nómina + RRHH integral,
concepto **"RH 2.0"**; antes de arrancarla, **1 semana de investigación** (demos de
Sairet, Galexo vía Yamilé, repos de GitHub) [0281]. Ezequiel presentará el sistema
a las decisoras de Grupo ALCO y quiere "efecto wow"; posible viaje a Acarigua.

---

## 3. Elementos clave por tema (todo lo extraído)

### 3.1 Jerarquía empresa padre / hijas / sedes → **RESTAURAR**

- Ezequiel, textual: para el problema de empresas hermanas que comparten empleados
  "**tiene que ser varias empresas** [con RIF distinto]… **tiene que tener las dos
  opciones**" — grupo **y** empresas hijas **y** sedes [0279].
- Ejemplos concretos que dio (grafía probable):
    - **Grupo Farmalido** — grupo/organización, **sin RIF**. Sedes: La Guajira, Las
      Lágrimas, Araure, Páez ("Farmalido Pae" — biométrico configurado la víspera,
      tienda aún sin abrir), "del Este", CDPi (último device creado).
    - **Grupo Perfume Factory** (a.k.a. "Performance Factory") — franquicia /
      corporación / organización padre, **sin RIF**. Contiene sub-empresas con **RIF
      distinto cada una**:
        - **Akira** — 3 sedes: San Diego/San Vidrio (?), Barinas, Acarigua.
        - **Afigal** — 2 sedes: C.C. Arca, Barinas.
        - **Inversiones Fial** — 2 sedes: Barquisimeto y Acarigua. "Babylon" aparece
          como device/sede de Fial.
    - Todas comparten empleados; cada sub-empresa tiene su propio RIF.
- Otras entidades nombradas: **Grupo Alco** (activa, con RIF, 1 sede en
  Barquisimeto), **Alco 2** (empresa de prueba en el sistema nuevo), **SchoolKey**
  (inactiva), **Coliseo/Colegio Norteamericano** (iba a ser la primera sede con
  **2 dispositivos** — uno atrás para los vigilantes) [0280], Cleveland Institute,
  Humboldt, "el Ilustre" (primer device colocado, histórico), "Farmacia Farmalido".
- En Adempiere el "código" de la empresa hija = su RIF; el del grupo padre no
  tiene RIF ("aquí no me dice el RIF") [0261, 0279].
- Consenso de estructura [0280]: "cada empresa tiene su RIF y cada RIF pudiera
  tener su sede y cada sede puede tener varios dispositivos, y cualquier sede
  puede tener un dispositivo".

### 3.2 Nombre de la entidad padre — **a debatir**

- Ezequiel la llama indistintamente grupo / organización / corporación /
  franquicia; "no es una empresa, es un grupo de empresas" [0279]. Duda él mismo.
- Lo único firme: **la entidad padre NO lleva RIF**.
- Propuesta interna: renombrar "empresa padre" → **"Grupo de Empresas"**. Sin
  oposición en la reunión, pero tampoco decisión explícita. Queda como decisión
  abierta de nomenclatura (§7).

### 3.3 Compartir empleados a todo el grupo → **automático**

- Comportamiento de Adempiere que Ezequiel quiere **replicado tal cual**: "cuando
  tú seleccionas una empresa, no importa que sea la empresa padre o la empresa
  hijo, él chequea si esa empresa es parte del grupo y **te lo envía para el
  grupo**" [0502]. "Eso me gustaría que permaneciera así" [0505].
- Origen del requerimiento: problema con Yammer / Performance Factory — un
  trabajador que marcaba en una sede no podía marcar en otra, había que
  registrarlo dos veces. Solución con el dev anterior: empresa "master" + todos
  los empleados a todos los equipos. "Para el biométrico es un hombre más un
  hombre menos, no le mueve la aguja" [0648]. Ha funcionado bien mientras
  Farmalido creció [0654].
- **Contrapropuesta del equipo** (Jesús/Eivar): un selector por empleado —
  elegir a qué sedes se agrega, o "todas". Ezequiel la rechaza para el flujo
  normal ("no me parece" [0281]) porque su propio caso tiene contratos y roles
  distintos por empresa; pero acepta que **para el futuro de torniquetes /
  control de acceso** haga falta poder NO agregar a todos.
- Cierre [0544–0547]: "vamos a hacerlo como tú piensas y si no después me lo vas
  a tener que corregir". Es decir: implementar el auto-share como default; si
  molesta, se ajusta.
- El toggle explícito **"Compartir empleados"** (booleano por grupo/empresa,
  default activado) es diseño nuestro — ya estaba en el borrador `08` como
  `shared_employees` y se removió del schema real (§5).

### 3.4 Contrato de trabajo (employment) — N:M con datos

- En Adempiere: **"socio de negocio"** = la persona/empleado. Los **contratos de
  trabajo** cuelgan del socio de negocio, con contador y filtro activo/inactivo.
  Un empleado puede tener **varios contratos activos** (Ezequiel tiene 2; luego
  ejemplo con 3) [0005–0016, 0056].
- "El contrato es una tabla que tiene un empleado y que tiene una empresa" [0431]
  — join table **con datos**.
- Campos del contrato mencionados: empresa/organización, **fecha de inicio /
  ingreso** (repetidamente marcada como "lo más vital" [0063–0065, 0130]), tipo
  de nómina (quincenal/semanal), cargo/puesto, "departamento de nómina" (→ ver
  §3.5), estado.
- **Ciclo de vida**: activo → inactivo/retirado. Re-contratación = **contrato
  nuevo con fecha de ingreso nueva**; el anterior queda retirado, no se borra
  [0179].
- Crear un socio de negocio nuevo en Adempiere **no copia** datos — nace en blanco
  [0019–0024].
- Dolor de Adempiere: **no hay botón de "descartar cambios"** — si navegas con
  cambios sin guardar, pierdes el trabajo. El equipo **ya implementó** el descarte
  en un build previo [0026–0039] — validación de que el panel mejora Adempiere.

### 3.5 "Modelo de negocio" reemplaza "Departamento de nómina"

- "Tipo de nómina" en Adempiere debería decir solo **quincenal / semanal** [0138–0148].
- **"Departamento de nómina" → renombrar a "Modelo de negocio"** [0152–0177].
  Valores: farmacia, librería, panadería, restaurante, colegio,
  distribuidora/comercializadora (p.ej. distribuidora de tecnología), boutique,
  taller…
- El modelo de negocio **determina la lista de cargos/puestos** disponibles en el
  contrato:
    - restaurante → cocinero, mesonero, cajero, "pollero", asador, seguridad interna.
    - farmacia → analista de compras, administrativo, "aprendiz de farmacia", …
    - Listas **pre-cargadas por Grupo ALCO** [0169–0178].
- **Auto-inferir el modelo de negocio al crear la empresa**: "yo creo una empresa
  que se llama Farmacia Farmalido, el sistema ya debería saber cuál es el modelo
  de negocio" — seleccionable o intuido; ojo con "comercializadora" que puede ser
  varias cosas → a veces hay que preguntar [0178].
- Mayormente Fase 2 (RRHH), pero **el cargo del contrato toca Fase 1**.

### 3.5.1 Modelo de negocio y catálogo de cargos — decisiones (post-reunión)

Discutido y cerrado con Jesús después de la reunión, sobre §3.5 y análisis
crítico §6.8. Contexto: el cargo **no puede vivir en la persona** — alguien puede
ser gerente en una empresa y cocinero en otra (Ezequiel: contratos y roles
distintos por empresa [0281]); y "modelo de negocio" (lo que Ezequiel quiere en
lugar de "departamento de nómina") es un eje **de la empresa**, no del contrato,
que además filtra qué cargos se ofrecen.

- **DC1 — El cargo vive en `employment.position_id`, nunca en `employee`.** Cada
  contrato elige su puesto de forma independiente. El caso "gerente aquí /
  cocinero allá" queda cubierto sin nada extra. (Cierra Q5.)
- **DC2 — `position` ↔ modelo de negocio es M:N.** Join
  `position_business_model`. Un `position` sin filas en el join = **genérico**:
  aplica a todos los modelos (cubre "administrativo", "seguridad interna",
  "cajero", que se repiten entre rubros).
- **DC3 — El modelo de negocio es atributo de `client_company`**
  (`business_model_id` nullable, con default heredado del grupo). No va en el
  contrato. Nuevo modelo `business_model` (`id`, `code`, `name`, `status`).
- **DC4 — El selector de puesto en el form de contrato** filtra por el modelo de
  negocio de la empresa de ese contrato + los genéricos. Escape hatch **"otro →
  crea `position`"** en el momento (queda genérico o se le taggea el modelo ahí
  mismo) — van a aparecer cargos nuevos (Ezequiel: "son cosas que no habíamos
  visto" [0281]).
- **DC5 — Se mantienen dos ejes (Opción B).** `client_company.business_model`
  (setea el catálogo) **y** `employment.department_id` como **departamento
  organizacional real** (Orientación, COVI, Administración, Cocina…), **opcional
  y sin uso en Fase 1** — la columna ya existe en el schema, no se llena salvo
  que Ezequiel lo pida, queda lista para nómina/reportes de Fase 2.
  `position.department_id` deja de usarse como eje de filtrado (el filtrado pasa
  a ser por modelo de negocio); se elimina o se deja como metadato opcional.
- **DC6 — Migración.** El Excel de Adempiere trae por contrato los strings
  "Puesto Nómina" y "Departamento Nómina". Hace falta una tabla de mapeo string →
  catálogo nuevo (`position` / `business_model`) y una política para los que no
  mapean (crear como genérico + marcar para revisión).
- **Auto-inferir el modelo de negocio del nombre de la empresa**: nice-to-have,
  P2, frágil (Ezequiel marcó "comercializadora" como ambiguo [0178]). No bloquea.

**Pendiente de confirmar con Ezequiel:** solo DC5 — ¿quiere registrar
"departamento" (Orientación, COVI, Administración) por contrato, aparte del
cargo? En Fase 1 no se llena; la pregunta es solo si se deja previsto. → Q14.

### 3.6 ID biométrico = cédula (base de la migración)

- "El ID es la cédula" en **todos** los biométricos, "en todos" [0261]. "Es una
  maravilla, más fácil".
- Estrategia de migración, dos fuentes de datos:
    1. **Biométricos** (por empresa): ID (=cédula) + nombre.
    2. **Export de Adempiere** (Excel): todo lo demás. "Vamos a tener un Excel que
       sacamos de Adempiere y ese es nuestro export para la migración" — **join
       cédula ↔ cédula** [0261].
- El equipo había asumido ID aleatorio/secuencial (se habló con "Alentía");
  Ezequiel: la cédula es única y suficiente [0261].
- **Riesgo señalado por el equipo**: sin control 100% de que un admin local en una
  sede cree un usuario directo en el device con ID duplicado/errado → "que ese
  usuario sea dos". Mitigación: el bloqueo de administrador que ya construyeron +
  el flujo de enrolamiento centralizado que hace Ezequiel.
- **Nombres truncados en el device** por límite de caracteres: "Ezequiel Alba" en
  sistema vs "Ezequiel" en device; "Wanda Silva" → "Wanda" o "Wanda S" (no cabe la
  S) [0261]. El sistema debe permitir **editar el nombre completo manual**, usando
  el del device solo como referencia.

### 3.7 El device empuja más que nombre+cédula

- Al enviar info a un equipo, también viaja el **flag de administrador**, el **tipo
  de usuario** y el **cargo** [0266, 0499]. Si mandas un admin, al querer entrar al
  menú te quedas fuera.
- **"Truco" de Ezequiel** [0266–0270]: dejar el menú del device abierto, mandar la
  info, y ver llegar los registros (4→5→6…) antes de que se cierre; luego revisar
  usuario por usuario si tiene huella. Así encontró **8 de ~100+ sin huella**.

### 3.8 Visibilidad de huella en el sistema

- Requerimiento [0270, 0731]: el sistema debe mostrar, por empleado, **si tiene
  huella o no** (sí/no — no interesa ver la imagen). Objetivo: **confiar en el
  sistema y no tener que meterse al device** a revisar.

### 3.9 Migración: re-apuntar el dispositivo

- Objetivo [0179, 0261, 0687]: sin borrar datos de trabajadores, **cambiar en cada
  device la IP/puerto del servidor** (de Adempiere → sistema nuevo) y **jalar todos
  los usuarios** que ya tiene el device al sistema.
- Flujo que imagina Ezequiel: va sede por sede con su laptop, cambia los
  parámetros del servidor, el device sigue empujando marcajes, "el cliente ni se
  entera". Lo menos traumático. Es lo mismo que hace hoy al configurar Farmalido
  (checklist: actualizar hora + agarrar huella).
- Tras re-apuntar, en el sistema nuevo **solo llega nombre** (del device) **+
  cédula** (=ID). Todo lo demás (cargo, sede, etc.) se carga manual [0261].
- **Migrar huellas device→sistema y sistema→otro device**: el paso device↔device
  ya está resuelto y verificado físicamente por el equipo (huella de Eivar)
  [0690–0692]. Falta el tramo **jalar la huella del device al sistema** y
  mostrarla/re-empujarla [0261].
- **Device de prueba entregado** [0271, 0281, 0687]: 1 biométrico apuntando a
  Adempiere, cargado con ~4 empleados (Ezequiel, Yamilé, "Sciolady", + otros; hay
  un "Pedro Pérez" de prueba que aparece sin saber de dónde). Sirve para probar
  el re-apuntado y el jalado de usuarios.
- **Campo "ID del equipo" en el device**: el equipo propone que sea el **RIF de la
  empresa**; problema: si una sede tiene más de un device, todos vienen con "1" por
  defecto y Ezequiel no lo toca. Pendiente estandarizar; el identificador del
  device ≠ identificador del sistema [0261].

### 3.10 Escaneo de cédula / RIF + IA

- **RIF**: siempre PDF, formato fijo, fácil de parsear. Subir RIF → autocompletar
  empresa: número de RIF, razón social, dirección. Ezequiel solo llena:
  **representante legal** (nombre), **cédula del rep. legal**, **celular del rep.
  legal** — o sube foto de la cédula del rep. legal [0281].
- **Cédula**: es una **foto** → "ya hay modelos de IA que agarran eso". Subir foto
  → autocompletar empleado: nombre completo, **fecha de nacimiento** (lo que más le
  importa), cédula, dirección [0271–0279].
- **Por qué**: Ezequiel tiene **dislexia**, transpone letras/números. Hoy su
  workaround es entrar a las páginas del CNE (cédula → nombre) y del SENIAT
  (consultar RIF) y copiar/pegar para no equivocarse [0271–0279].
- El nombre/celular del rep. legal se necesita después para la **generación de
  contratos** de Fase 2 ("…representada en este acto por Ezequiel Alvarado, que se
  denominará el patrono…") [0281].

### 3.11 Datos de empresa que faltan

- **Logo de empresa** (upload) → aparece en el **recibo de pago** [0281]. Yamilé ya
  tiene logos por empresa/colegio en Galexo. Si el sistema no lo trae, hay que
  cargarlo.
- Faltan además: representante legal (nombre + cédula + celular), y campos
  generales que Adempiere sí tiene. (notas internas #8).

### 3.12 Listado / filtro de empleados — **gap #1 de Adempiere**

- Repetido ≥4 veces [0179, 0189, 0213, 0231, 0664–0678]. En Adempiere "no hay un
  listado de empleados… y eso es un error grave" [0233–0234]. "Proceso de nómina →
  registro de aplicación → empleado" abre **un** registro, no una lista.
- Requerimiento: **listar/filtrar empleados por grupo, por empresa y por sede**.
  "Ver todos los del Grupo Factory, pero también solo los de Babylon, solo los de
  Arca" [0672–0676].
- El empleado en Adempiere **no muestra a qué empresa pertenece**; como parche
  llevan un par de horas metiendo el nombre de la empresa en el campo
  _descripción_ del usuario del device [0261]. El sistema nuevo debe mostrar
  empresa/sede en la ficha del empleado.

### 3.13 Metadatos de dispositivo

- Que el device en el sistema muestre **en qué fecha se agregó a esa empresa/sede**
  — "eso faltaría aquí" [0281].
- Que el device lleve **nombre de empresa + descripción**; hoy las sedes van en el
  campo descripción a mano [0281].
- **Varios dispositivos por sede** es un caso real (Colegio Norteamericano, device
  atrás para vigilantes) [0280].

### 3.14 Tipos de usuario del device / torniquetes

- Tipos: **normal / superusuario / admin**. **Nadie recuerda la diferencia** entre
  superusuario y admin; no hay documentación; el equipo lo investigó y no
  encontró nada que el superusuario no pudiera hacer [0281].
- No se puede **promover** user→superusuario desde la plataforma. A "Edgar" le
  crearon un superusuario y al final no pudo usarlo [0281].
- **Control de acceso / torniquetes** = deuda técnica explícita [0281]. La empresa
  que le alquila 5 biométricos a Grupo ALCO sí tiene torniquetes. Cuando se
  implemente: NO agregar a todos los devices automáticamente; el permiso de puerta
  quizá se ata al tipo de usuario. "Preverlo de una vez y que de eso dependa la
  interfaz".

### 3.15 Panel web ya construido (demo del equipo)

- Web, **no local**; en un servidor en la nube (IP), login usuario+clave [0271].
- Estado "crudo": crea empresas (creadas Grupo Alco + Alco 2), empresa con
  dirección + parámetros de asistencia, lista de devices [0271].
- Devices muestran los nombres que tiene el equipo ("entrada lateral"). Se puede
  **vincular** un usuario-de-device (p.ej. "París Jesús") a una ficha de empleado,
  moverlo de "entrada lateral" a "farmacia Farmalido", y **vincular uno a varios
  empleados** [0694–0734].
- Gestión de sedes existe (Grupo Alco: 1 sede en Barquisimeto); se ven conteos de
  empleados y de sedes por grupo [0281].
- Paso de huella entre los dos devices demo funciona [0690–0692].

### 3.16 Comercial / hosting / fases (contexto, con acciones)

- **Fases**: (1) control biométrico — este proyecto, cobro por hito, **primer pago
  al Hito 3** [0745–0754], código del cliente. (2) nómina, subdividida en (2a)
  nómina propiamente y (2b) RRHH integral ligado a la web de Emanuel
  (preselección, psicotécnicos, contratación). Concepto: **"RH 2.0"**.
- **Pausa de 1 semana** post-Fase 1 para investigar sistemas de nómina: pedir
  demos, revisar **Sairet** (viejo, ~300 clientes, Venezuela y Colombia — ángulo
  internacional), **Galexo** (el que usa Yamilé hoy; Ezequiel tiene un install
  local viejo en un mini-PC en Acarigua que dará al equipo con usuario/clave),
  listas de plataformas "RH 2.0", repos de GitHub [0281].
- **Requerimientos de nómina anticipados** (Fase 2, anotar ya):
    - Flexible a nuevos conceptos salariales y no salariales, modelos de negocio,
      convenciones colectivas, tipos de contrato — minimizar dependencia del equipo.
    - **Nómina plana vs nómina dinámica** (tilde por empresa): "plana" = empresas de
      4–5 trabajadores sin biométrico; el 15 y el 30 se genera el recibo solo,
      asumiendo cero incidencias, y se envía al cliente. Ezequiel tiene ~6 así.
    - Multi-moneda, **actualización BCV** ("el sistema tiene que actualizarse al BCV
      todo el día"). Casi todas las empresas pagan equivalente en USD (ej. 40
      USD/semana, 15 USD/quincena). **Nómina mensual = ilegal** en Venezuela (LOT:
      pago mínimo cada 15 días).
    - Fórmula semanal: salario diario × 365 / 52. Problema de meses con 5 semanas.
    - Conceptos: Seguro Social, FAOV, INCES, régimen prestacional de empleo, ISLR /
      ARI (resumen anual de salarios), provisión de vacaciones, prestaciones.
    - Contratos colectivos = ley específica por empresa (ej. petrolero). Grupo ALCO
      (abogados) parametriza la LOT + variantes por empresa; el equipo podría entrar
      como aliado para fórmulas puntuales por cliente.
    - Colegios: contratos docentes distintos por colegio (~90% iguales), horarios
      distintos (8–1 vs 8–5), muchos cargos (ej. departamento de orientación / COVI
      con psicólogos).
- **Modelo comercial propuesto**: pago **por biométrico** (~10 USD/equipo, escala
  con la responsabilidad de soporte) + **soporte técnico** por fallas de equipos
  [0261]. Contexto: Adempiere cobraba **10 USD por empresa registrada** (Ezequiel
  negocia bajar a 5 porque nunca terminaron); hoy "cliente nuevo con biométrico
  nuevo = 240 USD de servicio"; hay ~22–23 empresas en biométrico. Ezequiel
  insiste en **facturar para poder exigir** ("el problema de no cobrar es cómo te
  exijo si no te estoy dando mi medio") [0259–0261].
- **Hosting/dominio** [0247–0259]: Ezequiel tiene cPanel, dominio principal
  **`alcolegaltech.com`** (vacío), ideas de subdominio `app.` / `admin.`. La página
  actual (Emanuel) se cae cada 2–3 días y hay que llamarlo; además una licencia
  "Altimover" de 25 USD/mes con mora. Plan del equipo: **comprar servidor
  dedicado**, unificar todo bajo el dominio de Ezequiel, subdominio `admin.`,
  apuntar DNS y dividir rutas — "es tu servidor, no se te cae nunca".
- Ezequiel **conectará al equipo con Emanuel** (web) y con **Yamilé** (nómina —
  shadowing de cómo lo hace en Galexo).
- **Presentación a las decisoras de Grupo ALCO** (incl. su esposa); quiere "efecto
  wow"; posible **viaje a Acarigua** a presentar, Ezequiel invita a almorzar
  [0559–0577].

### 3.17 Filosofía de producto (con decisión)

- Tira y afloja "el cliente siempre tiene la razón" vs "el software se adapta al
  usuario, el usuario no se adapta al software" [0603–0653]. Resultado concreto:
  el auto-share a todo el grupo se implementa como en Adempiere; la idea del
  equipo (seleccionar el grupo) se puede probar y revertir si Ezequiel prefiere lo
  suyo.

---

## 4. Verificación de las notas internas contra el transcript

| #   | Nota interna                                                                                                | Veredicto                     | Evidencia / matices                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Grupo ALCO necesita padre + hijas + sedes; quitar la padre fue un error                                     | ✅ **Confirmado**             | [0279–0281]. Hacen falta **las dos**: grupo sin RIF **y** empresas hijas con RIF distinto **y** sedes. En `prisma/schema.prisma` el modelo `client_company` **ya no tiene** `parent_id` / `is_group` / `shared_employees` (§5) — hay que restaurarlos.                                                                                                               |
| 2   | Renombrar padre → "Grupo de Empresas", sin RIF                                                              | 🟡 **Parcial**                | Sin RIF: confirmado [0279]. El nombre: Ezequiel oscila (grupo/organización/corporación/franquicia) y lo debate él mismo. No hubo decisión. → §7.                                                                                                                                                                                                                     |
| 3   | Al agregar empleado a empresa/grupo, biometría a todas las hermanas/hijas, sii "Compartir Empleados" activo | ✅ **Confirmado** (con matiz) | Auto-share a todo el grupo: [0502–0521, 0647–0656], es el comportamiento de Adempiere y lo quiere igual. El **toggle** explícito es diseño nuestro (era `shared_employees` en `08`, removido). Excepción futura: torniquetes/acceso [0281].                                                                                                                          |
| 4   | Empleado↔empresa vía contrato N:M; el contrato lleva datos, no es solo join                                 | ✅ **Confirmado**             | [0005–0016, 0056–0064, 0431]. Campos: empresa, fecha inicio (crítica), tipo nómina, cargo, estado activo/inactivo/retirado, historial salarial. Re-contratación = contrato nuevo con fecha nueva. El modelo `employment` **ya existe** en el schema con `start_date/end_date/status/position/department/site` — le faltan `tipo_nomina` y el modelo de negocio (§5). |
| 5   | ID biométrico = cédula; estandarizar; base de la migración (biométricos + reportes Adempiere)               | ✅ **Confirmado** (fuerte)    | [0261]. Export Excel de Adempiere, join cédula↔cédula. `employee.national_id @unique` ya está en el schema.                                                                                                                                                                                                                                                          |
| 6   | Letra más grande (+40 años)                                                                                 | ✅ **Confirmado**             | [0281]. "Todo el Grupo ALCO menos Yamilé tenemos +40". El equipo ya lo había notado.                                                                                                                                                                                                                                                                                 |
| 7   | Escanear cédula (foto+IA) y RIF (PDF) para autocompletar empleado y empresa                                 | ✅ **Confirmado**             | [0271–0279, 0281]. RIF = PDF (fácil). Cédula = foto (OCR/IA). Motivado por la dislexia de Ezequiel.                                                                                                                                                                                                                                                                  |
| 8   | Info de empresa incompleta — falta logo (→ recibo de pago) y campos de Adempiere                            | ✅ **Confirmado**             | [0281]. Logo → recibo de pago. Falta también rep. legal (nombre + cédula + celular).                                                                                                                                                                                                                                                                                 |

### 4.1 Elementos NO listados en las notas internas (no perder)

- **A.** Listado/filtro de empleados por grupo/empresa/sede — el gap más repetido
  de la reunión (§3.12).
- **B.** Soft-delete / no borrado en duro por auditoría; conservar historial
  salarial 20+ años (§3.4, [0179–0186]).
- **C.** Indicador de huella sí/no por empleado en el sistema (§3.8).
- **D.** Fecha de alta del dispositivo en la empresa/sede; device con nombre de
  empresa + descripción (§3.13).
- **E.** Varios dispositivos por sede (§3.13).
- **F.** Migración por re-apuntado de IP/puerto sin borrar usuarios; jalar usuarios
    - huellas device→sistema; device de prueba entregado (§3.9).
- **G.** El device empuja admin flag + tipo de usuario + cargo; riesgo de lockout
  del admin; "truco" del menú abierto (§3.7).
- **H.** "ID del equipo" del device vs identificador del sistema — estandarización
  pendiente (¿RIF?) (§3.9).
- **I.** Nombre del producto/sistema — sin definir ("como le queramos llamar",
  [0261]).
- **J.** Tipos de usuario del device (normal/superusuario/admin): diferencia
  desconocida, sin docs, no promovible desde la plataforma (§3.14).
- **K.** Deuda técnica torniquetes / control de acceso (§3.14).
- **L.** "Modelo de negocio" reemplaza "departamento de nómina" y driftea los
  cargos; auto-inferir de la empresa (§3.5).
- **M.** "Tipo de nómina" → solo quincenal/semanal; nunca mensual (§3.5).
- **N.** Nombres truncados en el device — permitir editar nombre completo manual
  (§3.6).
- **O.** Botón "descartar cambios" ya implementado (§3.4).
- **P.** Hosting: `alcolegaltech.com`, subdominio `admin.`, servidor dedicado a
  comprar, unificar rutas, conectar con Emanuel (§3.16).
- **Q.** Modelo comercial: pago por biométrico + soporte; facturar; Hito 3 = primer
  pago (§3.16).
- **R.** Fase 2: nómina + RRHH "RH 2.0"; pausa de 1 semana; Sairet / Galexo (acceso
  vía Yamilé + install local en Acarigua); nómina plana vs dinámica; multimoneda/
  BCV; conceptos LOT; contratos colectivos (§3.16).
- **S.** Presentación a Grupo ALCO ("efecto wow"); posible viaje a Acarigua (§3.16).
- **T.** Recibo de pago con logo de empresa (Fase 2, pero el logo se captura ya)
  (§3.11).

---

## 5. Estado del código vs. lo pedido (gap analysis)

Contrastado con `prisma/schema.prisma`, `docs/08-data-model.md` y los formularios
de `components/admin/` / `app/admin/`.

| Requerimiento reunión                    | Estado actual                                                                                                                                      | Gap                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Grupo de empresas (padre, sin RIF)       | `08-data-model.md` lo tenía (`parent_id`, `is_group`); **`schema.prisma` real NO lo tiene**; `CompanyFormDialog.tsx` no tiene campo de padre/grupo | **Restaurar** `parent_id` + `is_group` en `client_company`; migración; UI de jerarquía en empresas                          |
| Sedes                                    | `site` existe en schema (con `timezone`), `SiteFormDialog.tsx` existe                                                                              | OK. Falta vista de "empleados por sede"                                                                                     |
| Compartir empleados al grupo (auto)      | `shared_employees` estaba en `08`, **removido del schema**; no hay lógica de fan-out a devices del grupo                                           | **Restaurar** flag (default `true`) + lógica: al crear/activar `employment`, enrolar en todos los devices del grupo         |
| Contrato N:M con datos                   | `employment` existe (`start_date`, `end_date`, `status`, `position`, `department`, `site`, `employee_group`)                                       | Falta `payroll_type` (quincenal/semanal). Cargo = `position_id` (OK); modelo de negocio va en la empresa, no acá (§3.5.1); `department_id` queda opcional sin uso en Fase 1 |
| ID = cédula                              | `employee.national_id @unique`                                                                                                                     | OK                                                                                                                          |
| Soft-delete auditoría                    | `record_status` / `employment_status` (active/inactive) + `audit_log`                                                                              | Revisar que **ninguna** acción de UI borre en duro empresas/empleados/contratos                                             |
| Listado empleados por empresa/sede/grupo | `app/admin/empleados/page.tsx` existe                                                                                                              | Verificar filtros por grupo/empresa/sede; agregar si faltan                                                                 |
| Huella sí/no por empleado                | `employee_fingerprint` (derivable con `count > 0`)                                                                                                 | Exponer el indicador en la lista/ficha de empleados                                                                         |
| Migración re-apuntado + jalar usuarios   | Hay `employee_device_enrollment`, `AddEmployeeToDeviceDialog`, "vincular device-user ↔ empleado" en demo                                           | Falta flujo de **importación masiva** de usuarios de un device recién re-apuntado + jalar huellas al `employee_fingerprint` |
| Logo de empresa                          | No hay columna `logo` en `client_company`                                                                                                          | Agregar `logo Bytes?` (o ruta) + upload en `CompanyFormDialog`                                                              |
| Rep. legal (nombre, cédula, celular)     | No hay                                                                                                                                             | Agregar campos a `client_company`                                                                                           |
| Escaneo cédula/RIF + IA                  | `d48e94d` agregó "document handling" para forms de empleado/empresa (`DocumentField`)                                                              | Verificar alcance; falta OCR/IA de cédula (foto) y parseo de RIF (PDF)                                                      |
| Fecha de alta device en empresa/sede     | `devices` (protocolo) + relación a `client_company`/`site`                                                                                         | Agregar timestamp de asociación                                                                                             |
| Tipos de usuario device / torniquetes    | —                                                                                                                                                  | Investigación pendiente; no bloquea Fase 1                                                                                  |
| Letra más grande                         | —                                                                                                                                                  | Ajuste de tema/tipografía del panel admin                                                                                   |

---

## 6. Análisis crítico

1. **La reunión no cambió la arquitectura de datos — la re-alineó con el borrador
   `08` que el código real ya había abandonado.** `parent_id`, `is_group`,
   `shared_employees` estaban firmados en `08-data-model.md` (2026-08-30) y
   desaparecieron del `schema.prisma` en los commits recientes. El costo de
   restaurarlos ahora es bajo (tablas "vacías", sin data productiva). Si se
   descubre después de la migración, es caro. **Prioridad alta, ventana barata.**

2. **El auto-share a todo el grupo y el futuro de torniquetes están en conflicto
   directo.** Hoy: "un hombre más, un hombre menos, no mueve la aguja". Mañana con
   control de acceso: agregar a todos = abrir puertas que no deben abrirse. La
   decisión correcta es implementar el auto-share con un **punto de extensión
   limpio** (el flag `shared_employees` a nivel de grupo, y a futuro override por
   sede/empleado), no cablearlo. Ezequiel ya lo aceptó como deuda técnica
   consciente [0281] — dejarlo documentado para no re-litigarlo.

3. **La migración depende de una sola llave: la cédula.** Si en algún device hay
   usuarios con ID que no es una cédula válida (el "Pedro Pérez 1345" de prueba
   [0261], usuarios creados a mano en sede), el join contra el Excel de Adempiere
   falla en silencio. Hace falta: un **reporte de reconciliación** pre-migración
   (IDs en device que no matchean ninguna cédula del export, y viceversa) antes de
   re-apuntar nada.

4. **"Hacer lo mismo que Adempiere" es un ancla, no un techo.** Ezequiel repite que
   necesita presentar algo "mucho mejor" para el efecto wow [0281, 0559–0577].
   Los dos entregables que generan ese efecto con poco esfuerzo son: (a) el
   **listado de empleados filtrable** que Adempiere no tiene, y (b) el
   **autocompletado por cédula/RIF**. Priorizar esos dos para la demo a las
   decisoras.

5. **El escaneo con IA tiene dos dificultades muy distintas.** RIF = PDF con texto
   → parseo determinista, barato, confiable. Cédula = foto → OCR/visión, costo por
   request, precisión variable, PII sensible. Tratar como dos features separadas;
   la del RIF puede salir en Fase 1, la de la cédula puede esperar o usar un
   servicio externo. No prometer las dos juntas.

6. **Riesgo comercial estructural.** Ezequiel es explícito: el proyecto Adempiere
   murió porque él no pagaba y por lo tanto no exigía [0259]. El primer pago recién
   llega al Hito 3. Mientras tanto el equipo carga: device de prueba, migración,
   panel, y expectativa de investigación de nómina no pagada. **Cerrar el Hito 3
   rápido y facturar** es lo que sanea la relación — es interés mutuo, no presión
   del cliente.

7. **Soporte técnico = pasivo recurrente.** El modelo "pago por biométrico" suena
   bien escalando, pero cada equipo desplegado es una obligación de disponibilidad
   (Ezequiel: "tener biométricos es más responsabilidad de ustedes conmigo"
   [0261]). Antes de comprometer un SLA hay que tener: alertas de device
   caído/mudo, y un runbook de "device no reporta". Parte de esto ya existe
   (sniffer, simulador) pero no como servicio monitoreado.

8. **"Modelo de negocio" mezcla dos cosas.** En Adempiere "departamento de nómina"
   y "puesto" eran campos separados y `08` los mantiene separados a propósito
   (`employment.department_id` + `position.department_id`). El "modelo de negocio"
   de Ezequiel [0165–0178] es un **tercer eje** (tipo de comercio) que filtra
   qué cargos se ofrecen. **Resuelto en §3.5.1** (DC1–DC6): modelo de negocio como
   atributo de `client_company`, M:N con `position`, cargo en
   `employment.position_id`, `employment.department_id` se mantiene como
   departamento real opcional (Opción B).

9. **Nada de esto invalida `04`/`05` (protocolo).** El único punto que toca el
   protocolo es que al enrolar viajan admin flag / tipo de usuario / cargo [0266] —
   ya está en `05-commands-catalog.md`. La huella limpia (`GET_USER_INFO`, 612
   bytes) que pide Ezequiel para el tramo device→sistema ya está resuelta y
   documentada.

---

## 7. Decisiones tomadas

| #   | Decisión                                                                                                                                             | Estado                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| D1  | Restaurar jerarquía **Grupo de empresas → Empresa (RIF) → Sede → Dispositivo(s)**                                                                    | Cerrada [0279–0281]                              |
| D2  | La entidad padre **no lleva RIF**                                                                                                                    | Cerrada [0279]                                   |
| D3  | Al asignar empleado a cualquier empresa del grupo → enrolar en **todos** los devices del grupo, **automático** (no seleccionable en el flujo normal) | Cerrada [0502–0521]; revisable si molesta [0544] |
| D4  | **ID del usuario = cédula** en todos los devices; llave de la migración                                                                              | Cerrada [0261]                                   |
| D5  | Contrato de trabajo N:M con datos propios; re-contratación = contrato nuevo con fecha nueva; historial no se borra                                   | Cerrada [0431, 0179]                             |
| D6  | **Soft-delete** por auditoría para empresas/empleados/contratos                                                                                      | Cerrada [0179–0186]                              |
| D7  | Migración = **re-apuntar IP/puerto del device** sin borrar usuarios; jalar usuarios + huellas al sistema                                             | Cerrada [0179, 0687]                             |
| D8  | Device de prueba (apunta a Adempiere, ~4 empleados) queda con el equipo para probar el re-apuntado                                                   | Cerrada [0271, 0687]                             |
| D9  | "Departamento de nómina" → **"Modelo de negocio"**; "tipo de nómina" → solo quincenal/semanal                                                        | Cerrada [0152–0177]                              |
| D10 | Autocompletar empresa desde **RIF (PDF)** y empleado desde **cédula (foto+IA)**                                                                      | Cerrada como objetivo [0271–0281]                |
| D11 | Subir **logo** de empresa → recibo de pago                                                                                                           | Cerrada [0281]                                   |
| D12 | Agrandar la tipografía del panel                                                                                                                     | Cerrada [0281]                                   |
| D13 | Torniquetes / control de acceso = **deuda técnica diferida**; prever el punto de extensión                                                           | Cerrada [0281]                                   |
| D14 | Primer pago al **Hito 3**; el equipo avisa al llegar                                                                                                 | Cerrada [0745–0754]                              |
| D15 | Post-Fase 1: **1 semana** de investigación de sistemas de nómina antes de Fase 2                                                                     | Cerrada [0281]                                   |
| D16 | Sistema alojado en **servidor dedicado** propio bajo el dominio de Ezequiel (`alcolegaltech.com`, subdominio `admin.`)                               | **En pausa** — landing/dominio se decide después, fuera de este desarrollo (§7.1 ítem 22) |
| D17 | Modelo comercial: **pago por biométrico** + soporte técnico                                                                                          | Propuesto, no firmado [0261]                     |
| D18 | **Modelo de negocio** = atributo de `client_company` (default del grupo); M:N con `position` (sin match = genérico); cargo en `employment.position_id`; se mantiene `employment.department_id` como departamento real **opcional** sin uso en Fase 1 (Opción B); mapeo de strings "Puesto/Departamento Nómina" de Adempiere en la migración. Detalle en §3.5.1 (DC1–DC6) | Cerrada (post-reunión con Jesús); DC5 pendiente confirmar → Q14 |

### 7.1 Decisiones del formulario (Jesús ↔ Ezequiel, 2026-09-10)

Cierra Q1–Q14 y agrega decisiones de implementación. Numeración = ítem del formulario.

| # | Tema | Decisión |
| - | ---- | -------- |
| 1 | Nombre entidad padre | **"Grupo de Empresas"** (cierra Q1) |
| 2 | Nombre del producto | Provisional **"Panel ALCO"**; nombre comercial en Fase 2 (cierra Q3) |
| 3 | Departamento real por contrato | **Sí, previsto** — `employment.department_id` opcional, no se llena en Fase 1 (cierra Q14 / DC5) |
| 4 | Soft-delete | Empresa, empleado, contrato **y sede** = baja lógica. Dispositivo: se desasocia, el histórico queda |
| 5 | Flag "Compartir empleados" | Vive en el **grupo**, default **activado** (cierra Q2) |
| 6 | Disparo del fan-out | **Automático al activar el contrato** + botón "re-sincronizar grupo" para reparaciones. Confirmado: agregar un empleado nuevo a un grupo ya compartido lo enrola en todos los devices del grupo sin acción manual |
| 7 | Override torniquetes | Punto de extensión en el código ahora, **sin UI** (DT1) |
| 8 | Migración de schema | **Un PR** con la migración Prisma (revert jerarquía + campos nuevos), luego PRs de UI por área |
| 9 | Catálogo modelo de negocio → cargos | Base = cargos del **export de Adempiere** + Ezequiel corrige/completa; editable desde el panel (cierra Q4) |
| 10 | Herencia de `business_model` | Nullable en la empresa → hereda del grupo → si el grupo tampoco tiene, se pide al crear |
| 11 | "Otro → crear puesto" | El puesto nuevo se **taggea al modelo de negocio de esa empresa**, editable después |
| 12 | Contenido del device de prueba | Todos de prueba (Ezequiel, Yamilé, Sciolady, Pedro Pérez) **pero NO borrar nada** — se quieren esas cédulas/huellas; "Pedro Pérez" incierto. Se importa como data real; la reconciliación (ítem 15) lo marca si no matchea (cierra Q7) |
| 13 | ID no-cédula en import | Va a bandeja **"pendientes de revisión"**; no se crea `employee` hasta resolver |
| 14 | Campo físico "ID del equipo" | El sistema identifica por **número de serie** (ya lo hace). "ID del equipo" → RIF + sufijo (`-2`, `-3`) al configurar equipos nuevos, **no crítico** (cierra Q8) |
| 15 | Reporte de reconciliación | **Obligatorio y revisado** antes de re-apuntar cualquier device en sede |
| 16 | Autocompletado desde RIF (PDF) | **Incluido en Fase 1** |
| 17 | Autocompletado desde cédula (foto) | **Incluido en Fase 1**, con servicio externo de OCR (⚠️ amplía alcance vs. la recomendación de diferir) |
| 18 | Migración desde Adempiere — comercial | **Se absorbe en Fase 1 / Hito 5, sin costo extra** |
| 19 | Criterio de "Hito 3 cerrado" (gatilla 1er pago) | CRUD completo **incluyendo** jerarquía restaurada + modelo de negocio + compartir empleados, verificado en vivo con `qa-hito-3.md` |
| 20 | SLA de soporte | **Best effort, sin SLA formal** por ahora (cierra Q10) |
| 21 | Muestras RIF PDF + Excel de Adempiere | Ezequiel las envía "en un rato" — **pendiente de recibir** (cierra Q6 al llegar) |
| 22 | Landing + dominio | **Decidir después** — fuera de este desarrollo (cierra Q11; D16 queda en pausa) |
| 23 | Infra producción (Ashburn) | **Esperar** a cerrar el Hito 3 reabierto; el desarrollo sigue sobre Nuremberg |
| 24 | Fecha de presentación a Grupo ALCO | Sin fecha; se fija al cerrar Hito 3 + probar la migración con el device de prueba (cierra Q12) |
| 25 | Ventana de investigación de nómina | **1 semana entre Fase 1 y Fase 2**; credenciales del Galexo local + contacto de Yamilé cuando arranque esa ventana (cierra Q13) |
| 26 | Superusuario vs admin del device | Lo investiga el equipo contra el device de prueba, **no bloquea** (cierra Q9) |

**Impacto de alcance (ítems 16+17+18):** Fase 1 crece — OCR de RIF **y** de cédula, y
la migración completa desde Adempiere, todo sin facturación extra. El primer pago
sigue atado al Hito 3 (ítem 19), así que la prioridad #1 es cerrar el Hito 3
reabierto.

---

## 8. Preguntas abiertas / a confirmar con Ezequiel

**Q1–Q14: todas resueltas en el formulario del 2026-09-10 → §7.1.** Lo único que
queda pendiente es material, no decisión:

- **Q6 / ítem 21** — recibir de Ezequiel una muestra real de un **RIF en PDF** y de
  un **export Excel de Adempiere** de una empresa con varios empleados. Bloquea los
  AIs 24 (parseo de RIF), 12 y 40 (reconciliación + mapeo de cargos). Ezequiel dijo
  que los manda "en un rato".

---

## 9. Action items

Prioridad: **P0** bloquea la migración o el Hito 3 · **P1** necesario para la demo
a Grupo ALCO · **P2** Fase 1 pero no urgente · **P3** Fase 2 / investigación.

### Modelo de datos / backend

| #   | Acción                                                                                                                                                                                   | Prio   | Notas                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| 1   | Restaurar `client_company.parent_id` + `is_group` (+ `@relation` self, `onDelete: Restrict`) y migración                                                                                 | **P0** | Estaba en `08`; se cayó del schema real. Ventana barata (tablas vacías)                     |
| 2   | Restaurar `client_company.shared_employees Boolean @default(true)`                                                                                                                       | **P0** | Confirmar en Q2 si va en grupo o empresa                                                    |
| 3   | Lógica de fan-out: al crear/activar un `employment` en una empresa de un grupo con `shared_employees`, encolar enrolamiento en **todos** los devices de **todas** las empresas del grupo | **P0** | Espeja Adempiere [0502]. Idempotente. Punto de extensión para override futuro (torniquetes) |
| 4   | Agregar a `employment`: `payroll_type` enum `{ quincenal, semanal }`                                                                                                                     | **P1** | D9                                                                                          |
| 5   | Nuevo modelo `business_model` + `client_company.business_model_id` (default del grupo) + join M:N `position_business_model` (sin match = genérico). Dejar de filtrar por `position.department_id`. Ver §3.5.1 DC2–DC5 | **P1** | Q4 (pedir catálogo). `employment.department_id` se mantiene, sin uso en Fase 1 (DC5)        |
| 6   | Agregar a `client_company`: `logo`, `legal_rep_name`, `legal_rep_national_id`, `legal_rep_phone`                                                                                         | **P1** | notas #8, §3.11                                                                             |
| 7   | Timestamp de asociación device↔empresa/sede                                                                                                                                              | **P2** | §3.13                                                                                       |
| 8   | Auditar todas las server actions: que **ninguna** borre en duro empresa/empleado/contrato; degradar a `status=inactive`                                                                  | **P0** | D6                                                                                          |
| 9   | Confirmar/crear enum de estado de contrato con `retirado` además de `inactive`, o documentar que `inactive` cubre "retirado"                                                             | **P2** | [0179]                                                                                      |

### Migración

| #   | Acción                                                                                                                                                  | Prio   | Notas                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| 10  | Flujo de **importación masiva** de usuarios de un device recién re-apuntado → crea/matchea `employee` por cédula, crea `employee_device_enrollment`     | **P0** | §3.9                                            |
| 11  | Jalar **huellas** device→sistema (`GET_USER_INFO`, 612 bytes) → `employee_fingerprint` durante la importación                                           | **P0** | Tramo device→sistema; device↔device ya resuelto |
| 12  | **Reporte de reconciliación** pre-migración: IDs en device sin cédula válida / sin match en el Excel de Adempiere, y cédulas del Excel sin enrolamiento | **P0** | Análisis crítico #3                             |
| 13  | Probar el ciclo completo con el **device de prueba** entregado (re-apuntar IP → importar 4 usuarios → verificar huellas)                                | **P0** | D8                                              |
| 14  | Definir estándar del campo "ID del equipo" del device y documentarlo en `05`/`06`                                                                       | **P2** | Q8                                              |
| 15  | Runbook "device re-apuntado no reporta"                                                                                                                 | **P2** | soporte                                         |
| 40  | Tabla de mapeo de los strings **"Puesto Nómina" / "Departamento Nómina"** del Excel de Adempiere → `position` / `business_model`; política para los que no mapean (crear genérico + marcar para revisión) | **P1** | §3.5.1 DC6. Bloquea la carga de contratos migrados con cargo correcto |

### Panel admin (UX)

| #   | Acción                                                                                             | Prio   | Notas                                                                        |
| --- | -------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| 16  | **Listado de empleados filtrable por grupo / empresa / sede**                                      | **P1** | Gap #1 de Adempiere; feature "wow". Verificar `app/admin/empleados/page.tsx` |
| 17  | Mostrar empresa(s)/sede(s) en la ficha del empleado                                                | **P1** | [0261]                                                                       |
| 18  | Indicador **huella sí/no** por empleado en lista y ficha                                           | **P1** | §3.8. `count(employee_fingerprint) > 0`                                      |
| 19  | UI de jerarquía en empresas: crear grupo, colgar empresas, ver conteo de empleados/sedes por nivel | **P1** | D1                                                                           |
| 20  | Editar **nombre completo** del empleado manual; mostrar el nombre del device como referencia       | **P2** | §3.6 nombres truncados                                                       |
| 21  | Agrandar tipografía base del panel (plantilla +40)                                                 | **P1** | D12. Barato, alto impacto percibido                                          |
| 22  | Verificar que el botón "descartar cambios" está en todos los forms                                 | **P2** | [0026–0039] ya implementado en un build                                      |
| 23  | Vista de devices por sede, con soporte a **varios devices por sede**                               | **P2** | §3.13                                                                        |

### Escaneo / IA

| #   | Acción                                                                                       | Prio   | Notas                                                 |
| --- | -------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| 24  | Parseo de **RIF (PDF)** → autocompletar empresa (RIF, razón social, dirección)               | **P1** | Determinista. Pedir muestra (Q6)                      |
| 25  | OCR/IA de **cédula (foto)** → autocompletar empleado (nombre, fecha nac., cédula, dirección) | **P1** | Fase 1 con servicio externo de OCR (§7.1 ítem 17). Cuidar costo/PII |
| 26  | Revisar qué cubre ya el `DocumentField` de `d48e94d`                                         | **P2** | evita trabajo duplicado                               |

### Comercial / coordinación (dueño: equipo + Ezequiel)

| #   | Acción                                                                                                            | Prio   | Notas                           |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- |
| 27  | Definir y comunicar el checklist del **Hito 3**; avisar a Ezequiel al llegar                                      | **P0** | D14 — desbloquea el primer pago |
| 28  | Cerrar Q1–Q13 con Ezequiel (una pasada, por chat/llamada)                                                         | **P1** |                                 |
| 29  | Pedir a Ezequiel: catálogo de modelos de negocio→cargos, muestra de RIF PDF, muestra de Excel export de Adempiere | **P1** | Q4, Q6                          |
| 30  | Contacto de **Emanuel** (web/hosting) y de **Yamilé** (nómina) + credenciales del Galexo local                    | **P2** | [0126, 0281]                    |
| 31  | Comprar/provisionar **servidor dedicado**; plan de dominio `alcolegaltech.com` + subdominio `admin.`              | **P2** | D16, `06-infrastructure.md`     |
| 32  | Propuesta comercial escrita: pago por biométrico + alcance de soporte/SLA                                         | **P2** | D17                             |
| 33  | Fijar fecha tentativa de la **presentación a Grupo ALCO** → deadline de P1                                        | **P1** | Q12                             |
| 34  | **Depurar la grabación**: quitar cédulas/RIFs reales dictados en la demo                                          | **P1** | [0261] pedido explícito         |

### Fase 2 / investigación (P3, ventana: 1 semana post-Fase 1)

| #   | Acción                                                                                                                                                         | Notas   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 35  | Demos y levantamiento: **Sairet**, plataformas "RH 2.0", repos de GitHub de nómina                                                                             | [0281]  |
| 36  | Shadowing de **Yamilé en Galexo**; usar el install local de Acarigua                                                                                           | [0281]  |
| 37  | Documentar requerimientos de nómina: nómina plana vs dinámica, multimoneda/BCV, conceptos LOT (SSO, FAOV, INCES, ARI/ISLR, prestaciones), contratos colectivos | §3.16   |
| 38  | Diseñar **generación de contratos** (patrono/trabajador) — necesita rep. legal, ya capturado en AI #6                                                          | [0281]  |
| 39  | Investigar diferencia **superusuario vs admin** en el device y viabilidad de torniquetes                                                                       | Q9, D13 |

### Deuda técnica registrada

- **DT1** — Auto-share a todo el grupo vs control de acceso por puerta. Cuando
  entren torniquetes: override por sede/empleado sobre el fan-out del AI #3.
  Aceptado conscientemente por Ezequiel [0281].
- **DT2** — Sin control de que un admin de sede cree usuarios directo en el device
  con ID no-cédula. Mitigado por el bloqueo de admin; monitorear con el reporte de
  reconciliación (AI #12).
- **DT3** — Sin monitoreo de device caído/mudo como servicio (prerequisito del SLA
  de soporte).

---

## 10. Encaje en el roadmap

Reunión 3 **no rompe el roadmap**, pero (a) reabre parcialmente el Hito 3 que se
daba por cerrado, y (b) asciende la migración desde Adempiere de "trabajo posible"
a entregable de primera clase que redefine qué es "listo para producción".

### 10.1 Estado antes de Reunión 3

| Bloque | Estado |
| --- | --- |
| Relevamiento + `07-admin-ux-spec` + `08-data-model` firmado | ✅ hecho |
| Migración SQLite → Postgres/Prisma | ✅ en código + desplegado en test (Nuremberg) |
| Auth (sesiones, `proxy.ts`, cuentas) | ✅ hecho |
| **Hito 3 — CRUD dominio (#1–#6)** | ✅ "completo" en código; falta QA en vivo (`qa-hito-3.md`) |
| **Hito 4 — motor de asistencia** | 🟡 arrancado: fundación de tiempo (`lib/time.ts`, fix SET_TIME UTC, `site.timezone`). Falta 4a–4d |
| Hito 5 — reportes + export a nómina | ⬜ no empezado; formato Galepso diferido |
| Infra producción (Ashburn) | ⬜ pospuesto; ahora **explícitamente después del Hito 3 reabierto** (§7.1 ítem 23); prerequisito del 1er dispositivo real |
| Separación `sync-worker-alco` / `dashboard-alco` | ⬜ diferido |
| Migración de huellas **device ↔ device** | ✅ resuelto (2026-09-07) |

El plan viejo **ya tenía** jerarquía padre→hija de 2 niveles (Hito 3 #1: `parent_id`,
trigger `client_company_two_levels`, CHECK de RIF para hojas). Se quitó por error en
un commit posterior. Reunión 3 lo corrige — no es concepto nuevo.

### 10.2 Clasificación de los cambios

| Bucket | Qué | AIs |
| --- | --- | --- |
| **Reversión** (volver a lo que existía) | Restaurar `parent_id` + `is_group` + UI de jerarquía | 1, 19 |
| **Reabre Hito 3** (refinamiento de dominio) | `shared_employees` + **lógica de fan-out** al activar `employment` (comportamiento nuevo, toca enrolamiento #5); `business_model` + M:N con `position` (toca catálogo #2 y form de empleo #4); `payroll_type`; `logo` + rep. legal; timestamp device↔empresa | 2, 3, 4, 5, 6, 7, 40 |
| **Nuevo en Fase 1** | Filtro de empleados por grupo/empresa/sede + empresa/sede en la ficha (extiende #4); indicador huella sí/no; **importación masiva device→sistema** + jalar huellas en bloque; reporte de reconciliación; autocompletado RIF (PDF); **OCR de cédula (foto) con servicio externo** (§7.1 ítem 17); tipografía; estándar "ID del equipo" | 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 21, 24, 25 |
| **Sin cambios** | Motor de asistencia (Hito 4); hot path del protocolo (`lib/handlers/**`, `lib/operations/**`); Postgres/Prisma; auth/`proxy.ts`; migración device↔device; separación en servicios; permisos planos; export Galepso (formato); todo lo demás "fuera de Fase 1" de `01-requirements.md` | — |
| **Fase 2 / no ahora** | Nómina (plana/dinámica, BCV, LOT, contratos colectivos, generación de contratos); RRHH "RH 2.0" + web de Emanuel; torniquetes (solo dejar el punto de extensión, DT1); superusuario vs admin del device; semana de investigación de nómina | 35–39 |

### 10.3 Ruta crítica revisada

El primer dispositivo real **no es un enrolamiento nuevo: es un device de Adempiere
re-apuntado**. Orden (ajustado por §7.1 ítem 23 — Ashburn espera a Hito 3):

1. **Reabrir y cerrar Hito 3** (bucket "reversión" + "reabre Hito 3"). Gatilla el 1er
   pago (§7.1 ítem 19). El desarrollo sigue sobre Nuremberg.
2. Flujo de importación masiva + reporte de reconciliación (AIs 10–12) — necesita la
   muestra de export de Adempiere (Q6).
3. Probar el ciclo completo con **el device de prueba entregado** (AI 13) — re-apuntar
   IP → importar los usuarios (sin borrar nada, §7.1 ítem 12) → verificar huellas.
   Esto además cubre la validación de polling en WAN que antes dependía de conseguir
   un equipo.
4. **Infra producción Ashburn** — recién ahora; sigue siendo prerequisito para tocar
   un device en sede.
5. Re-apuntar un device en sede.
6. Hito 4 (4a–4d) y Hito 5 corren en paralelo desde el principio — no dependen de la
   migración.

### 10.4 Alcance / comercial

`01-requirements.md` lista como **fuera de Fase 1**: "migración de histórico salvo
trabajo adicional acordado" y "enrolamiento presencial de huellas". La migración
desde Adempiere (re-apuntado + import de usuarios/huellas) y el OCR de RIF **y** de
cédula son alcance nuevo; **decisión tomada (§7.1 ítems 17–18): se absorben en Fase 1
/ Hito 5, sin facturación extra.** El primer pago sigue atado al Hito 3 → prioridad
#1 es cerrarlo. Ver §6.6.

### 10.5 Decisiones difíciles de revertir (fijar ya)

1. `business_model` como **M:N desde ahora** — barato hoy (catálogos casi vacíos),
   caro tras cargar 32 empresas × cargos.
2. **Contrato de la lógica de fan-out** — dejar previsto el override por sede/empleado
   aunque no se implemente (DT1).
3. **Identificador físico del device** ("ID del equipo") — estandarizar bien de
   entrada; corregirlo implica visitar equipos en sede (Q8).
4. **Reporte de reconciliación antes de re-apuntar nada** — sin él, la migración crea
   empleados basura o pierde enrolamientos en silencio (§6.3, AI 12).

---

## 11. Mantenimiento de este doc

Al implementar cada AI que toque el schema o los flujos, actualizar
`08-data-model.md` (jerarquía + `parent_id`/`is_group`, `shared_employees`,
`payroll_type`, `business_model` + join M:N `position_business_model` + rol de
`employment.department_id` según §3.5.1, `logo`, rep. legal) y `05`/`06` (estándar
de "ID del equipo", runbooks de migración) en el mismo cambio.

---

## Notas internas (originales, pre-análisis)

Además del transcript, esto es lo que recordábamos de la reunión. Verificado punto
por punto en §4.

1. Grupo ALCO sí necesita empresas padre + hijas + sedes, la eliminación de la
   empresa padre en los últimos commits fue un error.
2. La empresa padre podemos renombrarla a Grupo de Empresas, esta no lleva RIF
   asociado. (deberíamos debatir esto)
3. Grupo ALCO necesita como un requerimiento 100% dado por su caso de uso y
   experiencia que al agregar un Empleado a una Empresa, sea un grupo o una
   empresa hija de un grupo, su información biométrica se agregue a TODAS las
   empresas hermanas/hijas. Esto sí y solo sí el campo "Compartir Empleados" está
   activado.
4. La relación entre un Empleado y una Empresa es a través de un contrato de
   trabajo y es N:M, un empleado puede tener múltiples contratos de trabajo, es
   decir trabaja en varias empresas. El contrato de trabajo, como visto en
   Adempiere lleva una serie de datos, no es solo una join table. No sé si ya
   contemplabamos ese objeto.
5. Los ID en los biométricos son la cédula de identidad del empleado. Esto lo
   debemos estandarizar en nuestro lado y es algo que nos servirá para la
   migración puesto que la tendremos en dos lados: los biometricos (de cada
   empresa, ID, nombre) y los reportes de Adempiere (toda la información
   restante).
6. Ezequiel mencionó que necesita que las letras sean un pelo mas grandes,
   haciendo un chiste de que todos en Grupo ALCO tienen +40 años.
7. En el ingreso de información, Ezequiel quiere que se pueda escanear la cédula y
   los rif. los cuales tienen un formato siempre igual, y que, con inteligencia
   artificial, se pueda extraer todos los datos del empleado a partir de su cédula
   y todos los datos de la empresa a partir de su rif.
8. Con respecto a la información de la empresa, nos faltan cosas como el el logo y
   cosas que tiene Adempiere, que no tenemos nosotros.
