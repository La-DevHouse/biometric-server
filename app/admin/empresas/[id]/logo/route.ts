import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/** Sniff de MIME por magic bytes — el logo se guarda sin tipo (client_company.logo bytea). */
function sniffMime(buf: Buffer): string {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  const head = buf.toString("utf8", 0, 256).trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return new NextResponse(null, { status: 400 });

  const row = await prisma.client_company.findUnique({
    where: { id },
    select: { logo: true },
  });
  if (!row?.logo) return new NextResponse(null, { status: 404 });

  const buf = Buffer.from(row.logo);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": sniffMime(buf),
      "Cache-Control": "private, max-age=60",
    },
  });
}
