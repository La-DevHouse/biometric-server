import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { allow } from "@/lib/access";
import { sniffImageMime } from "@/lib/imageSniff";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = Number((await params).id);
  if (!Number.isFinite(id) || !(await allow({ company: id })).ok) return new NextResponse("No encontrado.", { status: 404 });
  if (!Number.isFinite(id)) return new NextResponse(null, { status: 400 });

  const row = await prisma.client_company.findUnique({
    where: { id },
    select: { logo: true },
  });
  if (!row?.logo) return new NextResponse(null, { status: 404 });

  const buf = Buffer.from(row.logo);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": sniffImageMime(buf),
      "Cache-Control": "private, max-age=60",
    },
  });
}
