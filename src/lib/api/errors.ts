export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const Errors = {
  badRequest: (msg = "Bad request", details?: unknown) =>
    new ApiError(400, "BAD_REQUEST", msg, details),
  validation: (details: unknown, msg = "Validation failed") =>
    new ApiError(400, "VALIDATION_ERROR", msg, details),
  unauthorized: (msg = "Authentication required") => new ApiError(401, "UNAUTHORIZED", msg),
  forbidden: (msg = "You do not have access to this resource") =>
    new ApiError(403, "FORBIDDEN", msg),
  notFound: (msg = "Resource not found") => new ApiError(404, "NOT_FOUND", msg),
  conflict: (msg: string, details?: unknown) => new ApiError(409, "CONFLICT", msg, details),
  tooLarge: (msg: string) => new ApiError(413, "PAYLOAD_TOO_LARGE", msg),
  rateLimited: (retryAfterSec: number) =>
    new ApiError(429, "RATE_LIMITED", "Too many requests. Please slow down.", undefined, {
      "Retry-After": String(retryAfterSec),
    }),
  storage: (msg = "Cloud storage error. Please try again.") =>
    new ApiError(502, "STORAGE_ERROR", msg),
  unavailable: (msg = "Service temporarily unavailable") =>
    new ApiError(503, "SERVICE_UNAVAILABLE", msg),
};
