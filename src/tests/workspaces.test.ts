import { describe, expect, it } from "vitest";
import { createUser, ctx, mem, req, uploadOne } from "./helpers";
import { Membership } from "@/models/Membership";
import { Workspace } from "@/models/Workspace";
import { Invite } from "@/models/Invite";
import { FileModel } from "@/models/File";
import type { Scope } from "@/lib/auth/scope";
import { registerUser } from "@/services/auth.service";
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  createWorkspace,
  getInviteInfo,
  listInvites,
  listMembers,
  listMyWorkspaces,
  removeMember,
  renameWorkspace,
  switchWorkspace,
} from "@/services/workspace.service";
import { bulkDeleteFiles, deleteFile, getFile, listFiles, renameFile } from "@/services/file.service";
import { restoreLink, revokeLink, listLinks, bulkCopyData } from "@/services/link.service";
import { collectExportRows } from "@/services/export.service";
import { getOverview } from "@/services/stats.service";
import { getBatch, listBatches } from "@/services/batch.service";
import { cancelUpload, completeUpload, initiateUploads } from "@/services/upload.service";
import { deleteAccount } from "@/services/settings.service";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { GET as workspacesGet, POST as workspacesPost } from "@/app/api/v1/workspaces/route";
import { POST as activeRoute } from "@/app/api/v1/workspaces/active/route";
import { GET as invitesGet, POST as invitesPost } from "@/app/api/v1/workspaces/current/invites/route";
import { GET as inviteInfoRoute } from "@/app/api/v1/invites/[token]/route";
import { POST as acceptRoute } from "@/app/api/v1/invites/accept/route";
import { DELETE as memberDelete, PATCH as memberPatch } from "@/app/api/v1/workspaces/current/members/[userId]/route";
import { GET as filesGet } from "@/app/api/v1/files/route";

const q = { sort: "newest" as const, page: 1, pageSize: 20 };

/** Owner invites `email`; they register through the invite link and land in the workspace. */
async function addMember(owner: { scope: Scope }, email: string, name: string, role: "admin" | "member" = "member") {
  const { link } = await createInvite(owner.scope, { email, role });
  const token = new URL(link).searchParams.get("token")!;
  const { user, tokens } = await registerUser({ name, email, password: "Passw0rd!x", client: "extension", inviteToken: token });
  const m = await Membership.findOne({ userId: user.id, workspaceId: owner.scope.workspaceId }).lean();
  const scope: Scope = { userId: user.id, workspaceId: owner.scope.workspaceId, wsRole: m!.role };
  return { userId: user.id, scope, user, token, bearer: { authorization: `Bearer ${tokens.accessToken}` } };
}

describe("workspaces: creation", () => {
  it("registering creates a personal workspace owned by the new user", async () => {
    const a = await createUser("ada@example.com", "Ada Lovelace");
    const mine = await listMyWorkspaces(a.scope);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: "Ada's workspace", role: "owner", memberCount: 1, current: true });
    const ws = await Workspace.findById(a.workspaceId);
    expect(String(ws!.ownerId)).toBe(a.userId);
  });

  it("/auth/me reports the active workspace and role", async () => {
    const a = await createUser();
    const body = await (await meRoute(req("GET", "/api/v1/auth/me", { headers: a.bearer }))).json();
    expect(body.data.workspace).toMatchObject({ id: a.workspaceId, role: "owner", memberCount: 1 });
  });

  it("creating another workspace makes it active for the session and isolates its files", async () => {
    const a = await createUser();
    await uploadOne(a.scope, "personal.pdf");
    const created = await (await workspacesPost(req("POST", "/api/v1/workspaces", { headers: a.bearer, body: { name: "Marketing" } }))).json();
    expect(created.data.workspace).toMatchObject({ name: "Marketing", role: "owner" });

    // the same bearer token now sees the new (empty) workspace
    const list = await (await filesGet(req("GET", "/api/v1/files", { headers: a.bearer }))).json();
    expect(list.data).toHaveLength(0);
    const all = await (await workspacesGet(req("GET", "/api/v1/workspaces", { headers: a.bearer }))).json();
    expect(all.data.workspaces.map((w: { name: string; current: boolean }) => [w.name, w.current])).toEqual([
      ["Alice's workspace", false],
      ["Marketing", true],
    ]);

    // and switching back shows the original files
    await activeRoute(req("POST", "/api/v1/workspaces/active", { headers: a.bearer, body: { workspaceId: a.workspaceId } }));
    const back = await (await filesGet(req("GET", "/api/v1/files", { headers: a.bearer }))).json();
    expect(back.data.map((f: { displayName: string }) => f.displayName)).toEqual(["personal.pdf"]);
  });

  it("cannot switch to a workspace you do not belong to", async () => {
    const a = await createUser("a@example.com");
    const b = await createUser("b@example.com", "Bob");
    const res = await activeRoute(req("POST", "/api/v1/workspaces/active", { headers: a.bearer, body: { workspaceId: b.workspaceId } }));
    expect(res.status).toBe(404);
    await expect(switchWorkspace(a.userId, a.tokens.refreshToken, b.workspaceId)).rejects.toMatchObject({ status: 404 });
  });

  it("renaming is admin-only", async () => {
    const owner = await createUser();
    const member = await addMember(owner, "m@example.com", "Mia");
    await expect(renameWorkspace(member.scope, "Hacked")).rejects.toMatchObject({ status: 403 });
    await expect(renameWorkspace(owner.scope, "Design team")).resolves.toMatchObject({ name: "Design team" });
  });
});

