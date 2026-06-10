/**
 * client.ts — the brain's ONLY channel to money.
 *
 * The brain holds NO key. It can express, at most, a PaymentIntent
 * {payee, amountMotes, seq} and POST it to the Pi Signer's /sign-intent with a
 * Bearer token. The signer holds the device key, enforces static policy, builds
 * and signs `pay` itself, and returns {hash, status, success}. The brain cannot
 * sign, cannot pick gas, cannot emit anything but a `pay` intent.
 *
 * Signer response status codes (see signer/src/server.ts):
 *   200 success | 202 pending(unknown) | 400 bad shape | 401 unauthorized
 *   403 off-policy | 409 replay | 502 failed/reverted
 */
import type { PaymentIntent } from "../../shared/src/types.js";

/** What the signer hands back, plus the HTTP status the brain saw. */
export interface SendResult {
  /** HTTP status from the signer. */
  status: number;
  /** on-chain tx hash (present on 200/202/502-with-hash). */
  hash?: string;
  /** signer's tri-state execution status string ("success"|"unknown"|"reverted"). */
  execStatus?: string;
  /** true only on a confirmed on-chain success. */
  success?: boolean;
  /** denial/error reason, when present. */
  reason?: string;
}

export type SendIntent = (intent: PaymentIntent) => Promise<SendResult>;

/** Fetch-like dependency, so tests can inject a mock. Defaults to global fetch. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json(): Promise<any> }>;

/**
 * Build a sender bound to a signer base URL + Bearer token.
 * The returned function POSTs an intent and normalizes the response.
 * It NEVER throws on a non-2xx HTTP status — the status is surfaced in the
 * result so the brain (loop) can decide what to do.
 */
export function makeSender(
  baseUrl: string,
  token: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): SendIntent {
  const url = `${baseUrl.replace(/\/$/, "")}/sign-intent`;
  return async (intent: PaymentIntent): Promise<SendResult> => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(intent),
    });
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    return {
      status: res.status,
      hash: body.hash,
      execStatus: body.status,
      success: body.success,
      reason: body.reason,
    };
  };
}
