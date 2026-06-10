/**
 * key.ts — encrypted-at-rest Ed25519 key store.
 *
 * The device secret key is stored on disk as AES-256-GCM ciphertext only:
 * the file holds {salt, iv, tag, ciphertext} — NO plaintext key material.
 * The encryption key is derived from a passphrase via scrypt.
 *
 * The plaintext we encrypt is the PEM of the Ed25519 secret key; on load we
 * decrypt and hand the PEM to casper-js-sdk's PrivateKey.fromPem.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { PrivateKey, KeyAlgorithm, type PrivateKeyT } from "./sdk.js";

interface EncFile { v: 1; alg: "aes-256-gcm"; kdf: "scrypt"; salt: string; iv: string; tag: string; ct: string; }

function deriveKey(pass: string, salt: Buffer): Buffer {
  return scryptSync(pass, salt, 32);
}

function encryptPem(pem: string, pass: string): EncFile {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const dk = deriveKey(pass, salt);
  const cipher = createCipheriv("aes-256-gcm", dk, iv);
  const ct = Buffer.concat([cipher.update(pem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1, alg: "aes-256-gcm", kdf: "scrypt",
    salt: salt.toString("hex"), iv: iv.toString("hex"),
    tag: tag.toString("hex"), ct: ct.toString("hex"),
  };
}

function decryptPem(file: EncFile, pass: string): string {
  const salt = Buffer.from(file.salt, "hex");
  const iv = Buffer.from(file.iv, "hex");
  const tag = Buffer.from(file.tag, "hex");
  const ct = Buffer.from(file.ct, "hex");
  const dk = deriveKey(pass, salt);
  const decipher = createDecipheriv("aes-256-gcm", dk, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Generate a fresh Ed25519 key, encrypt, and store at `path`. */
export function generateAndStore(path: string, pass: string): PrivateKeyT {
  const kp = PrivateKey.generate(KeyAlgorithm.ED25519);
  writeFileSync(path, JSON.stringify(encryptPem(kp.toPem(), pass)), "utf8");
  return kp;
}

/** Import an EXISTING Ed25519 PEM (e.g. the funded device key) and store encrypted. */
export function importPem(pemPath: string, path: string, pass: string): PrivateKeyT {
  const pem = readFileSync(pemPath, "utf8");
  const kp = PrivateKey.fromPem(pem, KeyAlgorithm.ED25519);
  // re-export through the SDK so the stored PEM is canonical
  writeFileSync(path, JSON.stringify(encryptPem(kp.toPem(), pass)), "utf8");
  return kp;
}

/** Decrypt and load the stored key. Throws on wrong passphrase. */
export function loadKey(path: string, pass: string): PrivateKeyT {
  const file = JSON.parse(readFileSync(path, "utf8")) as EncFile;
  const pem = decryptPem(file, pass); // GCM auth tag => throws on wrong pass
  return PrivateKey.fromPem(pem, KeyAlgorithm.ED25519);
}

export function publicKeyHex(kp: PrivateKeyT): string {
  return kp.publicKey.toHex();
}
