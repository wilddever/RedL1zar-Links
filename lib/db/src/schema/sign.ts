import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const signSubmissionsTable = pgTable(
  "sign_submission",
  {
    id: text("id").primaryKey(),
    nickname: text("nickname").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "deleted"],
    })
      .default("pending")
      .notNull(),
    requestId: text("request_id"),
    imagePath: text("image_path").notNull(),
  },
  (table) => [uniqueIndex("sign_submission_request_id_idx").on(table.requestId)],
);

export const signRateLimitsTable = pgTable("sign_rate_limit", {
  ipHash: text("ip_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const signNotificationsTable = pgTable("sign_notification", {
  submissionId: text("submission_id")
    .primaryKey()
    .references(() => signSubmissionsTable.id, { onDelete: "cascade" }),
  delivered: boolean("delivered").default(false).notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

export const insertSignSubmissionSchema = createInsertSchema(
  signSubmissionsTable,
);
export const insertSignRateLimitSchema = createInsertSchema(signRateLimitsTable);
export const insertSignNotificationSchema = createInsertSchema(
  signNotificationsTable,
);

export type SignSubmission = typeof signSubmissionsTable.$inferSelect;
export type InsertSignSubmission = typeof signSubmissionsTable.$inferInsert;
export type SignRateLimit = typeof signRateLimitsTable.$inferSelect;
export type InsertSignRateLimit = typeof signRateLimitsTable.$inferInsert;
export type SignNotification = typeof signNotificationsTable.$inferSelect;
export type InsertSignNotification =
  typeof signNotificationsTable.$inferInsert;