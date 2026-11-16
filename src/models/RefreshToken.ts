import { Schema, model, models, type Model, type Types } from "mongoose";

/** One document per issued refresh token. `familyId` identifies the login session. */
export interface IRefreshToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  familyId: string;
  /** Workspace this login session is currently working in. */
  workspaceId?: Types.ObjectId;
  tokenHash: string;
  client: "web" | "extension";
  label?: string;
  expiresAt: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    familyId: { type: String, required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
    tokenHash: { type: String, required: true, unique: true },
    client: { type: String, enum: ["web", "extension"], required: true },
    label: { type: String, maxlength: 200 },
    expiresAt: { type: Date, required: true },
    rotatedAt: { type: Date },
    revokedAt: { type: Date },
    lastUsedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken: Model<IRefreshToken> =
  (models.RefreshToken as Model<IRefreshToken>) ||
  model<IRefreshToken>("RefreshToken", RefreshTokenSchema);
