# PDFLinker

Bulk-upload PDFs, get a **public link for every file**, then copy, manage and export those links. Built for teams: everyone in a workspace shares one library.

- Browser → **object storage direct uploads** through short-lived presigned URLs (PDF bytes never pass through Next.js)
- Multipart uploads for large files, concurrent queue, per-file progress, retry / cancel / resume
- **Team workspaces** with owner / admin / member roles and invite links
- Next.js 16 (App Router, Cache Components) · MongoDB/Mongoose · Tailwind CSS 4 · Zod everywhere
- **API-first**: everything the website does goes through versioned REST endpoints under `/api/v1` (OpenAPI docs at `/api/v1/docs`), so a future Chrome extension reuses the same backend, database and storage.
- Storage is any **S3-compatible** store: self-hosted SeaweedFS (included in the Docker stack), Cloudflare R2, Backblaze B2, AWS S3, …

> **Public by design.** Anyone who has a file's URL can open the PDF without signing in, until you revoke the link or delete the file.

---

## Quick start (no accounts, no storage server)

```bash
npm install
npm run dev:local     # http://localhost:3000
```

`dev:local` starts an **in-memory MongoDB** and an **in-process storage emulator**. Everything resets when you stop it. The emulator is hard-disabled in production.

## Workspaces and roles

Files belong to a **workspace**, not to a person. Registering creates a personal workspace; invitees join the inviting team instead. A user can belong to several workspaces and switches between them from the sidebar (per device/session).

| Capability | Member | Admin | Owner |
| --- | :-: | :-: | :-: |
| Upload, view every file/link, copy, export, download, check links | ✓ | ✓ | ✓ |
| Rename, revoke, restore, delete **their own** uploads | ✓ | ✓ | ✓ |
| Rename, revoke, restore, delete **anyone's** uploads | | ✓ | ✓ |
| Invite members, remove members | | ✓ | ✓ |
| Invite/promote/demote/remove **admins**, transfer ownership | | | ✓ |

- **Invites** are one-time links (7 days) bound to an email address; there's no mail server requirement, so the admin copies the link from **Team → Invite teammates** and sends it. The invitee registers (or signs in) with that exact email.
- Only the member who started an upload can complete or cancel it.
- Duplicate detection (same name + size) spans the whole workspace; upload history is shared.
- Removing a member cuts access on their very next request. Their uploads stay with the team ("Former member").
- Deleting an account: workspaces only you belong to are deleted with their PDFs; in shared workspaces you leave (owners must transfer ownership first).

## Deploy on your own server (Docker, self-hosted)

One Linux server runs everything: the app, MongoDB, SeaweedFS (S3-compatible object storage) and Caddy (automatic HTTPS).

1. **DNS**: point three names at the server's IP: `pdf.example.com` (app), `files.example.com` (public PDF links), `s3.example.com` (browser uploads).
2. **Configure**: `cp deploy/.env.docker.example .env` and fill in the domains and secrets (`openssl rand -base64 36`; use letters and digits for passwords).
3. **Start**: `docker compose up -d --build`, then open `https://pdf.example.com`, register (the first account owns its own workspace) and invite your team.

What each service does:

| Service | Role |
| --- | --- |
| `caddy` | HTTPS for the three hostnames. `files.*` serves **only `GET/HEAD /pdfs/*`**, so staging and revoked objects are never public. `s3.*` adds the CORS headers browsers need for presigned uploads. |
| `app` | The Next.js server (standalone build). |
| `mongo` | MongoDB 8 with a root password, data in the `mongo_data` volume. |
| `seaweed` | SeaweedFS single node (master + volume + filer + S3 gateway), not exposed publicly; data in `seaweed_data`. |
| `s3-init` | One-shot job that creates the bucket. |
| `cleanup` | Hourly call to `POST /api/v1/uploads/cleanup` to abort abandoned uploads. |

