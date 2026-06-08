import { NextResponse } from "next/server";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The refine bridge runs under the user's Node + has filesystem access to the
// Obsidian vault and memory files. We shell out to the daemon CLI rather than
// re-implement Claude/Obsidian/memory reads in Node — same pattern as sends.
const PY = "/usr/bin/python3";
const CLI = "/Users/bryan.seto/.hermes/profiles/bryan/daemons/refine_followup_cli.py";
const NODE_BIN = "/Users/bryan.seto/.nvm/versions/node/v24.13.1/bin";

type RefineBody = {
  handle?: string;
  prior_draft?: string;
  instruction?: string;
  useObsidian?: boolean;
  useMemory?: boolean;
};

function runCli(args: string[], timeoutMs = 60000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(PY, [CLI, ...args], {
      env: { ...process.env, HOME: "/Users/bryan.seto", PATH: `${NODE_BIN}:${process.env.PATH ?? ""}` },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, out, err: err + "\n[timeout]" });
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out, err });
    });
  });
}

export async function POST(request: Request) {
  let body: RefineBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad JSON body" }, { status: 400 });
  }
  const handle = (body.handle || "").trim();
  if (!handle) {
    return NextResponse.json({ ok: false, error: "missing handle" }, { status: 400 });
  }

  const args = ["--handle", handle];
  if (body.prior_draft && body.prior_draft.trim()) {
    args.push("--prior-draft", body.prior_draft.trim());
  }
  if (body.instruction && body.instruction.trim()) {
    args.push("--instruction", body.instruction.trim());
  }
  if (body.useObsidian === false) args.push("--no-obsidian");
  if (body.useMemory === false) args.push("--no-memory");

  const { code, out, err } = await runCli(args);
  if (code !== 0 && !out.trim()) {
    return NextResponse.json(
      { ok: false, error: `refine failed (exit ${code})`, detail: err.slice(-400) },
      { status: 500 }
    );
  }
  try {
    // CLI prints one JSON line on stdout.
    const line = out.trim().split("\n").filter(Boolean).pop() || "{}";
    const parsed = JSON.parse(line);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json(
      { ok: false, error: "could not parse refine output", detail: out.slice(-400) },
      { status: 500 }
    );
  }
}
