import "server-only";
import { Types } from "mongoose";
import { Workspace } from "@/models/Workspace";
import { Membership, type WorkspaceRole } from "@/models/Membership";
import { Invite } from "@/models/Invite";
import { User } from "@/models/User";
import { RefreshToken } from "@/models/RefreshToken";
import { Errors } from "@/lib/api/errors";
import { generateOpaqueToken, hashToken } from "@/lib/auth/tokens";
import { requireAdmin, type Scope } from "@/lib/auth/scope";
import { getEnv } from "@/lib/env";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
  current: boolean;
}

/** Creates a workspace with the user as its owner. */
export async function createWorkspace(userId: string, name: string) {
  const ws = await Workspace.create({ name, ownerId: userId });
  await Membership.create({ workspaceId: ws._id, userId, role: "owner" });
  return ws;
}

export function personalWorkspaceName(userName: string) {
  const first = userName.trim().split(/\s+/)[0] || "My";
  return `${first}'s workspace`;
}

/**
 * Which workspace is this login session working in? Honors the session's choice while the
 * user is still a member; otherwise falls back to the last used / oldest workspace.
 */
export async function resolveSessionWorkspace(
  userId: string,
  familyId: string,
  hint?: Types.ObjectId | string | null,
): Promise<{ workspaceId: string; role: WorkspaceRole }> {
  if (hint) {
    const m = await Membership.findOne({ userId, workspaceId: hint }).select("role").lean();
    if (m) return { workspaceId: String(hint), role: m.role };
  }
  const user = await User.findById(userId).select("lastWorkspaceId name").lean();
  if (!user) throw Errors.unauthorized();
  let m = user.lastWorkspaceId
    ? await Membership.findOne({ userId, workspaceId: user.lastWorkspaceId }).lean()
    : null;
  m ??= await Membership.findOne({ userId }).sort({ createdAt: 1 }).lean();
  if (!m) {
    // Self-heal: every user must belong to at least one workspace.
    const ws = await createWorkspace(userId, personalWorkspaceName(user.name));
    m = await Membership.findOne({ userId, workspaceId: ws._id }).lean();
  }
  await RefreshToken.updateMany({ familyId }, { $set: { workspaceId: m!.workspaceId } });
  return { workspaceId: String(m!.workspaceId), role: m!.role };
}

export async function listMyWorkspaces(scope: Scope): Promise<WorkspaceSummary[]> {
  const memberships = await Membership.find({ userId: scope.userId }).sort({ createdAt: 1 }).lean();
  const ids = memberships.map((m) => m.workspaceId);
  const [workspaces, counts] = await Promise.all([
    Workspace.find({ _id: { $in: ids } }).lean(),
    Membership.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { workspaceId: { $in: ids } } },
      { $group: { _id: "$workspaceId", n: { $sum: 1 } } },
    ]),
  ]);
  const byId = new Map(workspaces.map((w) => [String(w._id), w]));
  const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
  return memberships
    .filter((m) => byId.has(String(m.workspaceId)))
    .map((m) => ({
      id: String(m.workspaceId),
      name: byId.get(String(m.workspaceId))!.name,
      role: m.role,
      memberCount: countBy.get(String(m.workspaceId)) ?? 1,
      current: String(m.workspaceId) === scope.workspaceId,
    }));
}

export async function switchWorkspace(userId: string, familyId: string, workspaceId: string) {
  const m = await Membership.findOne({ userId, workspaceId }).lean();
  if (!m) throw Errors.notFound("Workspace not found");
  await RefreshToken.updateMany({ familyId }, { $set: { workspaceId } });
  await User.updateOne({ _id: userId }, { $set: { lastWorkspaceId: workspaceId } });
  return { workspaceId, role: m.role };
}

export async function getCurrentWorkspace(scope: Scope) {
  const ws = await Workspace.findById(scope.workspaceId).lean();
  if (!ws) throw Errors.notFound("Workspace not found");
  const memberCount = await Membership.countDocuments({ workspaceId: scope.workspaceId });
  return { id: String(ws._id), name: ws.name, role: scope.wsRole, memberCount, createdAt: ws.createdAt };
}

export async function renameWorkspace(scope: Scope, name: string) {
  requireAdmin(scope);
  await Workspace.updateOne({ _id: scope.workspaceId }, { $set: { name } });
  return getCurrentWorkspace(scope);
}

export async function listMembers(scope: Scope) {
  const members = await Membership.find({ workspaceId: scope.workspaceId }).sort({ createdAt: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } })
    .select("name email")
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return members.map((m) => {
    const u = byId.get(String(m.userId));
    return {
      userId: String(m.userId),
      name: u?.name ?? "Unknown",
      email: u?.email ?? "",
      role: m.role,
      joinedAt: m.createdAt,
      you: String(m.userId) === scope.userId,
    };
  });
}

/**
 * Role rules: the owner can do anything (including transferring ownership);
 * admins can move others between member and admin but never touch the owner.
 */
