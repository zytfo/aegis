"use client";

import { useCallback, useEffect, useState } from "react";

// --- types mirrored from the API routes ----------------------------------------
interface WalletState {
  balance: string;
  perTxMax: string;
  periodCap: string;
  spentInPeriod: string;
  periodStart: string;
  periodLen: string;
  owner: string;
  device: string;
  payees: string[];
  meta: { node: string; packageHash: string; contractHash: string; stateRootHash: string };
}

interface AuditEntry {
  ts: string;
  event: "approved" | "denied";
  payee?: string;
  amountMotes?: string;
  seq?: number;
  reason?: string;
  hash?: string;
  success?: boolean;
}

const POLL_MS = 5000;
const EXPLORER = "https://testnet.cspr.live/transaction/";

// --- formatting helpers ---------------------------------------------------------
function cspr(motes: string | undefined): string {
  if (!motes) return "—";
  const v = Number(BigInt(motes)) / 1e9;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 4 })} CSPR`;
}
function shortHash(h: string | undefined): string {
  if (!h) return "—";
  const bare = h.replace(/^(account-hash-|hash-|uref-)/, "");
  return bare.length > 16 ? `${bare.slice(0, 8)}…${bare.slice(-6)}` : bare;
}
function ms(n: string | undefined): string {
  if (!n) return "—";
  const v = Number(n);
  if (v % 3600000 === 0) return `${v / 3600000} h`;
  if (v % 60000 === 0) return `${v / 60000} min`;
  return `${v} ms`;
}
function periodReset(startMs: string, lenMs: string): string {
  const start = Number(startMs);
  const len = Number(lenMs);
  if (!start || !len) return "—";
  const end = start + len;
  const delta = end - Date.now();
  if (delta <= 0) return "resets on next pay";
  const mins = Math.floor(delta / 60000);
  const secs = Math.floor((delta % 60000) / 1000);
  return mins > 0 ? `resets in ~${mins}m ${secs}s` : `resets in ~${secs}s`;
}

export default function Page() {
  const [state, setState] = useState<WalletState | null>(null);
  const [stateErr, setStateErr] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [signerUp, setSignerUp] = useState<boolean>(false);
  const [lastTick, setLastTick] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) {
        setState(await r.json());
        setStateErr(null);
      } else {
        const body = await r.json().catch(() => ({}));
        setStateErr(body.detail ?? body.error ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setStateErr(e instanceof Error ? e.message : String(e));
    }
    try {
      const r = await fetch("/api/audit", { cache: "no-store" });
      const data: AuditEntry[] = r.ok ? await r.json() : [];
      setAudit(data);
      setSignerUp(data.length > 0);
    } catch {
      setAudit([]);
      setSignerUp(false);
    }
    setLastTick(Date.now());
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      clearInterval(clock);
    };
  }, [poll]);

  const denied = audit.filter((a) => a.event === "denied");
  const stale = lastTick > 0 && now - lastTick > POLL_MS * 3;

  const spent = state ? Number(BigInt(state.spentInPeriod)) : 0;
  const cap = state ? Number(BigInt(state.periodCap)) : 0;
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;

  return (
    <div className="shell">
      <div className="masthead">
        <div className="brand">
          <div className="sigil">⛨</div>
          <div>
            <h1>AEGIS</h1>
            <p className="tag">
              Hardware-rooted guardian for an autonomous AI payment agent · Casper testnet
            </p>
          </div>
        </div>
        <div className="live-meta">
          <div>
            <span className={`live-dot ${stateErr ? "down" : stale ? "stale" : ""}`} />
            {stateErr ? "node read failed" : stale ? "stale" : "live · casper-test"}
          </div>
          <div>contract {shortHash(state?.meta.packageHash)}</div>
          <div>signer {signerUp ? "online" : "offline"}</div>
        </div>
      </div>

      {stateErr && <div className="err-banner">on-chain read error: {stateErr}</div>}

      <div className="grid">
        {/* (a) Policy & identity */}
        <section className="panel">
          <div className="panel-head">
            <h2>Policy &amp; Identity</h2>
            <span className="count">who can spend · how much · when it resets</span>
          </div>
          <div className="panel-body">
            <div className="kv">
              <span className="k">Treasury (contract purse)</span>
              <span className="v amount">{cspr(state?.balance)}</span>
            </div>
            <div className="kv">
              <span className="k">Owner (can change policy)</span>
              <span className="v role-owner" title={state?.owner}>
                {shortHash(state?.owner)}
              </span>
            </div>
            <div className="kv">
              <span className="k">Device / Pi Signer (can only pay)</span>
              <span className="v" title={state?.device}>
                {shortHash(state?.device)}
              </span>
            </div>
            <div className="kv">
              <span className="k">Per-transaction max</span>
              <span className="v">{cspr(state?.perTxMax)}</span>
            </div>
            <div className="kv">
              <span className="k">Period cap</span>
              <span className="v">{cspr(state?.periodCap)}</span>
            </div>
            <div className="kv">
              <span className="k">Period length</span>
              <span className="v">{ms(state?.periodLen)}</span>
            </div>
            <div className="kv">
              <span className="k">Spent this period</span>
              <span className="v" style={{ color: "var(--green)" }}>
                {cspr(state?.spentInPeriod)}
              </span>
            </div>
            <div className={`meter ${pct > 80 ? "hot" : ""}`}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="meter-label">
              <span>
                {cspr(state?.spentInPeriod)} of {cspr(state?.periodCap)}
              </span>
              <span>{state ? periodReset(state.periodStart, state.periodLen) : "—"}</span>
            </div>
          </div>
        </section>

        {/* (b) Allowlist */}
        <section className="panel">
          <div className="panel-head">
            <h2>Allowlist</h2>
            <span className="count">{state ? `${state.payees.length} payee(s)` : "—"}</span>
          </div>
          <div className="panel-body">
            <p className="note">
              The only accounts the device key is permitted to pay. Enforced statically on the Pi
              <em> and</em> on-chain by the contract. Editable by the owner only.
            </p>
            {state && state.payees.length > 0 ? (
              state.payees.map((p) => (
                <div className="chip" key={p}>
                  <span className="ok">✓</span>
                  <span title={p}>{p}</span>
                </div>
              ))
            ) : (
              <div className="empty">{state ? "no payees on the allowlist" : "loading…"}</div>
            )}
          </div>
        </section>

        {/* (c) Payment history / audit */}
        <section className="panel full">
          <div className="panel-head">
            <h2>Payment History · Pi Signer Audit</h2>
            <span className="count">
              {audit.length} intent(s){signerUp ? "" : " · signer offline"}
            </span>
          </div>
          <div className="panel-body">
            {audit.length === 0 ? (
              <div className="empty">
                no audited intents yet — start the Pi Signer and run the brain to populate this log
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>seq</th>
                    <th>time</th>
                    <th>payee</th>
                    <th>amount</th>
                    <th>result</th>
                    <th>on-chain tx</th>
                  </tr>
                </thead>
                <tbody>
                  {audit
                    .slice()
                    .reverse()
                    .map((a, i) => (
                      <tr key={`${a.seq}-${a.ts}-${i}`}>
                        <td className="seqcell">{a.seq ?? "—"}</td>
                        <td className="mono" style={{ color: "var(--text-faint)" }}>
                          {new Date(a.ts).toLocaleTimeString()}
                        </td>
                        <td className="mono" title={a.payee}>
                          {shortHash(a.payee)}
                        </td>
                        <td className="mono">{cspr(a.amountMotes)}</td>
                        <td>
                          {a.event === "approved" && a.success ? (
                            <span className="pill approved">APPROVED</span>
                          ) : (
                            <span className="pill denied">
                              DENIED{a.reason ? ` · ${a.reason}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="mono">
                          {a.hash ? (
                            <a href={`${EXPLORER}${a.hash}`} target="_blank" rel="noreferrer">
                              {shortHash(a.hash)} ↗
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* (d) RED panel — denied intents */}
        <section className="panel danger full">
          <div className="panel-head">
            <h2>⛔ Blocked by the Guardian</h2>
            <span className="count">{denied.length} denial(s)</span>
          </div>
          <div className="panel-body">
            <p className="note">
              Intents the Pi Signer refused <strong>before the device key was ever touched</strong> —
              off-allowlist payees, over the per-tx cap, replays. A compromised brain can request
              these; it cannot get them signed.
            </p>
            {denied.length === 0 ? (
              <div className="empty">no denials recorded — the leash has not been tested yet</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>seq</th>
                    <th>attempted payee</th>
                    <th>amount</th>
                    <th>reason</th>
                  </tr>
                </thead>
                <tbody>
                  {denied
                    .slice()
                    .reverse()
                    .map((a, i) => (
                      <tr key={`d-${a.seq}-${a.ts}-${i}`}>
                        <td className="seqcell">{a.seq ?? "—"}</td>
                        <td className="mono" title={a.payee}>
                          {a.payee ? shortHash(a.payee) : "—"}
                        </td>
                        <td className="mono">{a.amountMotes ? cspr(a.amountMotes) : "—"}</td>
                        <td className="reason">{a.reason ?? "denied"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <footer>
        <div>
          Treasury lives in the <code className="inline">GuardedWallet</code> contract purse. The
          device account (Pi) holds only a small gas float. Off-policy withdrawal = 0; the device key
          can only emit <code className="inline">pay</code> to an allowlisted payee, bounded by per-tx
          and period caps.
        </div>
        <div style={{ marginTop: 8 }}>
          Polling every {POLL_MS / 1000}s · state read free from{" "}
          <code className="inline">{state?.meta.node ?? "node.testnet.casper.network"}</code> ·{" "}
          <a href="https://testnet.cspr.live/" target="_blank" rel="noreferrer">
            cspr.live testnet explorer
          </a>
        </div>
      </footer>
    </div>
  );
}
