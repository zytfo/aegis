import { NextResponse } from "next/server";
import { buildMessages, parseDecision, resolvePayment, mapSignerResponse, POISONED_PAGE, VENDORS, type Verdict } from "@/lib/agent";
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

// Local narration helpers (never leak secrets — only payee/amount, which the UI shows anyway).
function shortHash(h: string): string {
  const bare = h.replace(/^(account-hash-|hash-|uref-)/, "");
  return bare.length > 16 ? `${bare.slice(0, 8)}…${bare.slice(-6)}` : bare;
}
function cspr(motes: string): string {
  try {
    return (Number(BigInt(motes)) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 });
  } catch {
    return "—";
  }
}

export async function POST(req: Request) {
  // Rate limit + bad-body stay NON-streamed early returns (plain JSON), before the stream.
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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const log = (text: string) => emit({ type: "log", text });
      const wait = (msShort: number) => new Promise((r) => setTimeout(r, msShort));

      try {
        // 1) LLM decision (JSON mode).
        log("🧠 Thinking — asking the agent (LLM)…");
        await wait(320);

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
          if (!r.ok) {
            log("⚠ agent backend error");
            emit({ type: "result", error: "agent backend error" });
            controller.close();
            return;
          }
          const data = await r.json();
          content = data?.choices?.[0]?.message?.content ?? "";
        } catch {
          log("⚠ agent backend error");
          emit({ type: "result", error: "agent backend error" });
          controller.close();
          return;
        }

        const decision = parseDecision(content);

        // When poisoned, show the untrusted page the agent read (the hidden malicious instruction).
        if (poisoned) {
          emit({ type: "page", text: POISONED_PAGE });
          await wait(300);
        }

        log("🧠 Agent decided: " + decision.message);
        await wait(320);

        const payment = resolvePayment(decision);
        if (!payment) {
          emit({ type: "result", agentReply: decision.message });
          controller.close();
          return;
        }

        // Is the resolved payee one of the user's saved vendor addresses? If not, the
        // agent has been steered to a new account (e.g. by the injected page) — say so
        // out loud so the chat explains the attack instead of silently forwarding it.
        const knownVendor = Object.values(VENDORS).some((v) => v.payee === payment.payee);

        log("→ The agent is asking to pay " + shortHash(payment.payee) + " · " + cspr(payment.amountMotes) + " CSPR.");
        await wait(300);
        if (!knownVendor) {
          log(
            "⚠ That account is NOT one of your saved vendors" +
              (poisoned ? " — it came from the untrusted page the agent just read" : "") +
              ". The agent was steered to a new address; forwarding to the Pi Signer anyway.",
          );
          await wait(320);
        }
        log("→ Pi Signer: checking the intent against on-device policy (allowlist · per-tx cap · spend window) before the key is ever touched…");
        await wait(340);

        // 2) Route the payment through the Pi Signer — the guard decides.
        let verdict: Verdict;
        try {
          const r = await fetch(`${SIGNER_URL}/sign-intent`, {
            method: "POST",

            headers: { "content-type": "application/json", authorization: `Bearer ${SIGNER_TOKEN}`, "ngrok-skip-browser-warning": "true" },
            body: JSON.stringify({ payee: payment.payee, amountMotes: payment.amountMotes, seq: nextSeq() }),
            signal: AbortSignal.timeout(200_000),
          });
          const body = await r.json().catch(() => ({}));
          verdict = mapSignerResponse(r.status, body);
        } catch {
          verdict = { kind: "unreachable" };
        }

        // Verdict-aware narration: spell out WHAT the Pi did and WHY, so a "blocked"
        // result reads as the security win it is — not an ambiguous "responded".
        let outcome: string;
        switch (verdict.kind) {
          case "blocked":
            outcome = "🛑 Pi Signer REFUSED to sign — " + verdict.reason + ". The device key was never used and no CSPR left the treasury.";
            break;
          case "paid":
            outcome = "✓ Pi Signer approved it, signed on-device, and broadcast the transaction on-chain.";
            break;
          case "pending":
            outcome = "✓ Pi Signer signed it; the transaction is now pending on-chain.";
            break;
          case "unreachable":
            outcome = "⚠ Pi Signer didn't respond — is the device online?";
            break;
          default:
            outcome = "⚠ Pi Signer error: " + verdict.reason + ".";
            break;
        }
        log("← " + outcome);
        await wait(300);
        emit({
          type: "result",
          agentReply: decision.message,
          action: { payee: payment.payee, amountMotes: payment.amountMotes },
          verdict,
        });
        controller.close();
      } catch {
        try {
          emit({ type: "result", error: "agent error" });
        } catch {
          /* controller may already be closed */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
