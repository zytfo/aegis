"use client";

import { useCallback, useState } from "react";

const EXPLORER = "https://testnet.cspr.live/transaction/";
const MOTES = 1_000_000_000;

type Verdict =
  | { kind: "paid"; hash?: string }
  | { kind: "pending"; hash?: string }
  | { kind: "blocked"; reason: string }
  | { kind: "unreachable" }
  | { kind: "error"; reason: string };

interface Msg {
  who: "you" | "agent" | "page" | "status";
  text: string;
  action?: { payee: string; amountMotes: string };
  verdict?: Verdict;
}

function shortHash(h?: string): string {
  if (!h) return "";
  const bare = h.replace(/^(account-hash-|hash-)/, "");
  return bare.length > 16 ? `${bare.slice(0, 8)}…${bare.slice(-6)}` : bare;
}
function cspr(motes?: string): string {
  if (!motes) return "—";
  try {
    return `${(Number(BigInt(motes)) / MOTES).toLocaleString(undefined, { maximumFractionDigits: 4 })} CSPR`;
  } catch {
    return "—";
  }
}

export default function AgentChatPanel({ onSettled }: { onSettled?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = useCallback(
    async (text: string, poisoned: boolean) => {
      if (busy) return;
      setErr(null);
      setBusy(true);
      setMsgs((m) => [...m, { who: "you", text: poisoned ? "🌐 [agent reads an untrusted web page, then handles my Data API subscription]" : text }]);
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, poisoned }),
        });
        // Rate limit / bad-body stay non-stream JSON.
        if (res.status === 429) {
          const body = await res.json().catch(() => ({}));
          setErr(body.error ?? "rate limited");
          return;
        }
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          setErr(body.error ?? `error ${res.status}`);
          return;
        }

        // Stream NDJSON status lines and render each as it arrives.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const chunk = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!chunk) continue;
            let msg: { type?: string; text?: string; error?: string; agentReply?: string; action?: { payee: string; amountMotes: string }; verdict?: Verdict };
            try {
              msg = JSON.parse(chunk);
            } catch {
              continue;
            }
            if (msg.type === "log") {
              setMsgs((m) => [...m, { who: "status", text: msg.text ?? "" }]);
            } else if (msg.type === "page") {
              setMsgs((m) => [...m, { who: "page", text: msg.text ?? "" }]);
            } else if (msg.type === "result") {
              if (msg.error) {
                setErr(msg.error);
              } else {
                setMsgs((m) => [...m, { who: "agent", text: msg.agentReply ?? "(no reply)", action: msg.action, verdict: msg.verdict }]);
                if (msg.verdict?.kind === "paid") onSettled?.();
              }
            }
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, onSettled],
  );

  return (
    <section className="panel full demo">
      <div className="panel-head">
        <h2>💬 Talk to the agent (live)</h2>
        <span className="count">a real LLM · the Pi Signer enforces every payment</span>
      </div>
      <div className="panel-body">
        <p className="note">
          Ask the agent to pay one of your subscriptions — <strong>Data API</strong> or{" "}
          <strong>Cloud Storage</strong> (use the buttons below, or type it). It really pays on testnet,
          through the Pi, under policy. Then hit <strong>Read untrusted page</strong>: the agent fetches a
          fake &quot;billing notice&quot; that secretly tells it to pay an <em>attacker</em> instead — you&apos;ll
          see the page, watch the agent get fooled, and the guardian block the payment on-chain (no funds move).
        </p>

        {msgs.length > 0 && (
          <div className="terminal" role="log" aria-live="polite">
            {msgs.map((m, i) =>
              m.who === "page" ? (
                <div
                  className="term-line"
                  key={i}
                  style={{ borderLeft: "2px solid var(--red)", paddingLeft: 8, opacity: 0.92, whiteSpace: "pre-wrap" }}
                >
                  <strong style={{ color: "var(--red)" }}>📄 untrusted page the agent fetched (note the hidden instruction):</strong>
                  {"\n" + m.text}
                </div>
              ) : m.who === "status" ? (
                <div
                  className="term-line"
                  key={i}
                  style={{ opacity: 0.6, fontStyle: "italic", fontSize: 12.5, fontFamily: "var(--mono)" }}
                >
                  <span style={{ opacity: 0.6 }}>· </span>{m.text}
                </div>
              ) : (
              <div className="term-line" key={i}>
                <strong>{m.who === "you" ? "you" : "agent"}:</strong> {m.text}
                {m.action && (
                  <div style={{ opacity: 0.85, marginTop: 2 }}>
                    ↳ agent attempted: pay <span className="mono">{shortHash(m.action.payee)}</span> · {cspr(m.action.amountMotes)}
                  </div>
                )}
                {m.verdict && (
                  <div className="demo-result" style={{ marginTop: 4 }}>
                    {m.verdict.kind === "paid" ? (
                      <span className="result-badge ok">
                        ✓ Paid on-chain{m.verdict.hash ? (<> · <a href={`${EXPLORER}${m.verdict.hash}`} target="_blank" rel="noreferrer">{shortHash(m.verdict.hash)} ↗</a></>) : null}
                      </span>
                    ) : m.verdict.kind === "blocked" ? (
                      <span className="result-badge ok">🛑 Blocked — {m.verdict.reason} · the guardian held; the key was never touched</span>
                    ) : m.verdict.kind === "pending" ? (
                      <span className="result-badge warn">⏳ submitted — pending</span>
                    ) : (
                      <span className="result-badge warn">⚠ {m.verdict.kind === "unreachable" ? "signer unreachable" : m.verdict.reason}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="term-line caret">▌</div>}
          </div>
        )}

        <div className="demo-btns" style={{ marginTop: 12 }}>
          <span style={{ opacity: 0.7, fontSize: 12.5, alignSelf: "center" }}>Try a subscription:</span>
          <button className="demo-btn" disabled={busy} onClick={() => send("pay my Data API subscription", false)}>Pay Data API (1 CSPR)</button>
          <button className="demo-btn" disabled={busy} onClick={() => send("pay my Cloud Storage subscription", false)}>Pay Cloud Storage (2 CSPR)</button>
        </div>
        <div className="demo-btns" style={{ marginTop: 8 }}>
          <input
            type="text"
            value={input}
            placeholder="pay my Data API subscription"
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { send(input.trim(), false); setInput(""); } }}
            style={{ flex: 1, minWidth: 220, background: "var(--bg-2)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 13 }}
          />
          <button className="demo-btn" disabled={busy || !input.trim()} onClick={() => { send(input.trim(), false); setInput(""); }}>Send</button>
          <button className="demo-btn" disabled={busy} onClick={() => send("pay my Data API subscription", true)} title="Inject a hidden malicious instruction via a fake billing notice">🌐 Read untrusted page</button>
        </div>
        {err && <div className="demo-result"><span className="result-badge warn">⚠ {err}</span></div>}
      </div>
    </section>
  );
}
