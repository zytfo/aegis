/**
 * audit.ts — append-only JSONL audit log.
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";

export interface AuditEntry {
  ts: string;
  event: "approved" | "denied";
  payee?: string;
  amountMotes?: string;
  seq?: number;
  reason?: string;
  hash?: string;
  success?: boolean;
}

export interface AuditLog {
  record(entry: Omit<AuditEntry, "ts"> & { ts?: string }): void;
  readAll(): AuditEntry[];
}

export function makeAudit(path: string): AuditLog {
  return {
    record(entry) {
      const full: AuditEntry = { ts: entry.ts ?? new Date().toISOString(), ...entry } as AuditEntry;
      appendFileSync(path, JSON.stringify(full) + "\n", "utf8");
    },
    readAll(): AuditEntry[] {
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as AuditEntry);
    },
  };
}