export async function changeMemberRole(scope: Scope, targetUserId: string, role: WorkspaceRole) {
  requireAdmin(scope);
  const target = await Membership.findOne({ workspaceId: scope.workspaceId, userId: targetUserId });
  if (!target) throw Errors.notFound("Member not found");
  if (target.role === "owner" && scope.wsRole !== "owner") {
    throw Errors.forbidden("Only the owner can change the owner's role");
  }
  if (role === "owner") {
    if (scope.wsRole !== "owner") throw Errors.forbidden("Only the owner can transfer ownership");
    if (targetUserId !== scope.userId) {
      await Membership.updateOne({ workspaceId: scope.workspaceId, userId: scope.userId }, { $set: { role: "admin" } });
      await Workspace.updateOne({ _id: scope.workspaceId }, { $set: { ownerId: targetUserId } });
      target.role = "owner";
      await target.save();
    }
  } else {
    if (target.role === "owner") throw Errors.badRequest("Transfer ownership to another member first");
    if (scope.wsRole !== "owner" && (role === "admin" || target.role === "admin")) {
      throw Errors.forbidden("Only the owner can promote or demote admins");
    }
    target.role = role;
    await target.save();
  }
  return { updated: targetUserId, role };
}

/** Removes a member, or lets someone leave (targetUserId === scope.userId). */
export async function removeMember(scope: Scope, targetUserId: string) {
  const target = await Membership.findOne({ workspaceId: scope.workspaceId, userId: targetUserId });
  if (!target) throw Errors.notFound("Member not found");
  const self = targetUserId === scope.userId;
  if (target.role === "owner") {
    throw Errors.badRequest(self ? "Transfer ownership before leaving this workspace" : "The owner cannot be removed");
  }
  if (!self) {
    requireAdmin(scope);
    if (target.role === "admin" && scope.wsRole !== "owner") {
      throw Errors.forbidden("Only the owner can remove an admin");
    }
  }
  await Membership.deleteOne({ _id: target._id });
  // Their sessions fall back to another workspace on the next request.
  return { removed: targetUserId };
}

export async function createInvite(scope: Scope, input: { email: string; role: "admin" | "member" }) {
  requireAdmin(scope);
  if (input.role === "admin" && scope.wsRole !== "owner") {
    throw Errors.forbidden("Only the owner can invite admins");
  }
  const existingUser = await User.findOne({ email: input.email }).select("_id").lean();
  if (existingUser && (await Membership.exists({ workspaceId: scope.workspaceId, userId: existingUser._id }))) {
    throw Errors.conflict("This person is already a member");
  }
  await Invite.deleteMany({ workspaceId: scope.workspaceId, email: input.email, acceptedAt: { $exists: false } });
  const { token, hash } = generateOpaqueToken();
  const invite = await Invite.create({
    workspaceId: scope.workspaceId,
    email: input.email,
    role: input.role,
    tokenHash: hash,
    invitedBy: scope.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  const link = `${getEnv().APP_URL.replace(/\/$/, "")}/invite?token=${token}`;
  // No mail provider is configured: the admin shares this link with the invitee.
  return { id: String(invite._id), email: invite.email, role: invite.role, expiresAt: invite.expiresAt, link };
}

export async function listInvites(scope: Scope) {
  requireAdmin(scope);
  const invites = await Invite.find({
    workspaceId: scope.workspaceId,
    acceptedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();
  return invites.map((i) => ({
    id: String(i._id),
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt,
    createdAt: i.createdAt,
  }));
}

export async function revokeInvite(scope: Scope, inviteId: string) {
  requireAdmin(scope);
  const res = await Invite.deleteOne({ _id: inviteId, workspaceId: scope.workspaceId });
  if (!res.deletedCount) throw Errors.notFound("Invite not found");
  return { revoked: inviteId };
}

async function findValidInvite(token: string) {
  const invite = await Invite.findOne({
    tokenHash: hashToken(token),
    acceptedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  if (!invite) throw Errors.notFound("This invitation is invalid or has expired");
  return invite;
}

/** Public: what is this invite for? (lets the invite page greet the visitor) */
export async function getInviteInfo(token: string) {
  const invite = await findValidInvite(token);
  const [ws, inviter] = await Promise.all([
    Workspace.findById(invite.workspaceId).select("name").lean(),
    User.findById(invite.invitedBy).select("name").lean(),
  ]);
  return {
    workspaceName: ws?.name ?? "a workspace",
    email: invite.email,
    role: invite.role,
    invitedBy: inviter?.name ?? "A teammate",
  };
}

/** Joins the workspace. The signed-in user's email must match the invited address. */
export async function acceptInvite(userId: string, token: string) {
  const invite = await findValidInvite(token);
  const user = await User.findById(userId).select("email").lean();
  if (!user || user.email !== invite.email) {
    throw Errors.forbidden(`This invitation was sent to ${invite.email}. Sign in with that address to accept it.`);
  }
  const claimed = await Invite.findOneAndUpdate(
    { _id: invite._id, acceptedAt: { $exists: false } },
    { $set: { acceptedAt: new Date() } },
  );
  if (!claimed) throw Errors.notFound("This invitation is invalid or has expired");
  await Membership.updateOne(
    { workspaceId: invite.workspaceId, userId },
    { $setOnInsert: { role: invite.role } },
    { upsert: true },
  );
  await User.updateOne({ _id: userId }, { $set: { lastWorkspaceId: invite.workspaceId } });
  return { workspaceId: String(invite.workspaceId) };
}
