import { describe, expect, it } from "vitest";
import { createUser, ctx, req } from "./helpers";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { POST as forgot } from "@/app/api/v1/auth/forgot-password/route";
import { POST as reset } from "@/app/api/v1/auth/reset-password/route";
import { POST as changePw } from "@/app/api/v1/auth/change-password/route";
import { GET as sessions } from "@/app/api/v1/auth/sessions/route";
import { DELETE as revokeSession } from "@/app/api/v1/auth/sessions/[id]/route";
import { User } from "@/models/User";
import { loginUser, refreshSession, registerUser } from "@/services/auth.service";
import { signAccessToken } from "@/lib/auth/tokens";

const web = { origin: "http://localhost:3000" };

describe("authentication", () => {
  it("registers with a hashed password and sets HTTP-only cookies for web clients", async () => {
    const res = await register(
      req("POST", "/api/v1/auth/register", {
        headers: web,
        body: { name: "Bob", email: "Bob@Example.com", password: "Passw0rd!x" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe("bob@example.com");
    expect(body.data.tokens).toBeUndefined(); // web clients never get tokens in JS-readable form
    const cookies = res.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/pl_at=.*HttpOnly/i);
    expect(cookies).toMatch(/pl_rt=.*HttpOnly/i);
    expect(cookies).toMatch(/SameSite=lax/i);

    const stored = await User.findOne({ email: "bob@example.com" }).select("+passwordHash");
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored?.passwordHash).not.toContain("Passw0rd");
  });

  it("returns a token pair for extension clients and accepts it as Bearer auth", async () => {
    const res = await register(
      req("POST", "/api/v1/auth/register", {
        body: { name: "Ext", email: "ext@example.com", password: "Passw0rd!x", client: "extension" },
      }),
    );
    const { data } = await res.json();
    expect(data.tokens.accessToken).toBeTruthy();
    expect(data.tokens.refreshToken).toBeTruthy();
    const meRes = await me(req("GET", "/api/v1/auth/me", { headers: { authorization: `Bearer ${data.tokens.accessToken}` } }));
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).data.user.email).toBe("ext@example.com");
  });

  it("rejects duplicate emails and wrong passwords with a generic message", async () => {
    await createUser("dup@example.com");
    await expect(
      registerUser({ name: "x", email: "dup@example.com", password: "Passw0rd!x", client: "web" }),
    ).rejects.toMatchObject({ status: 409 });

    const bad = await login(req("POST", "/api/v1/auth/login", { headers: web, body: { email: "dup@example.com", password: "wrong-pass1" } }));
    const unknown = await login(req("POST", "/api/v1/auth/login", { headers: web, body: { email: "nobody@example.com", password: "wrong-pass1" } }));
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await bad.json()).error.message).toBe((await unknown.json()).error.message);
  });

  it("rate-limits repeated login attempts", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const r = await login(req("POST", "/api/v1/auth/login", { headers: { ...web, "x-forwarded-for": "9.9.9.9" }, body: { email: "a@b.co", password: "whatever1" } }));
      last = r.status;
    }
    expect(last).toBe(429);
  });

  it("protected endpoints require authentication", async () => {
    expect((await me(req("GET", "/api/v1/auth/me"))).status).toBe(401);
    expect((await me(req("GET", "/api/v1/auth/me", { headers: { authorization: "Bearer garbage" } }))).status).toBe(401);
    // a correctly signed token for a session that does not exist is rejected too
    const forged = await signAccessToken({ sub: "a".repeat(24), role: "user", sid: "no-such-session" });
    expect((await me(req("GET", "/api/v1/auth/me", { headers: { authorization: `Bearer ${forged}` } }))).status).toBe(401);
  });

  it("blocks cross-origin cookie-authenticated writes (CSRF) but not Bearer calls", async () => {
    const { tokens } = await createUser();
    const cookie = `pl_at=${tokens.accessToken}`;
    const evil = await changePw(req("POST", "/api/v1/auth/change-password", { headers: { cookie, origin: "https://evil.example" }, body: { currentPassword: "Passw0rd!x", newPassword: "Another1pass" } }));
    expect(evil.status).toBe(403);
    const noOrigin = await changePw(req("POST", "/api/v1/auth/change-password", { headers: { cookie }, body: { currentPassword: "Passw0rd!x", newPassword: "Another1pass" } }));
    expect(noOrigin.status).toBe(403);
    const same = await changePw(req("POST", "/api/v1/auth/change-password", { headers: { cookie, origin: "http://localhost:3000" }, body: { currentPassword: "Passw0rd!x", newPassword: "Another1pass" } }));
    expect(same.status).toBe(200);
  });

  it("rotates refresh tokens and revokes the whole session when one is replayed", async () => {
    const { tokens } = await createUser();
    const first = await refreshSession(tokens.refreshToken);
    expect(first.tokens.refreshToken).not.toBe(tokens.refreshToken);

    // the old token is now spent; replaying it after the grace window kills the session
    const { RefreshToken } = await import("@/models/RefreshToken");
    await RefreshToken.updateMany({ rotatedAt: { $exists: true } }, { $set: { rotatedAt: new Date(Date.now() - 60_000) } });
    await expect(refreshSession(tokens.refreshToken)).rejects.toMatchObject({ status: 401 });
    // ...including the freshly issued token of the same session
    await expect(refreshSession(first.tokens.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  it("refresh endpoint works with the cookie and with a body token", async () => {
    const { tokens } = await createUser();
    const viaBody = await refresh(req("POST", "/api/v1/auth/refresh", { body: { refreshToken: tokens.refreshToken } }));
    expect(viaBody.status).toBe(200);
    const next = (await viaBody.json()).data.tokens;
    expect(next.accessToken).toBeTruthy();

    const viaCookie = await refresh(req("POST", "/api/v1/auth/refresh", { headers: { origin: "http://localhost:3000", cookie: `pl_rt=${next.refreshToken}` }, body: {} }));
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.headers.getSetCookie().join()).toMatch(/pl_at=/);
  });

  it("logout revokes the session immediately (access token stops working)", async () => {
    const { bearer, tokens } = await createUser();
    expect((await me(req("GET", "/api/v1/auth/me", { headers: bearer }))).status).toBe(200);
    const res = await logout(req("POST", "/api/v1/auth/logout", { headers: bearer, body: {} }));
    expect(res.status).toBe(200);
    expect((await me(req("GET", "/api/v1/auth/me", { headers: bearer }))).status).toBe(401);
    await expect(refreshSession(tokens.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  it("lists and revokes individual devices", async () => {
    const a = await createUser("dev@example.com");
    const second = await loginUser({ email: "dev@example.com", password: "Passw0rd!x", client: "extension", deviceLabel: "Chrome ext" });
    const list = await (await sessions(req("GET", "/api/v1/auth/sessions", { headers: a.bearer }))).json();
    expect(list.data.sessions).toHaveLength(2);
    const other = list.data.sessions.find((s: { current: boolean }) => !s.current);
    expect(other.label).toBe("Chrome ext");
    const del = await revokeSession(req("DELETE", `/api/v1/auth/sessions/${other.id}`, { headers: a.bearer }), ctx({ id: other.id }));
    expect(del.status).toBe(200);
    const withSecond = { authorization: `Bearer ${second.tokens.accessToken}` };
    expect((await me(req("GET", "/api/v1/auth/me", { headers: withSecond }))).status).toBe(401);
  });

  it("changes password (old one stops working) and signs out other devices", async () => {
    const a = await createUser("pw@example.com");
    const other = await loginUser({ email: "pw@example.com", password: "Passw0rd!x", client: "extension" });
    const bad = await changePw(req("POST", "/api/v1/auth/change-password", { headers: a.bearer, body: { currentPassword: "nope-nope1", newPassword: "Another1pass" } }));
    expect(bad.status).toBe(400);
    const ok = await changePw(req("POST", "/api/v1/auth/change-password", { headers: a.bearer, body: { currentPassword: "Passw0rd!x", newPassword: "Another1pass" } }));
    expect(ok.status).toBe(200);
    await expect(loginUser({ email: "pw@example.com", password: "Passw0rd!x", client: "web" })).rejects.toMatchObject({ status: 401 });
    await expect(loginUser({ email: "pw@example.com", password: "Another1pass", client: "web" })).resolves.toBeTruthy();
    expect((await me(req("GET", "/api/v1/auth/me", { headers: a.bearer }))).status).toBe(200);
    expect((await me(req("GET", "/api/v1/auth/me", { headers: { authorization: `Bearer ${other.tokens.accessToken}` } }))).status).toBe(401);
  });

  it("password reset: generic response, single-use token, old sessions revoked", async () => {
    const a = await createUser("reset@example.com");
    const unknown = await (await forgot(req("POST", "/api/v1/auth/forgot-password", { headers: web, body: { email: "ghost@example.com" } }))).json();
    expect(unknown.data.message).toMatch(/if an account exists/i);
    expect(unknown.data.devLink).toBeUndefined();

    const known = await (await forgot(req("POST", "/api/v1/auth/forgot-password", { headers: web, body: { email: "reset@example.com" } }))).json();
    const token = new URL(known.data.devLink).searchParams.get("token")!;
    const done = await reset(req("POST", "/api/v1/auth/reset-password", { headers: web, body: { token, password: "Brandnew1pw" } }));
    expect(done.status).toBe(200);
    const again = await reset(req("POST", "/api/v1/auth/reset-password", { headers: web, body: { token, password: "Another2pw" } }));
    expect(again.status).toBe(400);
    expect((await me(req("GET", "/api/v1/auth/me", { headers: a.bearer }))).status).toBe(401);
    await expect(loginUser({ email: "reset@example.com", password: "Brandnew1pw", client: "web" })).resolves.toBeTruthy();
  });
});
