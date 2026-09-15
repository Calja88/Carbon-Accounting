import { createHash } from "node:crypto";

/** Strict canonical JSON for the official-factor domain. Unlike tenant audit JSON,
 * this rejects floats/undefined/Date and normalises Unicode before hashing. */
export function canonicalJson(value: unknown): string {
  function encode(item: unknown): string {
    if (item === null) return "null";
    if (typeof item === "string") return JSON.stringify(item.normalize("NFC").replace(/\r\n?/g, "\n"));
    if (typeof item === "boolean") return String(item);
    if (typeof item === "number" && Number.isSafeInteger(item)) return String(item);
    if (Array.isArray(item)) {
      const keys = Object.keys(item);
      if (keys.length !== item.length || keys.some((key, index) => key !== String(index))) throw new Error("Sparse or decorated canonical array");
      return `[${item.map(encode).join(",")}]`;
    }
    if (typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      const entries = Object.entries(item as Record<string, unknown>).map(([key, val]) => [
        key.normalize("NFC").replace(/\r\n?/g, "\n"), val,
      ] as const).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error("Canonical key collision");
      return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${encode(val)}`).join(",")}}`;
    }
    throw new Error("Canonical values must be JSON with safe integers and explicit nulls");
  }
  return encode(value);
}

export function contractHash(domain: string, value: unknown): string {
  if (!/^[a-z-]+\/v[1-9]\d*$/.test(domain)) throw new Error("Invalid hash domain/version");
  return createHash("sha256").update(`carbon-ledger/official-${domain}\n`).update(canonicalJson(value)).digest("hex");
}

/** Byte identity deliberately takes neither filename nor release metadata. */
export function artifactIdentity(bytes: Uint8Array): { sha256: string; byteSize: number } {
  return { sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.byteLength };
}

/** Only arrays declared to be sets by their contract may use this ordering. */
export function canonicalOrder<T>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const left = canonicalJson(a), right = canonicalJson(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
