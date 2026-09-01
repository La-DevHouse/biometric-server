// Registro de auditoría de acciones sensibles (docs/07 §1.14). Aunque en Fase 1
// no hay matriz de permisos, sí se registra QUIÉN hizo qué.
import { prisma } from "@/lib/db";

/** JSON-safe: Date -> ISO string, Decimal -> string, quita undefined. */
function plain(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as object;
}

export async function writeAudit(params: {
  actorId: number | null;
  action: string; // ej. "company.create", "company.deactivate", "site.update"
  entityType: string;
  entityId: string | number | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await prisma.audit_log.create({
    data: {
      actor_app_user_id: params.actorId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId != null ? String(params.entityId) : null,
      before_json: plain(params.before),
      after_json: plain(params.after),
    },
  });
}
