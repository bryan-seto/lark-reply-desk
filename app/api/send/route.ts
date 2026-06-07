import { NextResponse } from "next/server";
import { sendViaDaemon, unflagViaDaemon } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: {
    handle?: string;
    sent_text?: string;
    queue?: "followup";
    action?: "send" | "unflag";
    note?: string;
    link?: { chat_id: string; chat_name: string };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", detail: "bad JSON body" }, { status: 400 });
  }
  const handle = (body.handle || "").trim();
  if (!handle) {
    return NextResponse.json({ status: "error", detail: "missing handle" }, { status: 400 });
  }

  // Unflag is a separate, explicit action — it removes the Lark bookmark and
  // optionally records a cross-reference link. Never triggered by a normal send.
  if (body.action === "unflag") {
    const result = await unflagViaDaemon(handle, { note: body.note, link: body.link });
    return NextResponse.json(result);
  }

  const sentText = body.sent_text ?? "";
  const result = await sendViaDaemon(handle, sentText, { queue: body.queue });
  return NextResponse.json(result);
}
