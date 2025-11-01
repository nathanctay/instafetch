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

---

## 1) Core User Stories

1. **Add account**: Enter a public handle or profile URL to follow.
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
import { blob, integer, sqliteTable, text, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// Minimal single-user now; add users table later if needed.
export const accounts = sqliteTable("accounts", {
    id: text("id").primaryKey(), // uuid
    handle: text("handle").notNull(),
    url: text("url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$default(() => new Date()),
    status: text("status", { enum: ["active", "paused", "error"] }).notNull().default("active"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    lastShortcode: text("last_shortcode")
}, (t) => (
    [uniqueIndex("idx_accounts_handle").on(t.handle)]
));

export const posts = sqliteTable("posts", {
    id: text("id").primaryKey(),                 // uuid
    accountId: text("account_id").notNull()      // Added foreign key
        .references(() => accounts.id, { onDelete: "cascade" }),
    shortcode: text("shortcode").notNull(),
    caption: text("caption"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
    raw: blob("raw"),
}, (t) => ([
    // Composite index: ensures shortcode is unique *per account*
    uniqueIndex("idx_posts_account_shortcode").on(t.accountId, t.shortcode)
]));

export const media = sqliteTable("media", {
    id: text("id").primaryKey(),                 // uuid
    postId: text("post_id").notNull()           // Added foreign key
        .references(() => posts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["image", "video", "carousel"] }).notNull(),
    url: text("url").notNull(),
    width: integer("width"),
    height: integer("height"),
    thumbUrl: text("thumb_url")
});

export const settings = sqliteTable("settings", {
    // Enforce singleton row (only ID=1)
    id: integer("id").primaryKey().$default(() => 1).notNull(),
    digestFrequency: text("digest_frequency", { enum: ["daily", "weekly"] }).notNull().default("daily"), // Correct enum syntax
    instantAlerts: integer("instant_alerts", { mode: "boolean" }).notNull().default(false) // Changed to boolean
});

export const digests = sqliteTable("digests", {
    id: text("id").primaryKey(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull().$default(() => new Date()),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
});

// --- Join Table for Digests (Normalization) ---
export const digestPosts = sqliteTable("digest_posts", {
    digestId: text("digest_id").notNull()
        .references(() => digests.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull()
        .references(() => posts.id, { onDelete: "set null" }), // 'set null' so if a post is deleted, the digest isn't deleted
}, (t) => ([
    // Primary key to ensure a post is only in a digest once
    primaryKey({ columns: [t.digestId, t.postId] })
]));

// --- Relations ---

export const accountsRelations = relations(accounts, ({ many }) => ({
    posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
    account: one(accounts, {
        fields: [posts.accountId],
        references: [accounts.id],
    }),
    media: many(media),
    digestPosts: many(digestPosts),
}));

export const mediaRelations = relations(media, ({ one }) => ({
    post: one(posts, {
        fields: [media.postId],
        references: [posts.id],
    }),
}));

export const digestsRelations = relations(digests, ({ many }) => ({
    digestPosts: many(digestPosts),
}));

export const digestPostsRelations = relations(digestPosts, ({ one }) => ({
    digest: one(digests, {
        fields: [digestPosts.digestId],
        references: [digests.id],
    }),
    post: one(posts, {
        fields: [digestPosts.postId],
        references: [posts.id],
    }),
}));
```

---

## 4) External Integrations

### Scraping Provider (primary)

* **TBD** (HTTP API):

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

* Implementation: `TBD` + optional `playwrightFetcher` (later, behind a flag).

### Email

* **Resend** (simplest) or **SES** (cheapest).
* Templating: **MJML** → HTML; plain-text fallbacks.

---

## 5) Backend API (Hono)

**Base URL:** `/api`

* `GET /health` → `"ok"`
* Here is an updated version of your API design document that reflects all the endpoints, validation, and schema relationships we've built.

---

## 🌎 API Endpoints

### Accounts

* `GET /accounts` → Lists all accounts.
* `GET /accounts/:id` → Gets a single account by its UUID.
* `GET /accounts/:id/posts` → Gets all posts for a specific account.
* `POST /accounts` `{ handle, url, status? }` → Creates a new account.
* `PATCH /accounts/:id` `{ handle?, url?, status? }` → Updates an account's details.
* `DELETE /accounts/:id` → Deletes an account (this will cascade and delete all its posts and media).


### Posts

* `GET /posts?page=&limit=` → Gets a paginated list of all posts. Responds with `{ data: [...], meta: { total, page, limit, totalPages } }`.
* `GET /posts/:id` → Gets a single post by its UUID.
* `GET /posts/:id/media` → Gets all media for a specific post. Returns a `404` if the *post* doesn't exist, or an empty `[]` if the post exists but has no media.
* `POST /posts` `{ accountId, shortcode, publishedAt, caption?, raw? }` → Creates a new post. `publishedAt` must be an ISO 8601 timestamp string.
* `PATCH /posts/:id` `{ shortcode?, publishedAt?, caption?, raw? }` → Updates a post's details.
* `DELETE /posts/:id` → Deletes a post (this will cascade and delete all its media).


### Media

* `GET /media` → Lists all media items in the database.
* `GET /media/:id` → Gets a single media item by its UUID.
* **Note:** There are no `POST`, `PATCH`, or `DELETE` endpoints for media. Media is managed "behind the scenes" when a post is created, and it is deleted automatically when its parent post is deleted.


### Digests

* `GET /digests` → Lists all digests.
* `POST /digests` `{ periodStart, periodEnd }` → Creates a new digest. Timestamps must be ISO 8601 strings.
* `GET /digests/:id` → Gets a single digest, with its related posts nested in the response.
* `DELETE /digests/:id` → Deletes a digest (this will cascade and delete its relationships from `digestPosts`).
* `POST /digests/:id/posts` `{ postIds: ["uuid", ...] }` → **Adds** one or more posts to a digest (batch operation).
* `DELETE /digests/:id/posts` `{ postIds: ["uuid", ...] }` → **Removes** one or more posts from a digest (batch operation).


### Settings

* `GET /settings` → Gets the singleton app settings.
    * **Note:** This is a "get-or-create" endpoint. If no settings row (with `id=1`) exists, it will be created and returned with all default values.
* `PATCH /settings` `{ digestFrequency?, instantAlerts? }` → Updates the app settings.

* **Admin (optional)**

  * `POST /tasks/fetch-all` → manual run of the periodic fetcher
  * `POST /tasks/send-digest` → manual digest send

> Validation with Valibot. Return errors as `{ error: { code, message } }`.

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
