import { NextResponse } from "next/server";
import { listTrackedOperations } from "@/lib/operations";

export async function GET() {
  const operations = await listTrackedOperations();
  return NextResponse.json(operations);
}
