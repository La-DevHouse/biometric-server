# Ventana: Organización (= Empresa Cliente)

**Ruta:** Gestión del Sistema → Reglas de la Organización → Organización
**Confirmado por ALCO:** esta ventana modela cada empresa cliente.

## Estructura observada

Jerárquica, no plana. Nodo raíz implícito = `Grupo Alco` (el propio ALCO, como
"Compañía" — ver campo abajo). Debajo, cada empresa cliente es un nodo; algunos
nodos son a su vez padres de otros (grupos empresariales con varias razones
sociales), otros son hoja directa.

Ejemplo real visto en captura:

```
Grupo Alco (compañía)
├─ UNIDAD EDUCATIVA COLEGIO ILUSTRE
├─ AMERICANO BARQUISIMETO C.A
├─ ...
├─ GRUPO PERFUMES FACTORY
│  └─ (colapsado en la captura, no expandido)
├─ GRUPO FARMALIDO, C.A.
│  ├─ FARMALYDO, C.A.               ← registro abierto en la captura
│  ├─ FARMACIA FARMALYDO LA GOAJIRA, C.A.
│  ├─ FARMALYDO ACARIGUA, C.A.
│  ├─ FARMACIA FARMALYDO LAS LAGRIMAS, C.A.
│  └─ FARMACIA FARMALYDO DEL ESTE, C.A.
├─ INVERSIONES ORION, C.A.
├─ GRUPO KALEDA / POTUSALUD
├─ ...
```

**Total visible en el contador de paginación de la captura: 25/32** — hay
~32 organizaciones en total (no necesariamente 32 = 40 empresas cliente
mencionadas en la propuesta comercial; puede incluir grupos padre que no
cuentan como cliente individual, o el conteo puede no estar actualizado desde
la propuesta). Confirmar el número real con ALCO al momento de definir el
modelo de datos.

## Campos observados (registro: FARMALYDO, C.A.)

| Campo en pantalla  | Valor de ejemplo         | Tipo aparente          | Notas                                                                                                                                                                                              |
| ------------------ | ------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compañía           | `Grupo Alco`             | Dropdown, fijo         | Tenant raíz — siempre "Grupo Alco" en todos los registros, no varía por empresa cliente                                                                                                            |
| Código             | `J501438285`             | Texto                  | Formato de RIF venezolano (`J` + 9 dígitos). Confirmar si es el RIF real de la empresa cliente o un código interno de Adempiere                                                                    |
| Nombre             | `FARMALYDO, C.A.`        | Texto, requerido (`*`) | Razón social                                                                                                                                                                                       |
| Descripción        | `GRUPO FARMALYDO`        | Texto                  | En este caso coincide casi con el nombre del grupo padre — no está claro si esto se usa consistentemente o es libre                                                                                |
| Activo             | ✅ (checkbox)            | Boolean                | Probable soft-delete / empresa dada de baja vs. activa                                                                                                                                             |
| Entidad Acumulada  | ☐ (checkbox, sin marcar) | Boolean                | **?** — nombre no autoexplicativo. Podría indicar si esta organización es un "grupo contenedor" (no opera directamente, solo agrupa hijos) vs. una empresa operativa real. Marcar en cuestionario. |
| Organización Padre | `GRUPO FARMALIDO, C.A.`  | Dropdown               | Confirma la jerarquía — este campo es lo que arma el árbol                                                                                                                                         |

## Tab 2: "Información de Empresa"

### Sección "General"

| Campo                  | Valor de ejemplo      | Notas                                                                                                              |
| ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Compañía               | `Grupo Alco`          | Igual que en tab 1                                                                                                 |
| Organización           | `FARMALYDO, C.A.`     | Igual que "Nombre" en tab 1                                                                                        |
| Número Identificación  | `J501438285`          | **Mismo valor que "Código" del tab 1** — confirma que es el RIF fiscal, mostrado en dos lugares del mismo registro |
| Localización/Dirección | (vacío en la captura) | Dirección física de la empresa                                                                                     |
| Logo                   | (vacío en la captura) | Imagen                                                                                                             |

### Sección "Talento Humano (Venezuela)" — mayormente fuera de alcance de Fase 1

