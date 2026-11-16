import { Schema, model, models, type Model, type Types } from "mongoose";

export interface IUserSettings {
  maxFileSizeMb?: number;
  maxFilesPerBatch?: number;
  uploadConcurrency?: number;
  defaultPublic: boolean;
  contentDisposition: "inline" | "attachment";
}

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: "user" | "admin";
  settings: IUserSettings;
  /** Remembered across logins. */
  lastWorkspaceId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    lastWorkspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
    settings: {
      maxFileSizeMb: { type: Number, min: 1 },
      maxFilesPerBatch: { type: Number, min: 1 },
      uploadConcurrency: { type: Number, min: 1, max: 16 },
      defaultPublic: { type: Boolean, default: true },
      contentDisposition: { type: String, enum: ["inline", "attachment"], default: "inline" },
    },
  },
  { timestamps: true },
);

export const User: Model<IUser> = (models.User as Model<IUser>) || model<IUser>("User", UserSchema);