Trying it on one machine first? Set `APP_DOMAIN=localhost`, `FILES_DOMAIN=files.localhost`, `S3_DOMAIN=s3.localhost`; Caddy then uses its own local certificate authority.

**Operations**
- **Backups**: back up the `mongo_data` and `seaweed_data` volumes (e.g. `mongodump` plus a volume snapshot). The database holds only metadata; the PDFs live in `seaweed_data`.
- **Updates**: `git pull && docker compose up -d --build`. Pin `chrislusf/seaweedfs` to a specific tag in `docker-compose.yml` for production.
- **Ports**: only 80/443 are published.

> **What has been verified.** The S3 storage path was tested against a real **SeaweedFS 4.54** server (conformance suite, plus a production build driven through a browser: single and 25 MB multipart uploads, public links, link check, revoke/restore, delete). The Docker Compose files and Caddy configuration were written from the documentation and have **not** been run end-to-end, because they need Docker and real DNS. After `docker compose up`, run the conformance suite below against your stack and upload, open and revoke a PDF.

### Verifying any S3-compatible storage

`npm run test:s3` runs the exact calls PDFLinker makes (presigned PUT with signed headers, multipart with presigned parts, HEAD, ranged GET, copy, delete, presigned download) against a real endpoint. It is skipped unless you point it at one:

```bash
S3_TEST_ENDPOINT=https://s3.example.com S3_TEST_BUCKET=pdflinker \
S3_TEST_ACCESS_KEY=... S3_TEST_SECRET_KEY=... npm run test:s3
```

**Security note on upload headers.** The AWS presigner signs `Content-Disposition` and `Host` but **not `Content-Type` or `Cache-Control`**, on every S3 store (R2 and AWS included). PDFLinker therefore never trusts the headers an uploader sent: when it publishes a verified file it copies it with `MetadataDirective: REPLACE`, so the public object always carries `Content-Type: application/pdf` and server-chosen cache/disposition headers.

### Why not MinIO?

MinIO's open-source server was archived: its official binaries and images are no longer distributed and it receives no security fixes. PDFLinker's storage layer is plain S3, so you can use any maintained alternative (SeaweedFS is configured here; Garage and others work with the same `STORAGE_*` settings).

## Manual setup (your own MongoDB + any S3 store)

`cp .env.example .env.local` and fill it in.

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (local, self-hosted or Atlas) |
| `AUTH_SECRET` | ≥32 random chars (`openssl rand -base64 48`) signs access tokens |
| `APP_URL` | Public origin of this app (CSRF origin check, invite/reset links) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Storage credentials, **server-side only** (the `R2_` prefix is historical; they apply to any S3 store) |
| `R2_PUBLIC_DOMAIN` | Domain that serves the public PDF links, e.g. `files.example.com` |
| `R2_ACCOUNT_ID` | Cloudflare R2 only (not needed when `STORAGE_ENDPOINT` is set) |
| `STORAGE_ENDPOINT` | S3 endpoint for non-R2 stores (SeaweedFS, B2, AWS, …) |
| `STORAGE_PUBLIC_ENDPOINT` | Endpoint **browsers** use for presigned URLs when it differs from the server's (e.g. inside Docker) |
| `STORAGE_REGION`, `STORAGE_FORCE_PATH_STYLE` | Region (default `us-east-1`) and path-style addressing (default on when `STORAGE_ENDPOINT` is set) |
| `MAX_FILE_SIZE_MB` / `MAX_FILES_PER_BATCH` / `UPLOAD_CONCURRENCY` | Limits (default 100 / 100 / 4). Users can only *lower* them in Settings |
| `MULTIPART_THRESHOLD_MB` / `MULTIPART_PART_SIZE_MB` | Files above the threshold use multipart (default 20 / 10) |
| `ALLOWED_EXTENSION_ORIGINS` | Optional, comma-separated, e.g. `chrome-extension://<id>` |
| `CRON_SECRET` | Protects `POST /api/v1/uploads/cleanup` |