Campos de nómina y seguridad social venezolana (NIL, Número de Prestaciones,
SSO, RPE, INCES, FAOV, BANAVIH, aportes/deducciones). El PDF de propuesta
excluye explícitamente cálculo de nómina y recargos legales de Fase 1 — **no
llevar estos campos al modelo de datos nuevo**, salvo que surja una razón
puntual.

Dos campos de esta sección sí son relevantes:

| Campo                                                       | Notas                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Administrador (Dispositivo de Asistencia)**               | Adempiere ya modela, por empresa, quién administra sus dispositivos biométricos. **⚠️ Ver nota de alcance más abajo — esto puede chocar con lo contratado en Fase 1.**                                                                                                                                                                                                                                                                                 |
| **Super Usuario (Dispositivo de Asistencia)**               | Rol adicional, distinto de "Administrador" — confirmar la diferencia entre ambos con ALCO.                                                                                                                                                                                                                                                                                                                                                             |
| **Empleados Compartidos** (checkbox, marcado en el ejemplo) | **Confirmado con caso de uso real (29/ago):** un empleado asignado a una organización hija puede "bloquear la huella" en otra organización hija del mismo padre, sin necesidad de agregarlo como empleado completo en esa segunda organización. Implica que la relación empleado↔empresa no es estrictamente 1:1 — hace falta permitir esta acción puntual entre organizaciones hermanas del mismo grupo padre, sin duplicar el registro del empleado. |

### ⚠️ Nota de alcance: admin/super-usuario por empresa — posible conflicto contractual

El 29/ago se indicó que "cada empresa, tanto padre como hija, tiene que tener
su administrador seleccionable por empresa" — con capacidad de ingresar al
admin del dispositivo biométrico en cada sede, por razones geográficas
(ALCO no puede ser el único con acceso). El rol debe poder asignarse,
revocarse y eliminarse.

**Esto choca, al menos en apariencia, con `01-requirements.md`**, que
excluye explícitamente de Fase 1 el "acceso al sistema para las empresas
cliente de Grupo ALCO o para sus empleados", y limita el alcance a
"usuarios para el equipo de Grupo ALCO (4 personas)".

**Sin resolver — dos interpretaciones posibles, pendiente de confirmación:**

- (a) Administración física del dispositivo, en el equipo mismo (sin pasar
  por la plataforma web nueva) — no contradice el alcance de Fase 1.
- (b) Un usuario/rol dentro de la plataforma nueva, con acceso limitado a su
  propia empresa — sí es una ampliación real de alcance respecto a lo
  firmado en el PDF, y debe tratarse como decisión de negocio explícita
  (presupuesto/cronograma), no como detalle de UX a resolver en el camino.

No documentar esto como requisito confirmado hasta que se aclare cuál de
las dos opciones es.

## Preguntas abiertas (→ `cuestionario-alco.md`)

1. ¿Qué significa exactamente "Entidad Acumulada"? ¿Marca organizaciones que son solo agrupadoras (no tienen empleados/dispositivos propios) vs. las que sí operan?
2. La jerarquía padre/hijo — ¿el sistema nuevo necesita replicarla (empresa madre + sucursales), o para efectos de asistencia/biométricos cada nodo (tenga hijos o no) se trata como una "empresa cliente" independiente, plana?
3. El campo "Código" (`J501438285`) — ¿es el RIF fiscal real de la empresa, y se necesita como campo obligatorio en el sistema nuevo (por ejemplo, para la exportación a nómina)?
4. El total de organizaciones (~32 visibles) vs. las "~40 empresas cliente" que menciona la propuesta comercial — ¿a qué se debe la diferencia? ¿Hay clientes que no están cargados en Adempiere todavía, o el número de la propuesta era aproximado?

## Pendiente para completar esta vista

- Exportar la grilla completa a CSV (`exports/empresas.csv`) para tener el listado completo de las ~32 organizaciones con estos mismos campos.
- Confirmar si hay más campos en la ficha que no se ven en este screenshot (¿hay más tabs/secciones además de "Información de Empresa"? La captura muestra solo un tab activo a la izquierda).
- Confirmar respuestas a las preguntas abiertas de arriba con ALCO.
