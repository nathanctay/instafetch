heck yes—here’s a tight, implementation-ready design doc for your project:

# instafetch — Project Design Document (Personal Edition)

## 0) Goal & Constraints

* **Goal:** Keep up with a handful of **public Instagram accounts** without using the Instagram app. Get **digests by email** and optionally near-real-time alerts.
* **Scope:** **Personal use**, small scale (your accounts only), single user (can expand later).
* **Stack (finalized):**

  * **Frontend:** React + **React Router** + TanStack Query + Zod
  * **Backend:** **Bun + Hono** (TypeScript)
  * **DB:** **Turso (libSQL/SQLite)** + **Drizzle ORM**
  * **Scraping:** Third-party API (e.g., Apify IG scraper) with optional Playwright fallback (later)
  * **Email:** Resend or Amazon SES
  * **Scheduling:** In-process cron (Bun) or OS cron, no Redis queue initially

> Note on scraping: even for personal use, keep it respectful—low rate limits, delete on request, and avoid private accounts.

---

## 1) Core User Stories

1. **Add account**: Enter a public @handle or profile URL to follow.
2. **Digest**: Receive a **daily or weekly** email with new posts since last digest.
3. **Instant alerts (optional)**: For a subset, get a heads-up within ~15 min of a new post.
4. **Browse**: View latest posts per account in the web app.
5. **Manage**: Pause a account, change frequency, remove accounts.

---

## 2) Architecture Overview

### Monorepo

```
instafetch/
├─ apps/
│  ├─ web/   # React (Vite) + React Router + TanStack Query + Zod
│  └─ api/   # Bun + Hono + Drizzle + Turso
├─ packages/
│  ├─ types/ # shared Zod schemas & TS types
│  └─ email/ # MJML/Handlebars templates + render helpers
├─ infra/    # (optional) deploy scripts, Dockerfiles
├─ .env      # non-secret defaults
└─ package.json (bun workspaces)
```

### Backend responsibilities (Hono)

* REST API (accounts, posts, settings)
* Scrape orchestration (call provider, normalize, store)
* Digest builder (HTML email from templates)
* Cron tasks (check accounts, send digests)

### Frontend responsibilities (React)

* Manage accounts (add/remove/pause)
* Show latest posts per account
* Settings (frequency: daily/weekly; toggle instant alerts)
* Auth (optional/simple gate)

---

## 3) Data Model (Drizzle • SQLite/Turso)

```ts
// schema.ts (SQLite)
import { sqliteTable, text, integer, blob, uniqueIndex } from "drizzle-orm/sqlite-core";

// Minimal single-user now; add users table later if needed.
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),                 // uuid
  handle: text("handle").notNull(),            // "natgeo"
  url: text("url").notNull(),                  // canonical profile URL
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("active"), // active|paused|error
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  lastShortcode: text("last_shortcode")        // most recent seen; sanity fence
}, (t) => ({
  handleIdx: uniqueIndex("idx_accounts_handle").on(t.handle)
}));

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),                 // uuid
  accountId: text("account_id").notNull(),       // fk -> accounts.id
  shortcode: text("shortcode").notNull(),      // IG post id in URL
  caption: text("caption"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  raw: blob("raw"),                             // JSON string or compressed
}, (t) => ({
  shortcodeIdx: uniqueIndex("idx_posts_shortcode").on(t.shortcode)
}));

export const media = sqliteTable("media", {
  id: text("id").primaryKey(),                 // uuid
  postId: text("post_id").notNull(),           // fk -> posts.id
  kind: text("kind").notNull(),                // image|video|carousel
  url: text("url").notNull(),                  // CDN url from provider
  width: integer("width"),
  height: integer("height"),
  thumbUrl: text("thumb_url")
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),              // singleton row (1)
  digestFrequency: text("digest_frequency").notNull().default("daily"), // daily|weekly
  instantAlerts: integer("instant_alerts").notNull().default(0) // 0/1
});

export const digests = sqliteTable("digests", {
  id: text("id").primaryKey(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
  periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
  periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
  postIdsCsv: text("post_ids_csv").notNull()   // simple for SQLite; or join table if you prefer
});
```

