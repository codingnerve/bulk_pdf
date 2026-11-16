import { Schema, model, models, type Model, type Types } from "mongoose";
import type { WorkspaceRole } from "./Membership";

export interface IInvite {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  tokenHash: string;
  invitedBy: Types.ObjectId;
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
}

const InviteSchema = new Schema<IInvite>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
InviteSchema.index({ workspaceId: 1, email: 1 });
InviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Invite: Model<IInvite> =
  (models.Invite as Model<IInvite>) || model<IInvite>("Invite", InviteSchema);
