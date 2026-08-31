import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listTrackedOperations } from "@/lib/operations";

export async function GET() {
  if (!(await getSessionUser())) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  const operations = await listTrackedOperations();
  return NextResponse.json(operations);
}
