import { desc, relations, sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
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
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => resourceWorkspaces.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    categoryId: uuid("category_id").references(() => resourceCategories.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    ownerUserId: uuid("owner_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
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
    check("resource_cards_sort_order_check", sql`${table.sortOrder} >= 0`),
    index("resource_cards_created_at_idx").on(table.createdAt),
    index("resource_cards_workspace_id_idx").on(table.workspaceId),
    index("resource_cards_category_id_idx").on(table.categoryId),
    index("resource_cards_workspace_category_sort_idx").on(
      table.workspaceId,
      table.categoryId,
      table.sortOrder
    ),
    index("resource_cards_owner_user_id_idx").on(table.ownerUserId),
    // Partial index covering only active (non-deleted) rows — used by the
    // hot listResources query: WHERE deleted_at IS NULL AND workspace_id = ?
    index("resource_cards_workspace_id_active_idx")
      .on(table.workspaceId)
      .where(sql`${table.deletedAt} IS NULL`),
    // Composite index for category filtering with soft delete checks
    index("resource_cards_workspace_category_deleted_idx").on(
      table.workspaceId,
      table.categoryId,
      table.deletedAt
    ),
    // Index for archive queries and soft delete filtering
    index("resource_cards_deleted_at_idx").on(table.deletedAt),
  ]
)

export const resourceCategories = pgTable(
  "resource_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => resourceWorkspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    symbol: text("symbol"),
    ownerUserId: uuid("owner_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "resource_categories_name_length_check",
      sql`char_length(${table.name}) <= 80`
    ),
    check(
      "resource_categories_symbol_length_check",
      sql`${table.symbol} IS NULL OR char_length(${table.symbol}) <= 16`
    ),
    uniqueIndex("resource_categories_workspace_name_lower_idx").on(
      table.workspaceId,
      sql`lower(${table.name})`
    ),
    index("resource_categories_created_at_idx").on(table.createdAt),
    index("resource_categories_workspace_id_idx").on(table.workspaceId),
    index("resource_categories_owner_user_id_idx").on(table.ownerUserId),
  ]
)

export const resourceOrganizations = pgTable(
  "resource_organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "resource_organizations_name_length_check",
      sql`char_length(${table.name}) <= 80`
    ),
    uniqueIndex("resource_organizations_name_lower_idx").on(
      sql`lower(${table.name})`
    ),
    index("resource_organizations_created_at_idx").on(table.createdAt),
    index("resource_organizations_owner_user_id_idx").on(table.ownerUserId),
  ]
)

export const resourceWorkspaces = pgTable(
  "resource_workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => resourceOrganizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "resource_workspaces_name_length_check",
      sql`char_length(${table.name}) <= 80`
    ),
    uniqueIndex("resource_workspaces_owner_name_lower_idx").on(
      sql`coalesce(${table.ownerUserId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${table.name})`
    ),
    index("resource_workspaces_organization_id_idx").on(table.organizationId),
    index("resource_workspaces_created_at_idx").on(table.createdAt),
    index("resource_workspaces_owner_user_id_idx").on(table.ownerUserId),
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
    // Index for URL duplicate detection and lookups
    index("resource_links_url_idx").on(sql`lower(${table.url})`),
  ]
)

export const resourceTags = pgTable(
  "resource_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("resource_tags_name_length_check", sql`char_length(${table.name}) <= 40`),
    uniqueIndex("resource_tags_name_lower_idx").on(sql`lower(${table.name})`),
    index("resource_tags_created_at_idx").on(table.createdAt),
  ]
)

