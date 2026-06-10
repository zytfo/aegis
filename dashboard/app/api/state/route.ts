import { NextResponse } from "next/server";
import { readWalletState } from "@/lib/casper";

// Always read fresh from the node; never cache the on-chain state.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const state = await readWalletState();
    return NextResponse.json(state, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "failed to read live contract state", detail: message },
      { status: 502 },
    );
  }
}
