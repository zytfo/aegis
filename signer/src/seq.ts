import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

/**
 * Monotonic sequence store, persisted to disk so replay protection survives
 * restart.
 *
 * Two-phase scheme (avoids burning a seq on a failed pay):
 *   - isFresh(seq): check-only — true if seq > last-accepted. No write.
 *   - commit(seq):  persist last=seq (atomic write). Call only AFTER the
 *                   action keyed by `seq` has confirmed success.
 *
 * Durability: commit writes to a temp file then renameSync (atomic on POSIX);
 * the in-memory `last` is updated ONLY after the write succeeds (fail-closed).
 *
 * Fail-closed read: an existing, non-empty but unparseable file THROWS rather
 * than silently defaulting to -1. Only a truly absent file means last=-1.
 */
export interface SeqStore {
  /** True if seq is a strictly-increasing integer over the last committed value. No write. */
  isFresh(seq: number): boolean;
  /** Persist last=seq atomically. Throws if seq is not fresh. */
  commit(seq: number): void;
  /** Last committed seq, or -1 if none. */
  last(): number;
}

export function makeSeqStore(path: string): SeqStore {
  let last = -1;
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8").trim();
    if (raw) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        // Non-empty but unparseable: fail closed rather than reset replay protection.
        throw new Error(`seq store at ${path} is corrupt: ${JSON.stringify(raw)}`);
      }
      last = n;
    }
  }
  return {
    isFresh(seq: number): boolean {
      return Number.isInteger(seq) && seq > last;
    },
    commit(seq: number): void {
      if (!Number.isInteger(seq) || seq <= last) {
        throw new Error(`refusing to commit non-fresh seq ${seq} (last=${last})`);
      }
      // Atomic durable write: temp + rename. Update memory only after success.
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, String(seq), "utf8");
      renameSync(tmp, path);
      last = seq;
    },
    last() { return last; },
  };
}