export const resourceCardTags = pgTable(
  "resource_card_tags",
  {
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resourceCards.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => resourceTags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("resource_card_tags_resource_id_idx").on(table.resourceId),
    index("resource_card_tags_tag_id_idx").on(table.tagId),
    uniqueIndex("resource_card_tags_resource_tag_unique_idx").on(
      table.resourceId,
      table.tagId
    ),
  ]
)

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    username: text("username"),
    passwordHash: text("password_hash"),
    role: text("role").default("editor").notNull(),
    isAdmin: boolean("is_admin").default(false).notNull(),
    isFirstAdmin: boolean("is_first_admin").default(false).notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("app_users_email_length_check", sql`char_length(${table.email}) <= 320`),
    check(
      "app_users_username_length_check",
      sql`${table.username} IS NULL OR char_length(${table.username}) <= 39`
    ),
    check(
      "app_users_role_check",
      sql`${table.role} IN ('viewer', 'editor', 'admin', 'first_admin')`
    ),
    uniqueIndex("app_users_email_lower_idx").on(sql`lower(${table.email})`),
    uniqueIndex("app_users_username_lower_idx")
      .on(sql`lower(${table.username})`)
      .where(sql`${table.username} IS NOT NULL`),
    uniqueIndex("app_users_single_first_admin_idx")
      .on(table.isFirstAdmin)
      .where(sql`${table.isFirstAdmin} = true`),
    // Index for user management queries (sorting by registration date)
    index("app_users_created_at_idx").on(table.createdAt),
  ]
)

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "email_verification_tokens_token_hash_length_check",
      sql`char_length(${table.tokenHash}) = 64`
    ),
    index("email_verification_tokens_user_id_idx").on(table.userId),
    index("email_verification_tokens_expires_at_idx").on(table.expiresAt),
    uniqueIndex("email_verification_tokens_token_hash_idx").on(table.tokenHash),
  ]
)

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "password_reset_tokens_token_hash_length_check",
      sql`char_length(${table.tokenHash}) = 64`
    ),
    index("password_reset_tokens_user_id_idx").on(table.userId),
    index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
    uniqueIndex("password_reset_tokens_token_hash_idx").on(table.tokenHash),
  ]
)

export const colorSchemePreferences = pgTable(
  "color_scheme_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => appUsers.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id"),
    colorScheme: text("color_scheme").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "color_scheme_preferences_color_scheme_length_check",
      sql`char_length(${table.colorScheme}) <= 64`
    ),
    check(
      "color_scheme_preferences_target_check",
      sql`${table.userId} IS NOT NULL OR ${table.visitorId} IS NOT NULL`
    ),
    uniqueIndex("color_scheme_preferences_user_id_idx").on(table.userId),
    uniqueIndex("color_scheme_preferences_visitor_id_idx").on(table.visitorId),
    index("color_scheme_preferences_updated_at_idx").on(table.updatedAt),
  ]
)

export const aiPastePreferences = pgTable(
  "ai_paste_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "ai_paste_preferences_decision_check",
      sql`${table.decision} IN ('accepted', 'declined')`
    ),
    index("ai_paste_preferences_updated_at_idx").on(table.updatedAt),
  ]
)

export const askLibraryThreads = pgTable(
  "ask_library_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => resourceWorkspaces.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    conversationJson: jsonb("conversation_json").notNull().default(sql`'[]'::jsonb`),
    lastQuestion: text("last_question"),
    lastAnswer: text("last_answer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "ask_library_threads_title_length_check",
      sql`char_length(${table.title}) <= 120`
    ),
    index("ask_library_threads_user_id_updated_at_idx").on(
      table.userId,
      table.updatedAt
    ),
    index("ask_library_threads_workspace_id_updated_at_idx").on(
      table.workspaceId,
      table.updatedAt
    ),
  ]
)

export const resourceAuditLogs = pgTable(
  "resource_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resourceCards.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    actorIdentifier: text("actor_identifier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "resource_audit_logs_action_check",
      sql`${table.action} IN ('archived', 'restored')`
    ),
    check(
      "resource_audit_logs_actor_identifier_length_check",
      sql`char_length(${table.actorIdentifier}) <= 320`
    ),
    index("resource_audit_logs_created_at_idx").on(table.createdAt),
    index("resource_audit_logs_resource_id_created_at_idx").on(
      table.resourceId,
      table.createdAt
    ),
    index("resource_audit_logs_actor_user_id_created_at_idx").on(
      table.actorUserId,
      table.createdAt
    ),
  ]
)

