import { NextResponse } from "next/server";

// Server-side submit proxy. A browser cannot POST a transaction straight to the
// public Casper node (no CORS → "Network Error" / "Failed to fetch"). The wallet
// signs in the browser; the signed transaction JSON is sent here and forwarded to
// the node server-side via account_put_transaction (no CORS).
export const dynamic = "force-dynamic";

const NODE = process.env.CASPER_NODE_ADDRESS ?? "https://node.testnet.casper.network/rpc";

export async function POST(req: Request) {
  let txJson: unknown;
  try {
    const body = await req.json();
    txJson = body?.transaction;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!txJson) return NextResponse.json({ error: "missing transaction" }, { status: 400 });

  try {
    const r = await fetch(NODE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "account_put_transaction",
        params: { transaction: txJson },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await r.json()) as {
      result?: { transaction_hash?: { Version1?: string } | string };
      error?: { code: number; message: string };
    };
    if (data.error) {
      return NextResponse.json(
        { error: `${data.error.code} ${data.error.message}` },
        { status: 502 },
      );
    }
    const th = data.result?.transaction_hash;
    const hash = typeof th === "string" ? th : th?.Version1 ?? null;
    return NextResponse.json({ hash });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
