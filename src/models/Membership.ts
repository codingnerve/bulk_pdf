import { Schema, model, models, type Model, type Types } from "mongoose";

export const ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof ROLES)[number];

export interface IMembership {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: WorkspaceRole;
  createdAt: Date;
}

const MembershipSchema = new Schema<IMembership>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ROLES, default: "member" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
MembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
MembershipSchema.index({ userId: 1, createdAt: 1 });

export const Membership: Model<IMembership> =
  (models.Membership as Model<IMembership>) || model<IMembership>("Membership", MembershipSchema);
