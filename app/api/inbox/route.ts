import { NextResponse } from "next/server";
import { readQueue } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") === "sent" ? "sent" : "pending";
  try {
    const rows = await readQueue(status);
    return NextResponse.json(rows);
  } catch {
    // Never 500 on a read — an empty/absent queue is a normal state.
    return NextResponse.json([]);
  }
}
