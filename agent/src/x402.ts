/**
 * x402.ts — SECONDARY rail (kept minimal by design).
 *
 * x402 is the HTTP-402 "pay-to-fetch" flow: a resource returns 402 with a
 * `PaymentRequirements` body, the client produces a signed payment authorization,
 * and retries with an `X-PAYMENT` header.
 *
 * DESIGN DECISION / LIVE-GATING NOTICE:
 *   On Casper, x402 is NOT native CSPR — it is a CEP-18 (fungible-token) transfer
 *   authorized via an EIP-712-style signature ("authorization"), settled by a
 *   facilitator. The required CEP-18 *test token* is currently UNOBTAINABLE on
 *   casper-test, so a LIVE x402 round-trip cannot be exercised here. Per the
 *   Aegis design (native CSPR via the Pi Signer is the CORE rail; x402 is
 *   secondary), we implement the FLOW only and unit-test it against a mocked
 *   fetch + a mocked `signAuthorization` dependency. DO NOT call live x402 until
 *   a CEP-18 test token is available.
 *
 * Consistent with the hardware moat, the `signAuthorization` dependency is meant
 * to be backed by the Pi Signer (a Pi-side x402 endpoint), so the brain still
 * never holds a key. Here it is injected so the flow is testable in isolation.
 */

/** Subset of x402 PaymentRequirements we consume (CEP-18 authorization flavour). */
export interface PaymentRequirements {
  scheme: string;
  network: string;
  /** CEP-18 token contract / asset id. */
  asset: string;
  /** recipient of the token payment. */
  payTo: string;
  /** amount of the token (atomic units, decimal string). */
  maxAmountRequired: string;
  /** opaque nonce / resource identifier echoed back in the authorization. */
  resource?: string;
}

/** A Pi-signed payment authorization, base64-encoded for the X-PAYMENT header. */
export interface PaymentPayload {
  /** header value to send back on retry. */
  xPayment: string;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}>;

export interface X402Deps {
  fetchImpl: FetchLike;
  /**
   * Produce a Pi-signed payment authorization for the given requirements.
   * In production this calls the Pi Signer (key never leaves the Pi); in tests
   * it is mocked.
   */
  signAuthorization: (req: PaymentRequirements) => Promise<PaymentPayload>;
}

export interface PayAndFetchResult {
  status: number;
  body: any;
  /** true iff a 402 was encountered and a payment was made before the retry. */
  paid: boolean;
}

/**
 * GET `url`. On HTTP 402, read the PaymentRequirements, request a Pi-signed
 * payment authorization, and retry with the X-PAYMENT header exactly once.
 * Returns the final response. If the first request is not a 402, returns it
 * unchanged (paid:false).
 */
export async function payAndFetch(url: string, deps: X402Deps): Promise<PayAndFetchResult> {
  const first = await deps.fetchImpl(url, { method: "GET" });
  if (first.status !== 402) {
    return { status: first.status, body: await safeJson(first), paid: false };
  }

  // 402 -> parse requirements, sign, retry.
  const reqs = await parseRequirements(first);
  const payment = await deps.signAuthorization(reqs);
  const retried = await deps.fetchImpl(url, {
    method: "GET",
    headers: { "X-PAYMENT": payment.xPayment },
  });
  return { status: retried.status, body: await safeJson(retried), paid: true };
}

/** Extract PaymentRequirements from a 402 body (`accepts[0]` or top-level). */
async function parseRequirements(res: { json(): Promise<any> }): Promise<PaymentRequirements> {
  const body = await res.json();
  const r = Array.isArray(body?.accepts) ? body.accepts[0] : body;
  return r as PaymentRequirements;
}

async function safeJson(res: { json(): Promise<any> }): Promise<any> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}
