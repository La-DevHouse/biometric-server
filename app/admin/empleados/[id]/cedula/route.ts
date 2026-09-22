import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { sniffImageMime } from "@/lib/imageSniff";

/** Sirve la foto de la cédula escaneada de un empleado (docs/09 §3.10). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return new NextResponse(null, { status: 400 });

  const row = await prisma.employee.findUnique({
    where: { id },
    select: { cedula_photo: true },
  });
  if (!row?.cedula_photo) return new NextResponse(null, { status: 404 });

  const buf = Buffer.from(row.cedula_photo);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": sniffImageMime(buf),
      "Cache-Control": "private, max-age=60",
    },
  });
}