export const faviconCache = pgTable(
  "favicon_cache",
  {
    hostname: text("hostname").primaryKey(),
    faviconUrl: text("favicon_url"),
    faviconContentType: text("favicon_content_type"),
    faviconBase64: text("favicon_base64"),
    faviconHash: text("favicon_hash"),
    fetchEtag: text("fetch_etag"),
    fetchLastModified: text("fetch_last_modified"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull(),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "favicon_cache_hostname_length_check",
      sql`char_length(${table.hostname}) <= 253`
    ),
    check(
      "favicon_cache_hash_length_check",
      sql`${table.faviconHash} IS NULL OR char_length(${table.faviconHash}) = 64`
    ),
    index("favicon_cache_last_checked_at_idx").on(table.lastCheckedAt),
    index("favicon_cache_next_check_at_idx").on(table.nextCheckAt),
  ]
)

export const tobyImportBatches = pgTable(
  "toby_import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdByUserId: uuid("created_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdByIdentifier: text("created_by_identifier").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => resourceWorkspaces.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(
      () => resourceOrganizations.id,
      {
        onDelete: "set null",
      }
    ),
    workspaceName: text("workspace_name").notNull(),
    sourceName: text("source_name"),
    createdWorkspaceId: uuid("created_workspace_id").references(
      () => resourceWorkspaces.id,
      {
        onDelete: "set null",
      }
    ),
    importedLists: integer("imported_lists").notNull().default(0),
    importedCards: integer("imported_cards").notNull().default(0),
    importedResources: integer("imported_resources").notNull().default(0),
    skippedExactDuplicates: integer("skipped_exact_duplicates")
      .notNull()
      .default(0),
    failed: integer("failed").notNull().default(0),
    resourceIds: jsonb("resource_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rolledBackByUserId: uuid("rolled_back_by_user_id").references(
      () => appUsers.id,
      {
        onDelete: "set null",
      }
    ),
    rolledBackByIdentifier: text("rolled_back_by_identifier"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "toby_import_batches_created_by_identifier_length_check",
      sql`char_length(${table.createdByIdentifier}) <= 320`
    ),
    check(
      "toby_import_batches_workspace_name_length_check",
      sql`char_length(${table.workspaceName}) <= 80`
    ),
    check(
      "toby_import_batches_source_name_length_check",
      sql`${table.sourceName} IS NULL OR char_length(${table.sourceName}) <= 200`
    ),
    check(
      "toby_import_batches_rolled_back_by_identifier_length_check",
      sql`${table.rolledBackByIdentifier} IS NULL OR char_length(${table.rolledBackByIdentifier}) <= 320`
    ),
    check(
      "toby_import_batches_imported_lists_check",
      sql`${table.importedLists} >= 0`
    ),
    check(
      "toby_import_batches_imported_cards_check",
      sql`${table.importedCards} >= 0`
    ),
    check(
      "toby_import_batches_imported_resources_check",
      sql`${table.importedResources} >= 0`
    ),
    check(
      "toby_import_batches_skipped_exact_duplicates_check",
      sql`${table.skippedExactDuplicates} >= 0`
    ),
    check("toby_import_batches_failed_check", sql`${table.failed} >= 0`),
    index("toby_import_batches_created_at_idx").on(desc(table.createdAt)),
    index("toby_import_batches_created_by_user_id_created_at_idx").on(
      table.createdByUserId,
      desc(table.createdAt)
    ),
    index("toby_import_batches_workspace_id_created_at_idx").on(
      table.workspaceId,
      desc(table.createdAt)
    ),
    index("toby_import_batches_rolled_back_at_idx").on(table.rolledBackAt),
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