describe("workspaces: invitations", () => {
  it("an invitee registers via the link, joins the team and gets no personal workspace", async () => {
    const owner = await createUser();
    const info = await createInvite(owner.scope, { email: "New@Example.com", role: "member" });
    expect(info.link).toMatch(/\/invite\?token=/);
    const token = new URL(info.link).searchParams.get("token")!;

    const pub = await inviteInfoRoute(req("GET", `/api/v1/invites/${token}`), ctx({ token }));
    expect((await pub.json()).data).toMatchObject({ email: "new@example.com", role: "member", workspaceName: "Alice's workspace" });

    const m = await addMemberFromToken("new@example.com", "Nina", token);
    const mine = await listMyWorkspaces(m.scope);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: owner.workspaceId, role: "member", memberCount: 2 });
    // the token is single use
    await expect(getInviteInfo(token)).rejects.toMatchObject({ status: 404 });
  });

  async function addMemberFromToken(email: string, name: string, token: string) {
    const { user, tokens } = await registerUser({ name, email, password: "Passw0rd!x", client: "extension", inviteToken: token });
    const mem2 = await Membership.findOne({ userId: user.id }).lean();
    return { user, tokens, scope: { userId: user.id, workspaceId: String(mem2!.workspaceId), wsRole: mem2!.role } as Scope };
  }

  it("rejects registration with an invite for a different email, before creating anything", async () => {
    const owner = await createUser();
    const { link } = await createInvite(owner.scope, { email: "right@example.com", role: "member" });
    const token = new URL(link).searchParams.get("token")!;
    await expect(
      registerUser({ name: "Wrong", email: "wrong@example.com", password: "Passw0rd!x", client: "web", inviteToken: token }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await Membership.countDocuments({})).toBe(1);
  });

  it("an existing user accepts an invite for their own email only", async () => {
    const owner = await createUser("owner@example.com", "Olive");
    const joiner = await createUser("joiner@example.com", "Jo");
    const other = await createUser("other@example.com", "Otto");
    const { link } = await createInvite(owner.scope, { email: "joiner@example.com", role: "member" });
    const token = new URL(link).searchParams.get("token")!;

    const wrong = await acceptRoute(req("POST", "/api/v1/invites/accept", { headers: other.bearer, body: { token } }));
    expect(wrong.status).toBe(403);

    const ok = await acceptRoute(req("POST", "/api/v1/invites/accept", { headers: joiner.bearer, body: { token } }));
    expect(ok.status).toBe(200);
    // the session switched into the new workspace straight away
    const me = await (await meRoute(req("GET", "/api/v1/auth/me", { headers: joiner.bearer }))).json();
    expect(me.data.workspace).toMatchObject({ id: owner.workspaceId, role: "member" });
    expect((await listMyWorkspaces({ ...joiner.scope })).length).toBe(2);
  });

  it("only owners/admins can invite; only the owner can invite admins; duplicates are refused", async () => {
    const owner = await createUser();
    const member = await addMember(owner, "m@example.com", "Mia");
    const admin = await addMember(owner, "a@example.com", "Abe", "admin");
    await expect(createInvite(member.scope, { email: "x@example.com", role: "member" })).rejects.toMatchObject({ status: 403 });
    await expect(createInvite(admin.scope, { email: "x@example.com", role: "admin" })).rejects.toMatchObject({ status: 403 });
    await expect(createInvite(admin.scope, { email: "x@example.com", role: "member" })).resolves.toBeTruthy();
    await expect(createInvite(owner.scope, { email: "m@example.com", role: "member" })).rejects.toMatchObject({ status: 409 });
  });

  it("lists and revokes pending invites; a re-invite replaces the earlier link; expired links die", async () => {
    const owner = await createUser();
    const first = await createInvite(owner.scope, { email: "p@example.com", role: "member" });
    const second = await createInvite(owner.scope, { email: "p@example.com", role: "member" });
    const pending = await listInvites(owner.scope);
    expect(pending).toHaveLength(1);
    await expect(getInviteInfo(new URL(first.link).searchParams.get("token")!)).rejects.toMatchObject({ status: 404 });

    const api = await invitesGet(req("GET", "/api/v1/workspaces/current/invites", { headers: owner.bearer }));
    expect((await api.json()).data.invites).toHaveLength(1);

    await Invite.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(getInviteInfo(new URL(second.link).searchParams.get("token")!)).rejects.toMatchObject({ status: 404 });
  });

  it("invites are creatable and listable over the API, and members get 403", async () => {
    const owner = await createUser();
    const member = await addMember(owner, "m@example.com", "Mia");
    const ok = await invitesPost(req("POST", "/api/v1/workspaces/current/invites", { headers: owner.bearer, body: { email: "z@example.com" } }));
    expect(ok.status).toBe(201);
    expect((await ok.json()).data.invite.link).toContain("/invite?token=");
    const denied = await invitesPost(req("POST", "/api/v1/workspaces/current/invites", { headers: member.bearer, body: { email: "y@example.com" } }));
    expect(denied.status).toBe(403);
    expect((await invitesGet(req("GET", "/api/v1/workspaces/current/invites", { headers: member.bearer }))).status).toBe(403);
  });

  it("acceptInvite cannot be replayed to escalate", async () => {
    const owner = await createUser();
    const { link } = await createInvite(owner.scope, { email: "j@example.com", role: "member" });
    const token = new URL(link).searchParams.get("token")!;
    const j = await createUser("j@example.com", "J");
    await acceptInvite(j.userId, token);
    await expect(acceptInvite(j.userId, token)).rejects.toMatchObject({ status: 404 });
  });
});

