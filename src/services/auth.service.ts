import "server-only";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { User, type IUser } from "@/models/User";
import { RefreshToken } from "@/models/RefreshToken";
import { PasswordReset } from "@/models/PasswordReset";
import { Errors } from "@/lib/api/errors";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  ACCESS_TTL_SEC,
  REFRESH_TTL_SEC,
  generateOpaqueToken,
  hashToken,
  signAccessToken,
} from "@/lib/auth/tokens";
import { getEnv } from "@/lib/env";
import { acceptInvite, createWorkspace, getInviteInfo, personalWorkspaceName } from "./workspace.service";

export type ClientKind = "web" | "extension";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  createdAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
}

export const toPublicUser = (u: IUser): PublicUser => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  createdAt: u.createdAt,
});

const REFRESH_GRACE_MS = 10_000;

async function issueTokens(
  user: Pick<IUser, "_id" | "role">,
  client: ClientKind,
  opts: { familyId?: string; label?: string; workspaceId?: Types.ObjectId | string } = {},
): Promise<TokenPair & { familyId: string }> {
  const familyId = opts.familyId ?? randomUUID();
  const { token, hash } = generateOpaqueToken();
  await RefreshToken.create({
    userId: user._id,
    familyId,
    workspaceId: opts.workspaceId,
    tokenHash: hash,
    client,
    label: opts.label,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
  });
  const accessToken = await signAccessToken({
    sub: String(user._id),
    role: user.role,
    sid: familyId,
  });
  return {
    accessToken,
    refreshToken: token,
    expiresIn: ACCESS_TTL_SEC,
    tokenType: "Bearer",
    familyId,
  };
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
  client: ClientKind;
  deviceLabel?: string;
  inviteToken?: string;
}) {
  if (input.inviteToken) {
    // Fail before creating anything if the invitation is unusable for this email.
    const info = await getInviteInfo(input.inviteToken);
    if (info.email !== input.email) {
      throw Errors.badRequest(`This invitation was sent to ${info.email}. Register with that email address.`);
    }
  }
  const existing = await User.exists({ email: input.email });
  if (existing) throw Errors.conflict("An account with this email already exists");
  const passwordHash = await hashPassword(input.password);
  let user;
  try {
    user = await User.create({ name: input.name, email: input.email, passwordHash });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      throw Errors.conflict("An account with this email already exists");
    }
    throw e;
  }
  // Invitees join the inviting workspace; everyone else gets a personal workspace.
  let workspaceId: string;
  if (input.inviteToken) {
    workspaceId = (await acceptInvite(String(user._id), input.inviteToken)).workspaceId;
  } else {
    workspaceId = String((await createWorkspace(String(user._id), personalWorkspaceName(user.name)))._id);
  }
  const tokens = await issueTokens(user, input.client, { label: input.deviceLabel, workspaceId });
  return { user: toPublicUser(user), tokens };
}

export async function loginUser(input: {
  email: string;
  password: string;
  client: ClientKind;
  deviceLabel?: string;
}) {
  const user = await User.findOne({ email: input.email }).select("+passwordHash");
  if (!user) {
    await burnPasswordCheck(input.password);
    throw Errors.unauthorized("Invalid email or password");
  }
  const okPw = await verifyPassword(input.password, user.passwordHash);
  if (!okPw) throw Errors.unauthorized("Invalid email or password");
  const tokens = await issueTokens(user, input.client, { label: input.deviceLabel });
  return { user: toPublicUser(user), tokens };
}

