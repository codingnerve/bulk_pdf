import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createUser, ctx, req, uploadOne } from "./helpers";
import { POST as csvRoute } from "@/app/api/v1/exports/csv/route";
import { POST as xlsxRoute } from "@/app/api/v1/exports/xlsx/route";
import { POST as txtRoute } from "@/app/api/v1/exports/txt/route";
import { GET as configRoute } from "@/app/api/v1/config/route";
import { GET as settingsGet, PATCH as settingsPatch } from "@/app/api/v1/settings/route";
import { DELETE as accountDelete } from "@/app/api/v1/account/route";
import { GET as openapi } from "@/app/api/v1/openapi.json/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { revokeLink } from "@/services/link.service";
import { FileModel } from "@/models/File";
import { User } from "@/models/User";
import { mem } from "./helpers";
import { errorToResponse } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { z } from "zod";

async function seed() {
  const u = await createUser();
  const a = (await uploadOne(u.scope, "alpha.pdf", 1500)).file;
  const b = (await uploadOne(u.scope, "=1+1.pdf", 2500)).file;
  const c = (await uploadOne(u.scope, 'comma, "quote".pdf', 3500)).file;
  return { ...u, a, b, c };
}

describe("exports", () => {
  it("CSV: header, rows, escaping and formula neutralisation", async () => {
    const { bearer, a, b } = await seed();
    const res = await csvRoute(req("POST", "/api/v1/exports/csv", { headers: bearer, body: {} }));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="pdflinker-links-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = await res.text();
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Filename,Public URL,File Size,Upload Date,Status");
    expect(lines).toHaveLength(4);
    expect(text).toContain(a.publicUrl);
    expect(text).toContain("1.5 KB");
    expect(text).toContain("'=1+1.pdf"); // formula injection neutralised
    expect(text).toContain('"comma, quote.pdf"');
    expect(b.publicUrl).toBeTruthy();
  });

  it("TXT: one public URL per line", async () => {
    const { bearer, a, b, c } = await seed();
    const text = await (await txtRoute(req("POST", "/api/v1/exports/txt", { headers: bearer, body: {} }))).text();
    expect(text.trim().split("\n").sort()).toEqual([a.publicUrl, b.publicUrl, c.publicUrl].sort());
  });

  it("XLSX: a real workbook with a styled header and hyperlinks", async () => {
    const { bearer, a } = await seed();
    const res = await xlsxRoute(req("POST", "/api/v1/exports/xlsx", { headers: bearer, body: {} }));
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as never);
    const ws = wb.getWorksheet("PDF Links")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Filename", "Public URL", "File Size", "Upload Date", "Status"]);
    expect(ws.rowCount).toBe(4);
    const urls = [2, 3, 4].map((r) => {
      const v = ws.getRow(r).getCell(2).value as { text: string; hyperlink: string };
      return v.hyperlink;
    });
    expect(urls).toContain(a.publicUrl);
    expect(ws.getRow(1).getCell(1).fill).toMatchObject({ type: "pattern" });
  });

  it("exports only successful, still-public uploads by default; selected ids; includeAll", async () => {
    const { scope, bearer, a, b, c } = await seed();
    await revokeLink(scope, c.id);
    const def = await (await txtRoute(req("POST", "/api/v1/exports/txt", { headers: bearer, body: {} }))).text();
    expect(def.trim().split("\n")).toHaveLength(2);
    expect(def).not.toContain(c.publicUrl);

    const selected = await (await txtRoute(req("POST", "/api/v1/exports/txt", { headers: bearer, body: { ids: [a.id] } }))).text();
    expect(selected.trim()).toBe(a.publicUrl);

    const csvAll = await (await csvRoute(req("POST", "/api/v1/exports/csv", { headers: bearer, body: { includeAll: true } }))).text();
    expect(csvAll).toContain("revoked");
    expect(b.id).toBeTruthy();
  });

  it("never exports another user's files, even when their ids are supplied", async () => {
    const owner = await seed();
    const other = await createUser("other@example.com", "Other");
    const res = await txtRoute(req("POST", "/api/v1/exports/txt", { headers: other.bearer, body: { ids: [owner.a.id] } }));
    expect(await res.text()).toBe("");
    expect(res.headers.get("x-export-count")).toBe("0");
  });

  it("validates export bodies", async () => {
    const { bearer } = await createUser();
    const bad = await csvRoute(req("POST", "/api/v1/exports/csv", { headers: bearer, body: { ids: ["not-an-id"] } }));
    expect(bad.status).toBe(400);
  });
});