describe("workspaces: sharing and permissions", () => {
  it("teammates see each other's files, links, batches, stats and exports, with uploader names", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    const a = (await uploadOne(owner.scope, "owner-doc.pdf", 101)).file;
    const b = (await uploadOne(member.scope, "member-doc.pdf", 202)).file;

    const asOwner = await listFiles(owner.scope, q);
    const asMember = await listFiles(member.scope, q);
    expect(asOwner.items.map((f) => f.displayName).sort()).toEqual(["member-doc.pdf", "owner-doc.pdf"]);
    expect(asMember.items).toHaveLength(2);
    expect(asMember.items.find((f) => f.id === b.id)!.uploadedBy.name).toBe("Mia");
    expect(asMember.items.find((f) => f.id === a.id)!.uploadedBy.name).toBe("Olive");

    expect((await listLinks(member.scope, q)).items).toHaveLength(2);
    expect((await bulkCopyData(member.scope, { all: true })).count).toBe(2);
    expect((await collectExportRows(member.scope, { includeAll: false })).length).toBe(2);
    expect((await getOverview(member.scope, 7)).totals).toMatchObject({ totalPdfs: 2, activeLinks: 2 });
    expect((await listBatches(owner.scope, { page: 1, pageSize: 10 })).items).toHaveLength(2);
    expect((await getBatch(owner.scope, b.batchId)).files[0].uploadedBy.name).toBe("Mia");
  });

  it("members may only change their own files; admins and the owner may change anything", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    const admin = await addMember(owner, "a@example.com", "Abe", "admin");
    const ownerFile = (await uploadOne(owner.scope, "owner.pdf", 101)).file;
    const memberFile = (await uploadOne(member.scope, "mine.pdf", 102)).file;

    expect(await getFile(member.scope, ownerFile.id)).toMatchObject({ canManage: false });
    expect(await getFile(member.scope, memberFile.id)).toMatchObject({ canManage: true });
    expect(await getFile(admin.scope, memberFile.id)).toMatchObject({ canManage: true });

    await expect(renameFile(member.scope, ownerFile.id, "x")).rejects.toMatchObject({ status: 403 });
    await expect(revokeLink(member.scope, ownerFile.id)).rejects.toMatchObject({ status: 403 });
    await expect(deleteFile(member.scope, ownerFile.id)).rejects.toMatchObject({ status: 403 });
    expect(await FileModel.countDocuments({})).toBe(2);

    // own file: everything works
    await renameFile(member.scope, memberFile.id, "renamed.pdf");
    await revokeLink(member.scope, memberFile.id);
    await restoreLink(member.scope, memberFile.id);

    // admin can manage the member's file, and the owner can manage everything
    await revokeLink(admin.scope, memberFile.id);
    await expect(restoreLink(owner.scope, memberFile.id)).resolves.toMatchObject({ isPublic: true });
    await expect(deleteFile(admin.scope, ownerFile.id)).resolves.toBeTruthy();
  });

  it("bulk delete removes what you may, and reports the rest as failed", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    const o1 = (await uploadOne(owner.scope, "o1.pdf", 101)).file;
    const m1 = (await uploadOne(member.scope, "m1.pdf", 102)).file;
    const out = await bulkDeleteFiles(member.scope, [o1.id, m1.id]);
    expect(out.deleted).toEqual([m1.id]);
    expect(out.failed).toEqual([{ id: o1.id, error: expect.stringMatching(/only delete files you uploaded/) }]);
    expect(await FileModel.countDocuments({})).toBe(1);
    expect(mem().objects.size).toBe(1);
    const all = await bulkDeleteFiles(owner.scope, [o1.id]);
    expect(all.deleted).toEqual([o1.id]);
  });

  it("upload operations stay with the uploader: nobody else can complete, cancel or extend an upload", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    const init = await initiateUploads(member.scope, { files: [{ name: "a.pdf", size: 100, type: "application/pdf" }], allowDuplicates: false });
    const r = init.results[0];
    if (r.status !== "ready") throw new Error();
    await expect(completeUpload(owner.scope, { fileId: r.file.id })).rejects.toMatchObject({ status: 404 });
    await expect(cancelUpload(owner.scope, r.file.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      initiateUploads(owner.scope, { batchId: init.batchId, files: [{ name: "x.pdf", size: 10, type: "application/pdf" }], allowDuplicates: false }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("duplicate detection spans the whole team", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    await uploadOne(owner.scope, "shared-name.pdf", 777);
    const out = await initiateUploads(member.scope, { files: [{ name: "shared-name.pdf", size: 777, type: "application/pdf" }], allowDuplicates: false });
    expect(out.results[0]).toMatchObject({ status: "rejected", code: "DUPLICATE" });
  });

  it("outsiders (other workspaces) see nothing, including through the API", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const outsider = await createUser("x@example.com", "Xena");
    const f = (await uploadOne(owner.scope, "secret.pdf")).file;
    expect((await listFiles(outsider.scope, q)).items).toHaveLength(0);
    await expect(getFile(outsider.scope, f.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteFile(outsider.scope, f.id)).rejects.toMatchObject({ status: 404 });
    await expect(getBatch(outsider.scope, f.batchId)).rejects.toMatchObject({ status: 404 });
    // even a forged scope pointing at the other workspace with a *member* role is not enough via the API:
    const viaApi = await filesGet(req("GET", "/api/v1/files", { headers: outsider.bearer }));
    expect((await viaApi.json()).data).toHaveLength(0);
  });
});

describe("workspaces: member management", () => {
  it("lists members with roles; owner promotes; admins cannot touch the owner", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    const members = await listMembers(owner.scope);
    expect(members.map((m) => [m.name, m.role])).toEqual([["Olive", "owner"], ["Mia", "member"]]);

    await changeMemberRole(owner.scope, member.userId, "admin");
    const asAdmin: Scope = { ...member.scope, wsRole: "admin" };
    await expect(changeMemberRole(asAdmin, owner.userId, "member")).rejects.toMatchObject({ status: 403 });
    await expect(removeMember(asAdmin, owner.userId)).rejects.toMatchObject({ status: 400 });
    await expect(changeMemberRole(asAdmin, member.userId, "owner")).rejects.toMatchObject({ status: 403 });
  });

  it("a member cannot manage roles", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    const res = await memberPatch(
      req("PATCH", `/api/v1/workspaces/current/members/${owner.userId}`, { headers: member.bearer, body: { role: "member" } }),
      ctx({ userId: owner.userId }),
    );
    expect(res.status).toBe(403);
  });

  it("removing a member cuts access immediately and their session falls back to another workspace", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    await uploadOne(owner.scope, "team.pdf");
    expect((await (await filesGet(req("GET", "/api/v1/files", { headers: member.bearer }))).json()).data).toHaveLength(1);

    const res = await memberDelete(req("DELETE", `/api/v1/workspaces/current/members/${member.userId}`, { headers: owner.bearer }), ctx({ userId: member.userId }));
    expect(res.status).toBe(200);

    // same token, next request: no longer sees the team's files; self-healed into a fresh personal workspace
    const after = await (await filesGet(req("GET", "/api/v1/files", { headers: member.bearer }))).json();
    expect(after.data).toHaveLength(0);
    const me = await (await meRoute(req("GET", "/api/v1/auth/me", { headers: member.bearer }))).json();
    expect(me.data.workspace.id).not.toBe(owner.workspaceId);
    expect(me.data.workspace.role).toBe("owner");
  });

  it("transfers ownership, then the old owner may leave", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    await expect(removeMember(owner.scope, owner.userId)).rejects.toMatchObject({ status: 400 }); // owners cannot leave
    await changeMemberRole(owner.scope, member.userId, "owner");
    const ws = await Workspace.findById(owner.workspaceId);
    expect(String(ws!.ownerId)).toBe(member.userId);
    const roles = Object.fromEntries((await listMembers(member.scope)).map((m) => [m.name, m.role]));
    expect(roles).toEqual({ Olive: "admin", Mia: "owner" });
    await expect(removeMember({ ...owner.scope, wsRole: "admin" }, owner.userId)).resolves.toBeTruthy();
  });

  it("members can leave on their own; admins cannot remove other admins", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const m1 = await addMember(owner, "m@example.com", "Mia");
    const a1 = await addMember(owner, "a@example.com", "Abe", "admin");
    const a2 = await addMember(owner, "b@example.com", "Bea", "admin");
    await expect(removeMember(a1.scope, a2.userId)).rejects.toMatchObject({ status: 403 });
    await expect(removeMember(m1.scope, owner.userId)).rejects.toMatchObject({ status: 400 });
    await expect(removeMember(m1.scope, m1.userId)).resolves.toBeTruthy();
    expect(await Membership.countDocuments({ workspaceId: owner.workspaceId })).toBe(3);
  });
});

