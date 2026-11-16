import { Schema, model, models, type Model, type Types } from "mongoose";

export interface IPasswordReset {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
}

const PasswordResetSchema = new Schema<IPasswordReset>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: false },
);
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordReset: Model<IPasswordReset> =
  (models.PasswordReset as Model<IPasswordReset>) ||
  model<IPasswordReset>("PasswordReset", PasswordResetSchema);