**Your storage must provide:** (1) the S3 API reachable by the server and by browsers (CORS allowing `PUT` from `APP_URL` and exposing the `ETag` header), (2) a public read-only URL for objects under `pdfs/` at `R2_PUBLIC_DOMAIN`, and (3) ideally a rule to abort incomplete multipart uploads after 1 day.

**Cloudflare R2** works with no `STORAGE_*` variables: create a bucket and API token, connect a custom domain, and add this CORS policy:

```json
[{ "AllowedOrigins": ["https://pdf.example.com"], "AllowedMethods": ["PUT"],
   "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

Then `npm run dev` (or `npm run build && npm start`).

### Scheduled cleanup

Abandoned uploads (closed tab, lost connection) are aborted and marked failed by:

```bash
curl -X POST https://pdf.example.com/api/v1/uploads/cleanup -H "Authorization: Bearer $CRON_SECRET"
```

The Docker stack does this hourly. It also accepts `GET` for Vercel Cron.

## How uploads work

```
Browser                     PDFLinker API                         Object storage
  │  POST /uploads/initiate ─▶ validate, create File(pending),
  │                            presign PUT (or multipart part URLs) ─▶
  │◀──── presigned URLs ──────
  │  PUT bytes ─────────────────────────────────────────────────────▶ staging/<random>.pdf
  │  POST /uploads/complete ─▶ (multipart: CompleteMultipartUpload)
  │                            HEAD (size) + Range read (%PDF- signature)
  │                            copy staging → pdfs/<year>/<uuid>.pdf   ─▶ public key
  │◀──── public URL ──────────
