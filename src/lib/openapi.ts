/* OpenAPI 3.1 description of /api/v1. Served at /api/v1/openapi.json and rendered at /api/v1/docs. */

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const envelope = (data: Json) => ({
  type: "object",
  required: ["success", "data"],
  properties: { success: { const: true }, data, meta: { type: "object" } },
});
const jsonBody = (schema: Json) => ({ required: true, content: { "application/json": { schema } } });
const okJson = (description: string, data: Json) => ({
  description,
  content: { "application/json": { schema: envelope(data) } },
});
const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[a-f0-9]{24}$" },
};
const secured = [{ bearerAuth: [] }, { cookieAuth: [] }];
const errors = {
  "400": { $ref: "#/components/responses/ValidationError" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "404": { $ref: "#/components/responses/NotFound" },
  "429": { $ref: "#/components/responses/RateLimited" },
};
const op = (
  tag: string,
  summary: string,
  extra: Json = {},
  security: unknown = secured,
): Json => ({ tags: [tag], summary, security, responses: { ...errors }, ...extra });

const pageParams = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
];
const exportBody = jsonBody({
  type: "object",
  properties: {
    ids: { type: "array", items: { type: "string" }, description: "Export only these files" },
    batchId: { type: "string" },
    includeAll: { type: "boolean", default: false, description: "Include non-completed / revoked files" },
  },
});