---

## 4) External Integrations

### Scraping Provider (primary)

* **Apify Instagram Scraper** (HTTP API):

  * Inputs: username / profile URL, item limit, since timestamp.
  * Outputs: list of posts with caption, timestamp, media URLs, shortcode, stats.
* Provider adapter interface:

```ts
type FetchedPost = {
  shortcode: string;
  caption?: string;
  publishedAt: number;
  media: Array<{ kind: 'image'|'video'|'carousel'; url: string; width?: number; height?: number; thumbUrl?: string }>;
  likeCount?: number;
  commentCount?: number;
  raw: unknown;
};

interface InstagramFetcher {
  fetchLatest(handleOrUrl: string, since?: number): Promise<FetchedPost[]>;
}
```

* Implementation: `apifyFetcher` + optional `playwrightFetcher` (later, behind a flag).

### Email

* **Resend** (simplest) or **SES** (cheapest).
* Templating: **MJML** → HTML; plain-text fallbacks.

---

## 5) Backend API (Hono)

**Base URL:** `/api`

* `GET /health` → `"ok"`
* **accounts**

  * `GET /accounts` → list
  * `POST /accounts` `{ handleOrUrl }` → resolves handle + canonical URL; inserts account (status=active)
  * `PATCH /accounts/:id` `{ status? }` → pause/resume
  * `DELETE /accounts/:id`
  * `POST /accounts/:id/refresh` → enqueue immediate fetch (rate-limited)
* **Posts**

  * `GET /accounts/:id/posts?cursor=&limit=&since=` → paginated posts
  * `GET /posts/:shortcode` → single post (by shortcode)
* **Settings**

  * `GET /settings`
  * `PATCH /settings` `{ digestFrequency, instantAlerts }`
* **Admin (optional)**

  * `POST /tasks/fetch-all` → manual run of the periodic fetcher
  * `POST /tasks/send-digest` → manual digest send

> Validation with Zod. Return errors as `{ error: { code, message } }`.

---

## 6) Frontend (React + React Router + TanStack Query)

### Route map

```
/             → Dashboard (recent posts across accounts)
/accounts      → List accounts (add/remove/pause)
/accounts/:id  → account detail (posts, last checked, refresh button)
/settings     → Digest frequency, instant alerts
```

### Data fetching patterns

* **TanStack Query** for all API calls:

  * Keys: `['accounts']`, `['posts', accountId, params]`, `['settings']`
  * Simple stale times (e.g., 30–60s on posts)
* **Mutations**: add account, delete account, patch settings → invalidate relevant queries
* **Search params**: pagination on list pages (page/limit) via React Router `useSearchParams`

### Components

* `AddaccountDialog` (validates handle/URL with Zod; previews resolved handle)
* `accountCard` (status chip: active/paused/error; lastChecked)
* `PostGrid` (media thumbnails, caption; link to IG)
* `SettingsForm` (radio daily/weekly; instantAlerts toggle)

---

## 7) Jobs & Scheduling

### Periodic fetch

* **Every 30–60 minutes**: for each active account:

  1. Call `fetchLatest(handle, since=lastCheckedAt - buffer)`
  2. Normalize to `posts` & `media`; **dedupe on `shortcode`**
  3. Update `lastCheckedAt`, `lastShortcode`
  4. (If instant alerts enabled) send small email for new items from “priority” accounts (optional)

### Digest send

* **Daily @ 7am** or **Weekly (Sun @ 7am)**

  1. Query posts in period `[lastDigestSentAt, now)`
  2. Compose HTML (grouped by account)
  3. Send email; persist `digests` row

> Implementation: in-process cron with Bun (`setInterval`/light cron lib) or system cron curling `/api/tasks/*`. For personal scale, no Redis/queues needed.

---

## 8) Rate Limits, Errors, & Resilience

* **Per-account backoff** on 4xx/5xx from provider.
* **Global cap** (e.g., max 10 profiles, max 200 fetches/day).
* **Circuit breaker**: if a account fails N times, set `status=error` and surface in UI.
* **Idempotency**: upsert posts by `shortcode`.

---