describe("workspaces: account deletion", () => {
  it("is blocked for owners of shared workspaces until ownership is transferred", async () => {
    const owner = await createUser("o@example.com", "Olive");
    await addMember(owner, "m@example.com", "Mia");
    await expect(deleteAccount(owner.userId, "Passw0rd!x")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Transfer ownership/) });
  });

  it("a departing member leaves; their uploads stay with the team as 'Former member'", async () => {
    const owner = await createUser("o@example.com", "Olive");
    const member = await addMember(owner, "m@example.com", "Mia");
    const f = (await uploadOne(member.scope, "keepme.pdf")).file;
    await deleteAccount(member.userId, "Passw0rd!x");
    const left = await getFile(owner.scope, f.id);
    expect(left.uploadedBy.name).toBe("Former member");
    expect(mem().objects.size).toBe(1);
    expect(await Membership.countDocuments({ userId: member.userId })).toBe(0);
  });

  it("deletes a sole-owner workspace with its files, invites and memberships", async () => {
    const a = await createUser();
    await uploadOne(a.scope, "x.pdf");
    await createInvite(a.scope, { email: "p@example.com", role: "member" });
    await deleteAccount(a.userId, "Passw0rd!x");
    expect(mem().objects.size).toBe(0);
    expect(await Workspace.countDocuments({})).toBe(0);
    expect(await Invite.countDocuments({})).toBe(0);
    expect(await FileModel.countDocuments({})).toBe(0);
  });
});

describe("workspaces: misc", () => {
  it("createWorkspace gives the creator an owner membership", async () => {
    const a = await createUser();
    const ws = await createWorkspace(a.userId, "Second");
    const m = await Membership.findOne({ workspaceId: ws._id, userId: a.userId });
    expect(m!.role).toBe("owner");
  });
});
