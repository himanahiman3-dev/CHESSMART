import { doublePrecision, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  white: text("white").notNull().default("White"),
  black: text("black").notNull().default("Black"),
  result: text("result").notNull().default("*"),
  plies: integer("plies").notNull().default(0),
  depth: integer("depth").notNull().default(20),
  whiteAccuracy: doublePrecision("white_accuracy").notNull().default(0),
  blackAccuracy: doublePrecision("black_accuracy").notNull().default(0),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
