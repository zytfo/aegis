import { NextResponse } from "next/server";
import { buildMessages, parseDecision, resolvePayment, mapSignerResponse, POISONED_PAGE } from "@/lib/agent";
import { checkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const SIGNER_URL = (process.env.SIGNER_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const SIGNER_TOKEN = process.env.SIGNER_TOKEN ?? "";

// Strictly-increasing, ms-scale seq (never backwards, never far above real time) so it
// stays compatible with the other paths hitting the same signer.
let lastSeq = 0;
function nextSeq(): number {
  lastSeq = Math.max(Date.now(), lastSeq + 1);
  return lastSeq;
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!checkRateLimit(ip).ok) {
    return NextResponse.json({ error: "Too many requests — slow down and try again shortly." }, { status: 429 });
  }

  let message = "";
  let poisoned = false;
  try {
    const b = await req.json();
    message = String(b?.message ?? "");
    poisoned = Boolean(b?.poisoned);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!message.trim() && !poisoned) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }
  // When poisoned, echo the untrusted page back so the UI can SHOW what the agent read
  // (the hidden malicious instruction) — makes the injection visible in the demo.
  const injectedPage = poisoned ? POISONED_PAGE : undefined;

  // 1) LLM decision (JSON mode).
  let content = "";
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 300,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: buildMessages(message, poisoned),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return NextResponse.json({ error: "agent backend error" }, { status: 502 });
    const data = await r.json();
    content = data?.choices?.[0]?.message?.content ?? "";
  } catch {
    return NextResponse.json({ error: "agent backend unreachable" }, { status: 502 });
  }

  const decision = parseDecision(content);
  const payment = resolvePayment(decision);
  if (!payment) return NextResponse.json({ agentReply: decision.message, injectedPage });

  // 2) Route the payment through the Pi Signer — the guard decides.
  try {
    const r = await fetch(`${SIGNER_URL}/sign-intent`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SIGNER_TOKEN}` },
      body: JSON.stringify({ payee: payment.payee, amountMotes: payment.amountMotes, seq: nextSeq() }),
      signal: AbortSignal.timeout(200_000),
    });
    const body = await r.json().catch(() => ({}));
    return NextResponse.json({
      agentReply: decision.message,
      action: { payee: payment.payee, amountMotes: payment.amountMotes },
      verdict: mapSignerResponse(r.status, body),
      injectedPage,
    });
  } catch {
    return NextResponse.json({
      agentReply: decision.message,
      action: { payee: payment.payee, amountMotes: payment.amountMotes },
      verdict: { kind: "unreachable" },
      injectedPage,
    });
  }
}
