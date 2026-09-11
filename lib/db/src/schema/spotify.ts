import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const spotifyConnectionTable = pgTable("spotify_connection", {
  id: integer("id").primaryKey().default(1),
  refreshToken: text("refresh_token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertSpotifyConnectionSchema = createInsertSchema(
  spotifyConnectionTable,
);

export type SpotifyConnection = typeof spotifyConnectionTable.$inferSelect;
export type InsertSpotifyConnection =
  typeof spotifyConnectionTable.$inferInsert;