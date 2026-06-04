import { NextResponse } from "next/server";
import { sendViaDaemon } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { handle?: string; sent_text?: string; queue?: "followup" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", detail: "bad JSON body" }, { status: 400 });
  }
  const handle = (body.handle || "").trim();
  const sentText = body.sent_text ?? "";
  if (!handle) {
    return NextResponse.json({ status: "error", detail: "missing handle" }, { status: 400 });
  }
  const result = await sendViaDaemon(handle, sentText, { queue: body.queue });
  return NextResponse.json(result);
}