/** Rotates a refresh token. Re-use of an already-rotated token revokes the whole session. */
export async function refreshSession(rawToken: string) {
  const doc = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
  if (!doc || doc.revokedAt || doc.expiresAt.getTime() < Date.now()) {
    throw Errors.unauthorized("Session expired. Please sign in again.");
  }
  if (doc.rotatedAt) {
    if (Date.now() - doc.rotatedAt.getTime() > REFRESH_GRACE_MS) {
      await revokeFamily(doc.familyId); // token theft / replay – kill the session
    }
    throw Errors.unauthorized("Session expired. Please sign in again.");
  }
  // Atomic claim so two concurrent refreshes cannot both succeed.
  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: doc._id, rotatedAt: { $exists: false } },
    { $set: { rotatedAt: new Date(), lastUsedAt: new Date() } },
  );
  if (!claimed) throw Errors.unauthorized("Session expired. Please sign in again.");

  const user = await User.findById(doc.userId);
  if (!user) {
    await revokeFamily(doc.familyId);
    throw Errors.unauthorized("Account no longer exists");
  }
  const tokens = await issueTokens(user, doc.client, {
    familyId: doc.familyId,
    label: doc.label,
    workspaceId: doc.workspaceId,
  });
  return { user: toPublicUser(user), tokens };
}

export async function revokeFamily(familyId: string) {
  await RefreshToken.updateMany(
    { familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

export async function logout(opts: {
  sessionId?: string;
  refreshToken?: string;
  userId?: string;
  allDevices?: boolean;
}) {
  if (opts.allDevices && opts.userId) {
    await RefreshToken.updateMany(
      { userId: opts.userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
    return;
  }
  let familyId = opts.sessionId;
  if (!familyId && opts.refreshToken) {
    const doc = await RefreshToken.findOne({ tokenHash: hashToken(opts.refreshToken) })
      .select("familyId")
      .lean();
    familyId = doc?.familyId;
  }
  if (familyId) await revokeFamily(familyId);
}

export async function getUserById(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw Errors.notFound("User not found");
  return user;
}

export async function listSessions(userId: string, currentSessionId?: string) {
  const docs = await RefreshToken.find({
    userId,
    revokedAt: { $exists: false },
    rotatedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return docs.map((d) => ({
    id: d.familyId,
    client: d.client,
    label: d.label ?? null,
    createdAt: d.createdAt,
    lastUsedAt: d.lastUsedAt ?? null,
    current: d.familyId === currentSessionId,
  }));
}

export async function revokeSession(userId: string, familyId: string) {
  const owned = await RefreshToken.exists({ userId, familyId });
  if (!owned) throw Errors.notFound("Session not found");
  await revokeFamily(familyId);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, keepSessionId?: string) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw Errors.notFound("User not found");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw Errors.badRequest("Current password is incorrect");
  }
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  // Sign out every other device.
  await RefreshToken.updateMany(
    {
      userId,
      revokedAt: { $exists: false },
      ...(keepSessionId ? { familyId: { $ne: keepSessionId } } : {}),
    },
    { $set: { revokedAt: new Date() } },
  );
}

const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Creates a reset token. Delivery is pluggable: with no mail transport configured the link
 * is written to the server log (development). Always resolves, to avoid account enumeration.
 */
export async function requestPasswordReset(email: string): Promise<{ devLink?: string }> {
  const user = await User.findOne({ email });
  if (!user) return {};
  const { token, hash } = generateOpaqueToken();
  await PasswordReset.create({
    userId: user._id,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  const link = `${getEnv().APP_URL.replace(/\/$/, "")}/reset-password?token=${token}`;
  await deliverResetLink(user.email, link);
  return process.env.NODE_ENV === "production" ? {} : { devLink: link };
}

async function deliverResetLink(email: string, link: string) {
  // Hook point: send through your email provider here (Resend, SES, SMTP ...).
  console.info(`[auth] Password reset link for ${email}: ${link}`);
}

export async function resetPassword(token: string, newPassword: string) {
  const reset = await PasswordReset.findOne({
    tokenHash: hashToken(token),
    usedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  if (!reset) throw Errors.badRequest("This reset link is invalid or has expired");
  const claimed = await PasswordReset.findOneAndUpdate(
    { _id: reset._id, usedAt: { $exists: false } },
    { $set: { usedAt: new Date() } },
  );
  if (!claimed) throw Errors.badRequest("This reset link is invalid or has expired");
  await User.updateOne({ _id: reset.userId }, { $set: { passwordHash: await hashPassword(newPassword) } });
  await RefreshToken.updateMany(
    { userId: reset.userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

export const asObjectId = (id: string) => new Types.ObjectId(id);