describe("settings, config and account", () => {
  it("exposes effective limits, capped by the server limits", async () => {
    const { bearer } = await createUser();
    const cfg = (await (await configRoute(req("GET", "/api/v1/config", { headers: bearer }))).json()).data;
    expect(cfg.limits).toMatchObject({ maxFileSizeMb: 50, maxFilesPerBatch: 10 });
    expect(cfg.publicDomain).toBe("files.example.test");

    const tooHigh = await settingsPatch(req("PATCH", "/api/v1/settings", { headers: bearer, body: { maxFileSizeMb: 500 } }));
    expect(tooHigh.status).toBe(400);
    const lower = await settingsPatch(req("PATCH", "/api/v1/settings", { headers: bearer, body: { maxFileSizeMb: 20, defaultPublic: false, name: "Ally" } }));
    const s = (await lower.json()).data;
    expect(s.settings).toMatchObject({ maxFileSizeMb: 20, defaultPublic: false });
    expect(s.profile.name).toBe("Ally");
    expect(s.effectiveLimits.maxFileSizeMb).toBe(20);
    const reset = await settingsPatch(req("PATCH", "/api/v1/settings", { headers: bearer, body: { maxFileSizeMb: null } }));
    expect((await reset.json()).data.effectiveLimits.maxFileSizeMb).toBe(50);
    expect((await (await settingsGet(req("GET", "/api/v1/settings", { headers: bearer }))).json()).data.publicDomain).toBe("files.example.test");
    const unknown = await settingsPatch(req("PATCH", "/api/v1/settings", { headers: bearer, body: { role: "admin" } }));
    expect(unknown.status).toBe(400); // mass-assignment protection
    expect((await User.findOne({}))!.role).toBe("user");
  });

  it("deleting the account removes the user's files from storage and the database, nothing else", async () => {
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com", "Bob");
    await uploadOne(alice.scope, "a1.pdf", 101);
    await uploadOne(alice.scope, "a2.pdf", 102);
    await uploadOne(bob.scope, "b1.pdf", 103);
    const wrong = await accountDelete(req("DELETE", "/api/v1/account", { headers: alice.bearer, body: { password: "wrong-pass1" } }));
    expect(wrong.status).toBe(400);
    const ok = await accountDelete(req("DELETE", "/api/v1/account", { headers: alice.bearer, body: { password: "Passw0rd!x" } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie().join()).toMatch(/pl_at=;/);
    expect(await User.countDocuments({ email: "alice@example.com" })).toBe(0);
    expect(await FileModel.countDocuments({ userId: alice.userId })).toBe(0);
    expect(await FileModel.countDocuments({ userId: bob.userId })).toBe(1);
    expect(mem().objects.size).toBe(1);
    expect((await meRoute(req("GET", "/api/v1/auth/me", { headers: alice.bearer }))).status).toBe(401);
  });
});

describe("API plumbing", () => {
  it("serves an OpenAPI document that covers the required endpoints", async () => {
    const spec = await (await openapi(req("GET", "/api/v1/openapi.json"))).json();
    expect(spec.openapi).toMatch(/^3\./);
    const required = [
      "/api/v1/auth/register", "/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/auth/me",
      "/api/v1/uploads/initiate", "/api/v1/uploads/complete", "/api/v1/uploads/cancel", "/api/v1/uploads/{id}/status",
      "/api/v1/files", "/api/v1/files/{id}", "/api/v1/files/bulk-delete",
      "/api/v1/links", "/api/v1/links/bulk-copy-data", "/api/v1/links/{id}/verify", "/api/v1/links/{id}/revoke",
      "/api/v1/batches", "/api/v1/batches/{id}",
      "/api/v1/exports/csv", "/api/v1/exports/xlsx", "/api/v1/exports/txt",
    ];
    for (const p of required) expect(spec.paths[p], p).toBeDefined();
  });

  it("maps errors to the standard envelope and hides internals", async () => {
    const zod = errorToResponse(z.object({ a: z.string() }).safeParse({}).error);
    expect(zod.status).toBe(400);
    expect((await zod.json()).error.code).toBe("VALIDATION_ERROR");
    const api = errorToResponse(Errors.notFound());
    expect(await api.json()).toEqual({ success: false, error: { code: "NOT_FOUND", message: "Resource not found" } });
    const boom = errorToResponse(new Error("secret db password in message"));
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await boom.json())).not.toContain("secret");
    const dup = errorToResponse({ code: 11000 });
    expect(dup.status).toBe(409);
    const net = errorToResponse({ name: "MongoServerSelectionError", message: "x" });
    expect(net.status).toBe(503);
  });

  it("rejects malformed JSON and invalid ids", async () => {
    const { bearer } = await createUser();
    const { POST } = await import("@/app/api/v1/files/bulk-delete/route");
    const raw = new Request("http://localhost:3000/api/v1/files/bulk-delete", { method: "POST", headers: { ...bearer, "content-type": "application/json" }, body: "{nope" });
    expect((await POST(raw)).status).toBe(400);
    const { GET } = await import("@/app/api/v1/files/[id]/route");
    expect((await GET(req("GET", "/api/v1/files/xyz", { headers: bearer }), ctx({ id: "xyz" }))).status).toBe(400);
  });

  it("rate-limits per user", async () => {
    const { bearer } = await createUser();
    const { POST } = await import("@/app/api/v1/uploads/cancel/route");
    let last = 0;
    for (let i = 0; i < 65; i++) {
      last = (await POST(req("POST", "/api/v1/uploads/cancel", { headers: bearer, body: { fileId: "a".repeat(24) } }))).status;
    }
    expect(last).toBe(429);
  });
});
