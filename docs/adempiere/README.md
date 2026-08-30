# Relevamiento de Adempiere — kit de trabajo

Objetivo: capturar cómo se ve y qué hace el sistema legacy que ALCO usa hoy para
biométricos/asistencia, para convertirlo en `docs/07-admin-ux-spec.md` (spec de
vistas/acciones/flujos) y de ahí en `docs/08-data-model.md` (schema Postgres).

**Adempiere es solo referencia.** El sistema nuevo no se integra con él. No hace
falta que entiendas el ERP entero — solo las pantallas que ALCO toca para:
dispositivos, empresas cliente, empleados, categorías, horarios/turnos,
marcajes/asistencia, incidencias, reportes y exportación a nómina.

## Qué entregar (en este orden)

1. **`_menu-map.md`** — expandí el árbol de menú de Adempiere y listá solo las
   ventanas relevantes. Plantilla adentro del archivo.

2. **`exports/*.csv`** — en cada lista/grilla importante, botón **Export → CSV**
   (o XLS). No hace falta que entiendas los datos: los encabezados del CSV son
   los nombres reales de los campos, y eso es lo que necesito. Mínimo:
   - `empresas.csv` — lista de empresas cliente
   - `empleados.csv` — lista de empleados (una empresa alcanza como muestra)
   - `categorias.csv` — cargos / departamentos / tipos de jornada (lo que exista)
   - `horarios.csv` — horarios / turnos
   - `dispositivos.csv` — equipos biométricos
   - `marcajes.csv` — muestra de marcajes (un día o una semana)
   - `incidencias.csv` — muestra de incidencias/novedades si existe esa pantalla

3. **`exports/nomina-actual.xlsx`** (o `.csv`) — **el archivo real que ALCO
   genera hoy y carga a su sistema de nómina.** Este define exactamente las
   columnas del export que hay que construir en Hito 5. Si hay varios formatos,
   traé uno de cada uno.

4. **`views/<ventana>.md`** — uno por cada ventana relevante del `_menu-map.md`.
   Copiá `views/_template.md` y rellenalo. Es lo más lento; priorizá:
   empleados, empresas, corrección de marcaje, y la pantalla de reportes.

5. **`screenshots/`** — capturas de pantalla donde el layout o el comportamiento
   importa más que la lista de campos: corrección manual de marcaje, pantallas
   de parámetros de reporte, cualquier asistente de varios pasos. Nombralas
   descriptivo (`correccion-marcaje-01.png`).

6. **`cuestionario-alco.md`** — preguntas que Adempiere no responde solo.
   Respondelas vos si sabés, o pasáselas a ALCO.

## Atajos para llenar las plantillas más rápido

- **Nombre técnico de un campo:** clic derecho sobre el campo → "Ayuda" / "Zoom",
  o pasá el mouse por encima. Adempiere muestra el nombre de columna y su
  descripción. No es obligatorio, pero si aparece fácil, anotalo.
- **Si tu usuario tiene rol "System Administrator":** abrí la ventana
  **"Window, Tab & Field"** (Diccionario de aplicación). Ahí está toda la
  estructura de ventanas/pestañas/campos y podés exportar la grilla a CSV →
  ponela en `exports/dictionary-*.csv` y te podés saltar buena parte de los
  `views/<ventana>.md`. Si no tenés ese rol, se hace a mano con la plantilla.
- No inventes ni completes de más. "No sé" / "no aplica" es una respuesta válida
  y útil.
