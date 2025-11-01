import { blob, integer, sqliteTable, text, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

// --- Tables ---

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
    kind: text("kind", { enum: ["image", "video", "carousel"] }).notNull(), // Correct enum syntax
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
    // postIdsCsv was removed in favor of the join table below
});

// --- Join Table for Digests (Normalization) ---
// This replaces the 'postIdsCsv' column for better querying
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
// Optional but highly recommended: define relations for Drizzle queries

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