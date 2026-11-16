import { Schema, model, models, type Model, type Types } from "mongoose";

export interface IWorkspace {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export const Workspace: Model<IWorkspace> =
  (models.Workspace as Model<IWorkspace>) || model<IWorkspace>("Workspace", WorkspaceSchema);