export function buildOpenApi(serverUrl: string): Json {
  return {
    openapi: "3.1.0",
    info: {
      title: "PDFLinker API",
      version: "1.0.0",
      description:
        "Bulk PDF upload and public-link platform. Every client (website, future Chrome extension) uses " +
        "this API. File bytes are uploaded **directly to Cloudflare R2** with the presigned URLs returned by " +
        "`/uploads/initiate`; they never pass through this API.\n\n" +
        "**Auth:** web clients use HTTP-only cookies; extension/API clients log in with `client: \"extension\"` " +
        "and send `Authorization: Bearer <accessToken>`, refreshing via `/auth/refresh` (rotating refresh tokens, " +
        "revocable per device).\n\n" +
        "**Workspaces:** files belong to a workspace shared by its members. Members manage their own uploads; admins and the owner manage everything.\n\n" +
        "**Privacy:** anyone holding a public URL can read the PDF until it is revoked or deleted.",
    },
    servers: [{ url: serverUrl }],
    tags: ["Auth", "Workspaces", "Uploads", "Files", "Links", "Batches", "Exports", "Account"].map((name) => ({ name })),
    paths: {
      "/api/v1/auth/register": {
        post: op(
          "Auth",
          "Create an account",
          {
            requestBody: jsonBody(ref("Credentials")),
            responses: { "201": okJson("Account created", ref("AuthResult")), ...errors },
          },
          [],
        ),
      },
      "/api/v1/auth/login": {
        post: op(
          "Auth",
          "Sign in (cookies for web, tokens in body for extension)",
          {
            requestBody: jsonBody(ref("Credentials")),
            responses: { "200": okJson("Signed in", ref("AuthResult")), ...errors },
          },
          [],
        ),
      },
      "/api/v1/auth/refresh": {
        post: op(
          "Auth",
          "Rotate the refresh token",
          {
            requestBody: jsonBody({ type: "object", properties: { refreshToken: { type: "string" } } }),
            responses: { "200": okJson("New tokens", ref("AuthResult")), ...errors },
          },
          [],
        ),
      },
      "/api/v1/auth/logout": {
        post: op(
          "Auth",
          "Revoke the current session (or all with allDevices)",
          {
            requestBody: jsonBody({
              type: "object",
              properties: { refreshToken: { type: "string" }, allDevices: { type: "boolean" } },
            }),
          },
          [],
        ),
      },
      "/api/v1/auth/me": {
        get: op("Auth", "Current user", { responses: { "200": okJson("User", { type: "object", properties: { user: ref("User") } }), ...errors } }),
      },
      "/api/v1/auth/forgot-password": { post: op("Auth", "Request a password reset link", {}, []) },
      "/api/v1/auth/reset-password": { post: op("Auth", "Set a new password with a reset token", {}, []) },
      "/api/v1/auth/change-password": { post: op("Auth", "Change password (signs out other devices)") },
      "/api/v1/auth/sessions": { get: op("Auth", "List signed-in devices") },
      "/api/v1/auth/sessions/{id}": {
        delete: op("Auth", "Revoke one device", { parameters: [{ ...idParam, schema: { type: "string" } }] }),
      },
      "/api/v1/workspaces": {
        get: op("Workspaces", "Workspaces you belong to"),
        post: op("Workspaces", "Create a workspace (you become owner) and switch this session to it", {
          requestBody: jsonBody({ type: "object", required: ["name"], properties: { name: { type: "string" } } }),
        }),
      },
      "/api/v1/workspaces/active": {
        post: op("Workspaces", "Switch the active workspace for this login session / device", {
          requestBody: jsonBody({ type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } }),
        }),
      },
      "/api/v1/workspaces/current": {
        get: op("Workspaces", "Active workspace"),
        patch: op("Workspaces", "Rename the active workspace (admin)", {
          requestBody: jsonBody({ type: "object", required: ["name"], properties: { name: { type: "string" } } }),
        }),
      },
      "/api/v1/workspaces/current/members": { get: op("Workspaces", "Members of the active workspace") },
      "/api/v1/workspaces/current/members/{userId}": {
        patch: op("Workspaces", "Change a member's role (owner may transfer ownership)", {
          parameters: [{ ...idParam, name: "userId" }],
          requestBody: jsonBody({ type: "object", required: ["role"], properties: { role: { type: "string", enum: ["owner", "admin", "member"] } } }),
        }),
        delete: op("Workspaces", "Remove a member, or leave the workspace with your own id", { parameters: [{ ...idParam, name: "userId" }] }),
      },
      "/api/v1/workspaces/current/invites": {
        get: op("Workspaces", "Pending invitations (admin)"),
        post: op("Workspaces", "Create an invitation; returns a one-time link to share (admin)", {
          requestBody: jsonBody({
            type: "object",
            required: ["email"],
            properties: { email: { type: "string" }, role: { type: "string", enum: ["member", "admin"], default: "member" } },
          }),
        }),
      },
      "/api/v1/workspaces/current/invites/{id}": { delete: op("Workspaces", "Revoke an invitation (admin)", { parameters: [idParam] }) },
      "/api/v1/invites/{token}": {
        get: op("Workspaces", "Describe an invitation (public)", { parameters: [{ ...idParam, name: "token", schema: { type: "string" } }] }, []),
      },
      "/api/v1/invites/accept": {
        post: op("Workspaces", "Accept an invitation (signed-in email must match)", {
          requestBody: jsonBody({ type: "object", required: ["token"], properties: { token: { type: "string" } } }),
        }),
      },
      "/api/v1/uploads/initiate": {
        post: op("Uploads", "Validate files and get presigned upload URLs", {
          requestBody: jsonBody({
            type: "object",
            required: ["files"],
            properties: {
              batchId: { type: "string", description: "Add to an existing batch" },
              allowDuplicates: { type: "boolean", default: false },
              files: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "size", "type"],
                  properties: {
                    name: { type: "string" },
                    size: { type: "integer" },
                    type: { const: "application/pdf" },
                  },
                },
              },
            },
          }),
          description:
            "Files up to the multipart threshold get a single presigned PUT (send the returned headers). " +
            "Larger files get a multipart upload with one presigned URL per part; PUT each part and collect its `ETag` response header.",
          responses: { "201": okJson("Per-file results (ready / rejected)", ref("InitiateResult")), ...errors },
        }),
      },
      "/api/v1/uploads/complete": {
        post: op("Uploads", "Verify the upload and publish the public link", {
          requestBody: jsonBody({
            type: "object",
            required: ["fileId"],
            properties: {
              fileId: { type: "string" },
              parts: {
                type: "array",
                items: {
                  type: "object",
                  properties: { partNumber: { type: "integer" }, etag: { type: "string" } },
                },
              },
            },
          }),
          responses: { "200": okJson("Completed file", { type: "object", properties: { file: ref("File") } }), ...errors },
        }),
      },
      "/api/v1/uploads/cancel": {
        post: op("Uploads", "Cancel a pending upload and clean up storage", {
          requestBody: jsonBody({ type: "object", required: ["fileId"], properties: { fileId: { type: "string" } } }),
        }),
      },
      "/api/v1/uploads/{id}/status": { get: op("Uploads", "Upload status", { parameters: [idParam] }) },
      "/api/v1/uploads/{id}/refresh": {
        post: op("Uploads", "Re-issue presigned URLs (expired URL / resume)", { parameters: [idParam] }),
      },
      "/api/v1/uploads/cleanup": {
        post: op("Uploads", "Cron: abort abandoned uploads (Bearer CRON_SECRET)", {}, [{ cronSecret: [] }]),
      },
      "/api/v1/files": {
        get: op("Files", "List files", {
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Filename search" },
            { name: "status", in: "query", schema: { type: "string", enum: ["pending", "uploading", "processing", "completed", "failed", "cancelled"] } },
            { name: "visibility", in: "query", schema: { type: "string", enum: ["all", "public", "revoked"] } },
            { name: "from", in: "query", schema: { type: "string", format: "date" } },
            { name: "to", in: "query", schema: { type: "string", format: "date" } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["newest", "oldest"] } },
            ...pageParams,
          ],
        }),
      },
      "/api/v1/files/{id}": {
        get: op("Files", "Get a file", { parameters: [idParam] }),
        patch: op("Files", "Rename display name", {
          parameters: [idParam],
          requestBody: jsonBody({ type: "object", required: ["displayName"], properties: { displayName: { type: "string" } } }),
        }),
        delete: op("Files", "Delete a file from storage and database", { parameters: [idParam] }),
      },
      "/api/v1/files/{id}/download": {
        get: op("Files", "Presigned download URL (5 min)", { parameters: [idParam] }),
      },
      "/api/v1/files/bulk-delete": {
        post: op("Files", "Delete many files", {
          requestBody: jsonBody({ type: "object", required: ["ids"], properties: { ids: { type: "array", items: { type: "string" } } } }),
        }),
      },
      "/api/v1/links": { get: op("Links", "List active public links", { parameters: pageParams }) },
      "/api/v1/links/bulk-copy-data": {
        post: op("Links", "URLs for copy-to-clipboard", {
          requestBody: jsonBody({ type: "object", properties: { ids: { type: "array", items: { type: "string" } }, all: { type: "boolean" } } }),
        }),
      },
      "/api/v1/links/{id}/verify": { post: op("Links", "Check the link is reachable and serves a PDF", { parameters: [idParam] }) },
      "/api/v1/links/{id}/revoke": { post: op("Links", "Revoke public access (URL starts returning 404)", { parameters: [idParam] }) },
      "/api/v1/links/{id}/restore": { post: op("Links", "Restore public access at the original URL", { parameters: [idParam] }) },
      "/api/v1/batches": {
        get: op("Batches", "List upload batches (history)", { parameters: pageParams }),
        post: op("Batches", "Create an empty batch"),
      },
      "/api/v1/batches/{id}": {
        get: op("Batches", "Batch with its files", { parameters: [{ ...idParam, schema: { type: "string" } }] }),
      },
      "/api/v1/exports/csv": { post: op("Exports", "Export links as CSV", { requestBody: exportBody }) },
      "/api/v1/exports/xlsx": { post: op("Exports", "Export links as Excel", { requestBody: exportBody }) },
      "/api/v1/exports/txt": { post: op("Exports", "Export one URL per line", { requestBody: exportBody }) },
      "/api/v1/stats": { get: op("Account", "Dashboard statistics") },
      "/api/v1/config": { get: op("Account", "Effective upload limits for the current user") },
      "/api/v1/settings": {
        get: op("Account", "Profile and settings"),
        patch: op("Account", "Update profile and settings"),
      },
      "/api/v1/account": { delete: op("Account", "Delete account and all files (password required)") },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        cookieAuth: { type: "apiKey", in: "cookie", name: "pl_at" },
        cronSecret: { type: "http", scheme: "bearer" },
      },
      responses: {
        ValidationError: { description: "Validation failed", content: { "application/json": { schema: ref("Error") } } },
        Unauthorized: { description: "Authentication required", content: { "application/json": { schema: ref("Error") } } },
        NotFound: { description: "Not found (also returned for other users' resources)", content: { "application/json": { schema: ref("Error") } } },
        RateLimited: { description: "Too many requests (see Retry-After)", content: { "application/json": { schema: ref("Error") } } },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { const: false },
            error: {
              type: "object",
              properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
            },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
            role: { type: "string", enum: ["user", "admin"] },
          },
        },
        Credentials: {
          type: "object",
          required: ["email", "password"],
          properties: {
            name: { type: "string", description: "Register only" },
            email: { type: "string" },
            password: { type: "string" },
            client: { type: "string", enum: ["web", "extension"], default: "web" },
            deviceLabel: { type: "string" },
          },
        },
        AuthResult: {
          type: "object",
          properties: {
            user: ref("User"),
            tokens: {
              type: "object",
              description: "Only for client=extension",
              properties: {
                accessToken: { type: "string" },
                refreshToken: { type: "string" },
                expiresIn: { type: "integer" },
                tokenType: { const: "Bearer" },
              },
            },
          },
        },
        File: {
          type: "object",
          properties: {
            id: { type: "string" },
            originalName: { type: "string" },
            displayName: { type: "string" },
            size: { type: "integer" },
            uploadStatus: { type: "string", enum: ["pending", "uploading", "processing", "completed", "failed", "cancelled"] },
            isPublic: { type: "boolean" },
            publicUrl: { type: "string", format: "uri" },
            batchId: { type: "string" },
            storageLocation: { type: "string" },
            uploadedAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        InitiateResult: {
          type: "object",
          properties: {
            batchId: { type: "string" },
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  status: { type: "string", enum: ["ready", "rejected"] },
                  reason: { type: "string" },
                  file: ref("File"),
                  upload: { type: "object", description: "single: {url, headers} | multipart: {uploadId, partSize, parts[]}" },
                },
              },
            },
          },
        },
      },
    },
  };
}
