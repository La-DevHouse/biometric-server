# Requerimientos — Fase 1: Plataforma de Control de Asistencia (Grupo ALCO)

Fuente: propuesta comercial "Plataforma de Control de Asistencia" (La Devhouse → Grupo ALCO, 24/ago/2026). Este documento resume el alcance contractual de Fase 1; es la referencia de negocio contra la que se valida el desarrollo.

## Contexto del cliente

Grupo ALCO presta servicios de RRHH a ~40 empresas cliente. Hoy opera con dos sistemas desconectados: uno de acceso limitado a los biométricos (consulta de marcajes), y otro para nómina/contratos, con extracción manual de reportes entre ambos. Fase 1 reemplaza el primer sistema; la unificación completa con nómina es una fase posterior, fuera de este alcance.

## Alcance de Fase 1

**Gestión remota de dispositivos**

- Acceso completo a los biométricos desde cualquier lugar (no requiere estar en la sede del cliente).
- Alta, identificación y asignación de cada dispositivo a su empresa cliente.
- Sincronización de marcajes con registro de última sincronización exitosa por equipo.
- Panel de estado: qué dispositivos responden y cuáles requieren atención.

**Empresas cliente y empleados**

- Ficha de cada empresa cliente de ALCO, con sus dispositivos asociados.
- Ficha de empleado vinculada a su identificador biométrico.
- Categorización configurable (cargo, departamento, tipo de jornada, etc.).
- Altas, bajas y traslados de empleados entre empresas/categorías.

**Procesamiento de asistencia**

- Horarios y turnos por empresa cliente (diurnos y nocturnos).
- Determinación automática de asistencia, tardanzas, salidas anticipadas y ausencias contra el horario asignado.
- Totalización de horas trabajadas y horas por encima de la jornada, como dato de referencia — **sin aplicar recargos legales** (eso se hace en el sistema de nómina del cliente).
- Corrección manual de marcajes, con registro auditable de quién ajustó y cuándo.

**Reportes y exportación**

- Reportes por empresa, empleado y rango de fechas.
- Consolidado del período (días trabajados, horas totales, tardanzas, ausencias, horas extra de referencia) listo como insumo de nómina.
- Reporte de incidencias del período.
- Exportación a hoja de cálculo con la estructura que ALCO necesite para cargar a su sistema de nómina actual.

**Plataforma y accesos**

- Web app responsive (computadora, tablet, teléfono).
- 4 usuarios de Grupo ALCO, con control de acceso por perfil.
- Registro de auditoría de acciones sensibles.

## Explícitamente fuera de Fase 1

- Cálculo de horas extra con recargos legales, bono nocturno, feriados, días de descanso (la plataforma entrega horas totales; la valoración monetaria se hace en el sistema de nómina actual del cliente).
- Generación de nóminas, recibos de pago, prestaciones sociales.
- Contratos de trabajo, cartas de despido, documentación laboral.
- Acceso al sistema para las empresas cliente de ALCO o sus empleados — **solo los 4 usuarios internos de ALCO tienen acceso**.
- App móvil nativa (solo web responsive).
- Integraciones con bancos, entes gubernamentales, sistemas contables de terceros.
- Migración de histórico de asistencia de los sistemas actuales (salvo trabajo adicional acordado).
- Enrolamiento presencial de huellas o instalación física de dispositivos.
- Intervención del sistema actual de nómina/contratos.

## Plan de hitos (referencia, ~6 semanas)

| Hito | Entregable                                                                                 | Semana |
| ---- | ------------------------------------------------------------------------------------------ | ------ |
| 1    | Arranque, descubrimiento, modelo de datos definido                                         | 1      |
| 2    | Infraestructura en producción; motor de comunicación con biométricos (sync + estado)       | 2–3    |
| 3    | Administración de empresas/empleados (fichas, categorización, vínculo biométrico)          | 4      |
| 4    | Motor de horarios/turnos, asistencia, totalización, corrección manual auditada             | 5      |
| 5    | Reportes, exportación, pruebas con dispositivos reales, capacitación, puesta en producción | 6      |

## Supuestos contractuales relevantes para el desarrollo

- Grupo ALCO define horarios, tolerancias y criterios de asistencia — la plataforma aplica esas reglas, no valora legalmente las horas.
- Los dispositivos deben ser alcanzables por red desde la plataforma; la conectividad en cada sede corre por cuenta de esa empresa cliente. Caídas de servicio en una sede afectan solo la sincronización de ese dispositivo.
- Infraestructura (dominio, servidor, hosting) corre por cuenta de Grupo ALCO — sin mensualidad de mantenimiento incluida en este pago único.
- El núcleo del software es propiedad de La Devhouse (reutilizable/licenciable a otros clientes); los datos operativos y personalizaciones exclusivas del flujo de ALCO son propiedad de ALCO. Licencia de uso permanente para ALCO, sin pagos recurrentes por licencia.
- Posterior a Fase 1: soporte, mejoras e incidencias se cotizan aparte — actualmente en negociación un retainer (~$10/dispositivo/mes, ~20 dispositivos activos, con ~100 adicionales listos para desplegar y expectativa de crecimiento a "miles" a futuro).
