import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "./errors";

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}
export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T, meta?: Record<string, unknown>, init?: ResponseInit) {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  return NextResponse.json(body, init);
}

export function created<T>(data: T) {
  return ok(data, undefined, { status: 201 });
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers?: Record<string, string>,
) {
  const body: ApiFailure = {
    success: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  return NextResponse.json(body, { status, headers });
}

/** Central error → response mapping used by every route. */
export function errorToResponse(err: unknown) {
  if (err instanceof ApiError) {
    return fail(err.status, err.code, err.message, err.details, err.headers);
  }
  if (err instanceof ZodError) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Validation failed",
      err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const e = err as { code?: number; name?: string; message?: string };
  if (e?.code === 11000) return fail(409, "CONFLICT", "A record with these details already exists");
  if (e?.name === "CastError") return fail(400, "BAD_REQUEST", "Invalid identifier");
  if (
    e?.name === "MongoServerSelectionError" ||
    e?.name === "MongooseServerSelectionError" ||
    e?.name === "MongoNetworkError"
  ) {
    console.error("[db] unavailable:", e.message);
    return fail(503, "SERVICE_UNAVAILABLE", "Database is temporarily unavailable");
  }
  console.error("[api] unhandled error:", err);
  return fail(500, "INTERNAL_ERROR", "Something went wrong on our side");
}
