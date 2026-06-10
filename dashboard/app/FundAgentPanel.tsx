"use client";

/**
 * FundAgentPanel — CLIENT COMPONENT. "Connect wallet -> fund the agent's treasury".
 *
 * Connects the Casper Wallet browser extension and deposits the visitor's own test
 * CSPR into the live GuardedWallet contract's payable `deposit` entry point. All the
 * wallet/sign/submit logic lives in lib/deposit.ts; this is the UI + state machine.
 *
 * The signing step happens in the extension popup and is human-driven — it cannot be
 * automated. Everything up to that point (build, JSON, connect) is exercised here.
 */
import { useCallback, useEffect, useState } from "react";
import {
  depositTx,
  nativeTopUp,
  signAndSubmit,
  fetchProxyBytes,
  getProvider,
  csprToMotes,
  type PackageHashEncoding,
} from "@/lib/deposit";

const EXPLORER = "https://testnet.cspr.live/transaction/";

// Flip this to "bytes" in one place if the node rejects the default "key" encoding
// of package_hash on the first deposit. See lib/deposit.ts packageHashArg().
const PACKAGE_HASH_ENCODING: PackageHashEncoding = "key";

function cspr(motes: string | undefined): string {
  if (!motes) return "—";
  const v = Number(BigInt(motes)) / 1e9;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 4 })} CSPR`;
}
function shortKey(h: string | null): string {
  if (!h) return "—";
  const bare = h.replace(/^(account-hash-|hash-|uref-)/, "");
  return bare.length > 16 ? `${bare.slice(0, 8)}…${bare.slice(-6)}` : bare;
}

type Phase = "idle" | "building" | "awaiting signature" | "submitted" | "confirmed" | "error";

export default function FundAgentPanel({
  treasuryBalance,
  deviceKey,
  onConfirmed,
}: {
  /** treasury balance in motes (from /api/state), so the user sees it rise */
  treasuryBalance?: string;
  /** device/owner account-hash for the fallback gas-float top-up label (display only) */
  deviceKey?: string;
  /** called after a confirmed tx so the parent can refresh /api/state */
  onConfirmed?: () => void;
}) {
  const [installed, setInstalled] = useState<boolean>(false);
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("5");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusDetail, setStatusDetail] = useState<string>("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackMode, setFallbackMode] = useState<boolean>(false);
  const [targetKey, setTargetKey] = useState<string>("");

  // Detect the injected extension provider (runtime-only global).
  useEffect(() => {
    const check = () => setInstalled(typeof window !== "undefined" && !!window.CasperWalletProvider);
    check();
    // The extension may inject after our first paint.
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const provider = getProvider();
      const ok = await provider.requestConnection();
      if (!ok) {
        setError("connection declined in the wallet");
        return;
      }
      const pk = await provider.getActivePublicKey();
      setPubKey(pk);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const busy = phase === "building" || phase === "awaiting signature" || phase === "submitted";

  const submit = useCallback(async () => {
    if (!pubKey || busy) return;
    setError(null);
    setTxHash(null);
    setPhase("building");
    setStatusDetail("");
    try {
      let amountMotes: bigint;
      try {
        amountMotes = csprToMotes(amount);
      } catch {
        setPhase("error");
        setError(`enter a valid CSPR amount (got "${amount}")`);
        return;
      }
      if (amountMotes <= 0n) {
        setPhase("error");
        setError("amount must be greater than 0");
        return;
      }

      let tx;
      if (fallbackMode) {
        const target = targetKey.trim() || deviceKey || "";
        if (!/^0[12][0-9a-fA-F]{64,66}$/.test(target)) {
          setPhase("error");
          setError("fallback needs a target public key hex (01… or 02…)");
          return;
        }
        tx = nativeTopUp({ activePubKeyHex: pubKey, targetPubKeyHex: target, amountMotes });
      } else {
        const proxyBytes = await fetchProxyBytes();
        tx = depositTx({
          activePubKeyHex: pubKey,
          amountMotes,
          proxyBytes,
          packageHashEncoding: PACKAGE_HASH_ENCODING,
        });
      }

      const { hash } = await signAndSubmit(tx, pubKey, (p, detail) => {
        setPhase(p as Phase);
        if (p === "submitted" || p === "confirmed") setStatusDetail(detail ?? "");
        if (detail && (p === "confirmed" || p === "submitted")) setTxHash(detail);
      });
      setTxHash(hash);
      setPhase("confirmed");
      onConfirmed?.();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [pubKey, busy, amount, fallbackMode, targetKey, deviceKey, onConfirmed]);

  const statusLine = (() => {
    switch (phase) {
      case "building":
        return "building transaction…";
      case "awaiting signature":
        return "awaiting signature in the wallet popup…";
      case "submitted":
        return "submitted to the node — waiting for execution…";
      case "confirmed":
        return "confirmed on-chain ✓";
      case "error":
        return null; // shown via error banner
      default:
        return null;
    }
  })();

  return (
    <section className="panel full demo">
      <div className="panel-head">
        <h2>💰 Fund the agent (connect wallet)</h2>
        <span className="count">deposit your own test CSPR · casper-test</span>
      </div>
      <div className="panel-body">
        <p className="note">
          Connect the <strong>Casper Wallet</strong> extension and deposit test CSPR straight into
          the live <code className="inline">GuardedWallet</code> contract treasury. You sign in the
          extension popup; the transaction calls the contract&apos;s payable{" "}
          <code className="inline">deposit</code> entry point. A deposit runs a wasm session, so it
          also costs <strong>~15 CSPR of network gas</strong> — the wallet popup shows that gas
          figure, not your deposit amount. You can top up your wallet on the Casper testnet{" "}
          <a href="https://testnet.cspr.live/tools/faucet" target="_blank" rel="noreferrer">
            faucet ↗
          </a>
          .
        </p>

        <div className="kv">
          <span className="k">Treasury (contract purse)</span>
          <span className="v amount">{cspr(treasuryBalance)}</span>
        </div>
        <div className="kv">
          <span className="k">Connected account</span>
          <span className="v mono" title={pubKey ?? undefined}>
            {pubKey ? shortKey(pubKey) : "not connected"}
          </span>
        </div>

        <div className="demo-btns" style={{ marginTop: 14 }}>
          {!pubKey ? (
            <button className="demo-btn" onClick={connect} disabled={!installed}>
              {installed ? "Connect Casper Wallet" : "Casper Wallet not detected"}
            </button>
          ) : (
            <>
              <label
                className="mono"
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
              >
                Amount
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  style={{
                    width: 110,
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    color: "var(--text)",
                    font: "inherit",
                    fontFamily: "var(--mono)",
                    fontSize: 13,
                  }}
                />
                CSPR
              </label>
              <button className="demo-btn" onClick={submit} disabled={busy} aria-busy={busy}>
                {busy
                  ? "working…"
                  : fallbackMode
                    ? "Top up gas float"
                    : "Deposit to treasury"}
              </button>
            </>
          )}
        </div>

        {pubKey && !fallbackMode && /^\d+(\.\d+)?$/.test(amount.trim()) && Number(amount) > 0 && (
          <p className="note" style={{ marginTop: 0, marginBottom: 10 }}>
            The wallet popup will show <strong>~15 CSPR</strong> — that is the network gas, not your
            deposit. Total debited ≈{" "}
            <strong>
              {(Number(amount) + 15).toLocaleString(undefined, { maximumFractionDigits: 4 })} CSPR
            </strong>{" "}
            ({amount} deposit + ~15 gas).
          </p>
        )}

        {pubKey && (
          <label
            className="mono"
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 8 }}
          >
            <input
              type="checkbox"
              checked={fallbackMode}
              onChange={(e) => setFallbackMode(e.target.checked)}
              disabled={busy}
            />
            fallback: top up gas float (plain native transfer — zero proxy-caller risk)
          </label>
        )}

        {pubKey && fallbackMode && (
          <input
            type="text"
            placeholder={`target public key hex (default device ${shortKey(deviceKey ?? null)})`}
            value={targetKey}
            onChange={(e) => setTargetKey(e.target.value)}
            disabled={busy}
            style={{
              width: "100%",
              maxWidth: 560,
              background: "var(--bg-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              padding: "8px 10px",
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              marginBottom: 8,
            }}
          />
        )}

        {(statusLine || error || txHash) && (
          <div className="terminal" role="status" aria-live="polite">
            {statusLine && <div className="term-line">{statusLine}</div>}
            {txHash && (
              <div className="term-line">
                tx{" "}
                <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noreferrer">
                  {shortKey(txHash)} ↗
                </a>
              </div>
            )}
            {phase === "confirmed" && (
              <div className="demo-result">
                <span className="result-badge ok">
                  ✓ Deposit confirmed — treasury should rise on the next poll
                </span>
              </div>
            )}
            {error && (
              <div className="demo-result">
                <span className="result-badge warn">⚠ {error}</span>
              </div>
            )}
            {statusDetail && phase === "submitted" && (
              <div className="term-line" style={{ color: "var(--text-faint)" }}>
                hash {statusDetail}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
