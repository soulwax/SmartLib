import { relations, sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const resourceCards = pgTable(
  "resource_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    category: text("category").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "resource_cards_category_length_check",
      sql`char_length(${table.category}) <= 80`
    ),
    index("resource_cards_created_at_idx").on(table.createdAt),
  ]
)

export const resourceLinks = pgTable(
  "resource_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resourceCards.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    label: text("label").notNull(),
    note: text("note"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("resource_links_url_length_check", sql`char_length(${table.url}) <= 2048`),
    check(
      "resource_links_label_length_check",
      sql`char_length(${table.label}) <= 120`
    ),
    check("resource_links_position_check", sql`${table.position} >= 0`),
    index("resource_links_resource_id_position_idx").on(
      table.resourceId,
      table.position
    ),
  ]
)

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    isAdmin: boolean("is_admin").default(false).notNull(),
    isFirstAdmin: boolean("is_first_admin").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("app_users_email_length_check", sql`char_length(${table.email}) <= 320`),
    uniqueIndex("app_users_email_lower_idx").on(sql`lower(${table.email})`),
    uniqueIndex("app_users_single_first_admin_idx")
      .on(table.isFirstAdmin)
      .where(sql`${table.isFirstAdmin} = true`),
  ]
)

export const resourceCardsRelations = relations(resourceCards, ({ many }) => ({
  links: many(resourceLinks),
}))

export const resourceLinksRelations = relations(resourceLinks, ({ one }) => ({
  resource: one(resourceCards, {
    fields: [resourceLinks.resourceId],
    references: [resourceCards.id],
  }),
}))