```

- The browser uploads to an unguessable **staging key**. Only after the size and `%PDF-` signature are verified is the object copied to its public key, so **a public URL never exists before verification**.
- Object keys never contain the user's filename (kept as metadata).
- Expired URLs are re-issued with `POST /uploads/:id/refresh`; the client retries transient network errors with backoff, and one failed file never blocks the rest.

### Revoking links

A public domain exposes a whole prefix, so there is no per-object "private" flag. **Revoke** moves the object to a secret key (the public URL 404s) and **Restore** moves it back to the *same* key. Public objects are served with a short `Cache-Control` (5 minutes), so copies already cached by a browser or CDN can keep working for up to ~5 minutes after a revoke.

## API

Base path `/api/v1`. Interactive docs: **`/api/v1/docs`** · spec: `/api/v1/openapi.json`.

All responses share one envelope: `{ "success": true, "data": …, "meta"?: … }` or `{ "success": false, "error": { "code", "message", "details"? } }`.

| Area | Endpoints |
| --- | --- |
| Auth | `POST auth/register`, `auth/login`, `auth/logout`, `auth/refresh`, `auth/forgot-password`, `auth/reset-password`, `auth/change-password`; `GET auth/me`, `auth/sessions`; `DELETE auth/sessions/:id` |
| Workspaces | `GET/POST workspaces`; `POST workspaces/active`; `GET/PATCH workspaces/current`; `GET workspaces/current/members`; `PATCH/DELETE workspaces/current/members/:userId`; `GET/POST workspaces/current/invites`; `DELETE workspaces/current/invites/:id`; `GET invites/:token`; `POST invites/accept` |
| Uploads | `POST uploads/initiate`, `uploads/complete`, `uploads/cancel`, `uploads/:id/refresh`, `uploads/cleanup`; `GET uploads/:id/status` |
| Files | `GET files`, `files/:id`, `files/:id/download`; `PATCH files/:id`; `DELETE files/:id`; `POST files/bulk-delete` |
| Links | `GET links`; `POST links/bulk-copy-data`, `links/:id/verify`, `links/:id/revoke`, `links/:id/restore` |
| Batches | `GET/POST batches`; `GET batches/:id` |
| Exports | `POST exports/csv`, `exports/xlsx`, `exports/txt` |
| Other | `GET stats`, `config`, `settings`; `PATCH settings`; `DELETE account` |

### Authentication for the website *and* a Chrome extension

- **Web**: `POST auth/login` sets two HTTP-only cookies (access token, 10 min; rotating refresh token scoped to `/api/v1/auth`). Cookie-authenticated writes must come from the app's own `Origin` (CSRF defence).
- **Extension / API clients**: `POST auth/login` with `"client": "extension"` returns `{ accessToken, refreshToken, expiresIn }`. Send `Authorization: Bearer <accessToken>`; call `POST auth/refresh` with `{ refreshToken }` to rotate. Refresh tokens are single-use; replaying one revokes the whole session. Each session has an active workspace; switch with `POST workspaces/active`.
- **Revocation**: each login is a session. `GET auth/sessions` lists them, `DELETE auth/sessions/:id` or Settings → Devices revokes one; the access token stops working immediately.
- **CORS**: add the extension origin to `ALLOWED_EXTENSION_ORIGINS` (handled in `src/proxy.ts`; credentials are never allowed cross-origin).
- No storage credentials are ever sent to a client.

## Security notes

- Bcrypt password hashing, generic login errors, per-IP and per-user **rate limits** (in-memory; swap `src/lib/api/rate-limit.ts` for Redis when running multiple instances).
- MIME + extension + **file signature** validation (client *and* server), size limits, sanitised filenames, injection-safe `Content-Disposition`.
- All inputs parsed by Zod into primitives (no operator objects reach MongoDB); regex searches are escaped; `PATCH` bodies are `.strict()` (no mass assignment).
- Every query is scoped by `workspaceId`; other workspaces' resources return `404`; role checks run on the server for every write.
- Secure headers and a runtime-built CSP (`src/proxy.ts`).
- CSV export neutralises spreadsheet formula injection.
- Password reset emails: with no mail provider, the link is logged on the server (and returned in dev). Plug a provider into `deliverResetLink` in `src/services/auth.service.ts`.

## Project structure

```
src/
  app/                 Next.js routes: (auth)/, dashboard/, api/v1/**
  components/          UI (ui/ = design-system primitives), feature components
  hooks/               use-upload-queue (upload engine), use-api
  lib/
    api/               route wrapper, envelope, errors, rate limit
    auth/              passwords, JWT/refresh tokens, cookies, session + workspace resolution, scope/permissions
    db/                cached Mongoose connection
    storage/           StorageDriver interface, S3 driver, key/URL helpers
    validators/        Zod schemas, PDF validation (shared with the browser)
  models/              User, Workspace, Membership, Invite, File, UploadBatch, RefreshToken, PasswordReset
  services/            business logic (auth, workspace, upload, file, link, batch, export, stats, settings)
  proxy.ts             CORS for extension origins, dashboard gate, CSP
  tests/               Vitest suite
deploy/                Caddyfile, SeaweedFS + bucket init scripts, .env.docker.example
Dockerfile, docker-compose.yml
```

Routes are thin: validation + auth in `lib/api/handler.ts`, logic in `services/` (every call takes a `Scope` of user + workspace + role), storage behind `StorageDriver`.

## Testing

```bash
npm test            # Vitest: in-memory MongoDB + in-memory storage driver
npm run test:s3     # optional: conformance suite against a real S3 endpoint
npm run typecheck
npm run lint
```

The suite covers authentication (rotation, replay, revocation, CSRF), PDF validation, presigned URL generation, single + multipart completion, partial batch failure, public URLs, listing/filters, deletion, revoke/restore, exports, workspaces (invites, roles, shared visibility, permissions, member removal, ownership transfer, account deletion) and workspace isolation. The first run downloads a MongoDB binary for `mongodb-memory-server`.

## Chrome extension readiness

Nothing in upload, storage, link generation or file management depends on the website frontend. A Manifest V3 extension only needs: login with `client: "extension"`, `uploads/initiate` → PUT to the presigned URLs → `uploads/complete`, then `links` / `files` to browse previous uploads. It can ship independently of the backend.
