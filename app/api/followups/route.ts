import { NextResponse } from "next/server";
import { readFollowups } from "@/lib/followups";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawStatus = searchParams.get("status") ?? "pending";
  const status =
    rawStatus === "sent" ? "sent" : rawStatus === "parked" ? "parked" : "pending";
  try {
    const rows = await readFollowups(status);
    return NextResponse.json(rows);
  } catch {
    // Never 500 on a read — an empty/absent queue is a normal state.
    return NextResponse.json([]);
  }
}
