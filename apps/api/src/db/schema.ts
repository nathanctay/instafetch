import { int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
    id: text("id").primaryKey(), // uuid
    handle: text().notNull(), // account handle ("natgeo"),
    url: text().notNull(), // account url,
    createdAt: int("created_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status").notNull().default("active"), // active|paused|error
    lastCheckedAt: int("last_checked_at", { mode: "timestamp_ms" }),
    lastShortcode: text("last_shortcode") // most recent seen; sanity fence
}, (t) => ({
    handleIdx: uniqueIndex("idx_sources_handle").on(t.handle)
}));