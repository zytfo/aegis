import { NextResponse } from "next/server";

// Proxy the Pi Signer's append-only audit log. If the signer is unreachable
// (not running, wrong URL), degrade gracefully to an empty list so the dashboard
// still renders the on-chain panels.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SIGNER_URL = process.env.SIGNER_URL ?? "http://127.0.0.1:8787";

export async function GET() {
  try {
    const res = await fetch(`${SIGNER_URL.replace(/\/$/, "")}/audit`, {
      cache: "no-store",
      // Don't hang the dashboard if the signer is down.
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
    const data = await res.json();
    return NextResponse.json(Array.isArray(data) ? data : [], {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // Signer not running / network error: empty audit, not a hard failure.
    return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
  }
}
