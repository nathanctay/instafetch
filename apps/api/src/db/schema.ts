import { blob, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
    id: text("id").primaryKey(), // uuid
    handle: text().notNull(), // account handle ("natgeo"),
    url: text().notNull(), // account url,
    createdAt: int("created_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status").notNull().default("active"), // active|paused|error
    lastCheckedAt: int("last_checked_at", { mode: "timestamp_ms" }),
    lastShortcode: text("last_shortcode") // most recent seen; sanity fence
}, (t) => ([
    uniqueIndex("idx_accounts_handle").on(t.handle)
]
));

export const posts = sqliteTable("posts", {
    id: text("id").primaryKey(),                 // uuid
    accountId: text("account_id").notNull(),       // fk -> account.id
    shortcode: text("shortcode").notNull(),      // IG post id in URL
    caption: text("caption"),
    publishedAt: int("published_at", { mode: "timestamp_ms" }).notNull(),
    raw: blob("raw"),                             // JSON string or compressed
}, (t) => ({
    shortcodeIdx: uniqueIndex("idx_posts_shortcode").on(t.shortcode)
}));

export const media = sqliteTable("media", {
    id: text("id").primaryKey(),                 // uuid
    postId: text("post_id").notNull(),           // fk -> posts.id
    kind: text("kind").notNull(),                // image|video|carousel
    url: text("url").notNull(),                  // CDN url from provider
    width: int("width"),
    height: int("height"),
    thumbUrl: text("thumb_url")
});

export const settings = sqliteTable("settings", {
    id: int("id").primaryKey(),              // singleton row (1)
    digestFrequency: text("digest_frequency").notNull().default("daily"), // daily|weekly
    instantAlerts: int("instant_alerts").notNull().default(0) // 0/1
});

export const digests = sqliteTable("digests", {
    id: text("id").primaryKey(),
    sentAt: int("sent_at", { mode: "timestamp_ms" }).notNull(),
    periodStart: int("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: int("period_end", { mode: "timestamp_ms" }).notNull(),
    postIdsCsv: text("post_ids_csv").notNull()   // simple for SQLite; or join table if you prefer
});