import { NextResponse } from "next/server";
import { getAccess, scopedDevIds } from "@/lib/access";
import { getOperation } from "@/lib/operations";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!access) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const opId = Number(id);
  if (!Number.isFinite(opId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const op = await getOperation(opId);
  const devIds = op ? await scopedDevIds(access) : null;
  if (!op || (devIds !== null && !devIds.includes(op.dev_id)))
    return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  return NextResponse.json(op);
}
