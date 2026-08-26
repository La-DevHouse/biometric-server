import { NextResponse } from "next/server";
import { getOperation } from "@/lib/operations";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opId = Number(id);
  if (!Number.isFinite(opId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const op = await getOperation(opId);
  if (!op) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  return NextResponse.json(op);
}
