import { describe, expect, it } from "vitest";
import { checkLink, checksum, decodeRecord, encodeRecord, verifyUrl, type VerifyRecord } from "@/features/certmaker/lib/verify";
import { qrMatrix } from "@/features/certmaker/lib/qr";
import { DEFAULT_DATA } from "@/features/certmaker/lib/types";

const rec: VerifyRecord = { id: "CERT-2026-001", name: "ଆଶା Mohanty", title: "Certificate of Achievement", org: "L V Prasad", date: "12 October 2026" };

describe("verification links", () => {
  it("round-trips unicode records through the compact encoding", () => {
    expect(decodeRecord(encodeRecord(rec))).toEqual(rec);
  });
  it("rejects malformed payloads", () => {
    expect(decodeRecord("not-base64!!")).toBeNull();
    expect(decodeRecord(encodeRecord({ ...rec }).slice(0, 10))).toBeNull();
  });
  it("accepts an intact link and flags an edited one", async () => {
    const d = encodeRecord(rec);
    const h = await checksum(rec);
    expect((await checkLink(rec.id, d, h)).status).toBe("intact");
    const forged = encodeRecord({ ...rec, name: "Someone Else" });
    expect((await checkLink(rec.id, forged, h)).status).toBe("altered");
    expect((await checkLink("CERT-2026-999", d, h)).status).toBe("altered");
    expect((await checkLink(rec.id)).status).toBe("no-record");
  });
  it("builds long (embedded) and short URLs on a custom domain", async () => {
    const base = { ...DEFAULT_DATA, certId: "CERT-2026-001", verifyBase: "verify.example.com/" };
    expect(await verifyUrl({ ...base, verifyEmbed: false })).toBe("https://verify.example.com/CERT-2026-001");
    expect(await verifyUrl({ ...base, verifyEmbed: true })).toMatch(/^https:\/\/verify\.example\.com\/CERT-2026-001\?d=[\w-]+&h=[0-9a-f]{16}$/);
  });
});

describe("qrMatrix", () => {
  it("returns a square matrix with finder patterns", () => {
    const m = qrMatrix("https://example.com/verify/CERT-2026-001");
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    expect(m[0]?.slice(0, 7).every(Boolean)).toBe(true); // top-left finder pattern edge
  });
});