## 9) Security & Privacy (personal)

* Store **provider tokens** only in server env.
* Minimal PII (your email only).
* “Do not fetch” list (manually configurable).
* **Purge flow**: delete all stored posts/media for any account you remove.

---

## 10) Configuration & Env

**Backend (`apps/api/.env.local`)**

```
TURSO_DATABASE_URL=libsql://<db>.turso.io
TURSO_AUTH_TOKEN=...
APIFY_TOKEN=...
EMAIL_PROVIDER=resend
RESEND_API_KEY=...
DIGEST_FREQUENCY=daily   # daily|weekly (default)
INSTANT_ALERTS=0         # 0|1
CRON_FETCH_INTERVAL_MIN=45
CRON_DIGEST_HOUR=7
TZ=America/Denver
```

**Frontend (`apps/web/.env.local`)**

```
VITE_API_BASE_URL=http://localhost:3000/api
```

---

## 11) Dev & Build

* **Backend**

  * Dev: `bun run src/server.ts`
  * Build: `bun build ./src/server.ts --outdir dist --target bun`
  * Migrations:

    * `bunx drizzle-kit generate`
    * `bunx drizzle-kit push`
* **Frontend**

  * Dev: `bun --cwd apps/web dev`
  * Build: `bun --cwd apps/web build`

**Root scripts (workspaces)**

```json
{
  "scripts": {
    "dev": "bunx concurrently -r \"bun --cwd apps/api dev\" \"bun --cwd apps/web dev\"",
    "build": "bun --cwd apps/api build && bun --cwd apps/web build"
  }
}
```

---

## 12) Testing

* **Unit**: Provider adapter (maps raw → `FetchedPost[]`), normalizers, email renderer.
* **Integration**: Add account → fetch → posts visible → digest composed.
* **E2E smoke**: Start both apps; seed a test handle; run a manual fetch; verify a post shows in UI.

---

## 13) Milestones

**MVP (Day 1–2)**

* Add/remove account
* Manual “fetch now”
* List posts per account
* Daily digest (single recipient)

**v0.2**

* Automatic scheduled fetch
* Error/status chips
* Weekly digest option

**v0.3**

* Instant alerts (select per account)
* Pagination/search on posts
* Export/import accounts JSON

**v0.4 (nice-to-haves)**

* Playwright fallback adapter
* Drag-n-drop account ordering
* Simple auth wall (passcode)

---

## 14) Sample Email (MJML outline)

```mjml
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text font-size="20px" font-weight="700">instafetch — Your ${period} digest</mj-text>
        <mj-text color="#666">${periodStart} → ${periodEnd}</mj-text>
      </mj-column>
    </mj-section>

    {{#each accounts}}
    <mj-section>
      <mj-column>
        <mj-text font-weight="700">@{{handle}}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section>
      {{#each posts}}
      <mj-column width="33%">
        <mj-image padding="4px" src="{{thumbUrl}}" href="https://www.instagram.com/p/{{shortcode}}/" />
        <mj-text font-size="12px" color="#555">{{truncate caption 100}}</mj-text>
      </mj-column>
      {{/each}}
    </mj-section>
    {{/each}}

    <mj-section>
      <mj-column>
        <mj-text color="#999">You’re receiving this because you enabled {{frequency}} digests.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

---

## 15) Implementation Notes & Gotchas

* Prefer **handle → canonical URL** resolution once; store both.
* Some provider outputs won’t include **exact** like/comment counts consistently—treat them as optional.
* Thumbnails vs full media: use provider’s CDN links; do **not** mirror media unless necessary.
* SQLite with Turso: perfect for this scale. If you ever outgrow, schema ports to Postgres are straightforward with Drizzle.

---

### Final Recommendation

For **instafetch**, this plan keeps your toolchain lean, portable, and affordable:

* Bun + Hono API, Turso + Drizzle DB
* React + React Router + TanStack Query frontend
* Apify (or similar) for scraping
* Resend/SES for email
* In-process cron for fetch & digest

If you want, I can generate the initial repo skeleton (files + minimal code) exactly to this spec so you can `bun run dev` and start adding accounts immediately.
