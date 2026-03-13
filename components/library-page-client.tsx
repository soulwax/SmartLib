"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

import {
  canCreateResources,
  canManageResource as canManageResourceByRole,
  deriveUserRole,
  hasAdminAccess,
} from "@/lib/authorization";
import {
  buildLinkDraftFromUrl,
  extractHttpUrlsFromText,
  normalizeDraftCategory,
  normalizeDraftLabel,
  normalizeDraftNote,
  normalizeDraftTags,
  normalizeHttpUrl,
  type PastedLinkDraft,
} from "@/lib/link-paste";
import {
  detectLinkDuplicates,
  type LinkDuplicateMatch,
} from "@/lib/link-duplicate-detection";
import {
  ACTIVE_ORGANIZATION_COOKIE,
  ACTIVE_ORGANIZATION_STORAGE_KEY,
  ACTIVE_WORKSPACE_COOKIE,
  ACTIVE_WORKSPACE_STORAGE_KEY,
  LIBRARY_LOCATION_STORAGE_KEY,
  normalizePersistedId,
} from "@/lib/library-location";
import { cn } from "@/lib/utils";
import type {
  ResourceCard,
  ResourceCategory,
  ResourceInput,
  ResourceOrganization,
  ResourceWorkspace,
} from "@/lib/resources";
import { AddResourceModal } from "@/components/add-resource-modal";
import { OrganizationRail } from "@/components/organization-rail";
import {
  ResourceBoard,
  type ResourceBoardMoveInput,
} from "@/components/resource-board";
import { CategorySidebar } from "@/components/category-sidebar";
import { CompactModeToggle } from "@/components/compact-mode";
import { useColorScheme } from "@/components/color-scheme-provider";
import { WorkspaceRail } from "@/components/workspace-rail";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PaletteDropdown } from "@/components/palette-dropdown";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronDown,
  ClipboardPaste,
  FilterX,
  FolderOpen,
  FolderPlus,
  Github,
  Loader2,
  MessageSquareText,
  LogIn,
  LogOut,
  Menu,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  UserPlus,
  WandSparkles,
  Zap,
} from "lucide-react";
import { Toaster, toast } from "sonner";

interface ApiErrorResponse {
  error?: string;
  mode?: "database" | "mock";
}

interface AuthRegisterResponse extends ApiErrorResponse {
  requiresEmailVerification?: boolean;
  verificationEmailMode?: "resend" | "mock";
  verificationPreviewUrl?: string | null;
  user?: {
    id: string;
    email: string;
  };
}

interface ResendVerificationResponse extends ApiErrorResponse {
  alreadyVerified?: boolean;
  verificationEmailMode?: "resend" | "mock";
  verificationPreviewUrl?: string | null;
  ok?: boolean;
}

interface RequestPasswordResetResponse extends ApiErrorResponse {
  ok?: boolean;
  resetEmailMode?: "resend" | "mock";
  resetPreviewUrl?: string | null;
}

interface DeleteAccountResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  ok?: boolean;
}

interface ListCategoriesResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  categories?: ResourceCategory[];
}

interface ListWorkspacesResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  workspaces?: ResourceWorkspace[];
}

interface ListOrganizationsResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  organizations?: ResourceOrganization[];
}

interface OrganizationResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  organization?: ResourceOrganization;
}

interface ListResourcesResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  resources?: ResourceCard[];
  nextOffset?: number | null;
}

interface WorkspaceCountsResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  countsByWorkspace?: Record<string, number>;
}

interface LibraryBootstrapResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  organizationId?: string | null;
  workspaceId?: string | null;
  resources?: ResourceCard[];
  nextOffset?: number | null;
  categories?: ResourceCategory[];
  organizations?: ResourceOrganization[];
  workspaces?: ResourceWorkspace[];
  workspaceCounts?: Record<string, number>;
}

interface CategoryResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  category?: ResourceCategory;
}

interface CategoryNameSuggestionResponse extends ApiErrorResponse {
  suggestedName?: string;
  analyzedLinks?: number;
  model?: string;
}

type AiPastePromptDecision = "accepted" | "declined";

interface AiPastePreferenceResponse extends ApiErrorResponse {
  decision?: AiPastePromptDecision | null;
}

interface LinkSuggestionResponse extends ApiErrorResponse {
  url?: string;
  label?: string;
  note?: string;
  category?: string;
  tags?: string[];
  model?: string;
}

interface AiInboxItem {
  id: string;
  selected: boolean;
  url: string;
  label: string;
  note: string;
  category: string | null;
  tags: string[];
  model: string | null;
  usedAi: boolean;
  error: string | null;
  exactMatches: LinkDuplicateMatch[];
  nearMatches: LinkDuplicateMatch[];
}

interface AiInboxBatchResponse extends ApiErrorResponse {
  items?: Array<{
    url: string;
    label: string;
    note: string;
    category: string | null;
    tags: string[];
    model: string | null;
    usedAi: boolean;
    error: string | null;
    exactMatches: LinkDuplicateMatch[];
    nearMatches: LinkDuplicateMatch[];
  }>;
  analyzed?: number;
  aiRequested?: boolean;
  aiApplied?: number;
}

interface AiInboxCategoryNameSuggestionResponse extends ApiErrorResponse {
  suggestedName?: string;
  usedAi?: boolean;
  model?: string | null;
  warning?: string | null;
}

interface AiInboxSummaryResponse extends ApiErrorResponse {
  summary?: string;
  actionItems?: string[];
  focusCategories?: string[];
  usedAi?: boolean;
  model?: string | null;
  warning?: string | null;
  analyzed?: number;
}

interface AiInboxSummaryState {
  summary: string;
  actionItems: string[];
  focusCategories: string[];
  usedAi: boolean;
  model: string | null;
  generatedAt: string;
  analyzed: number;
}

interface AskLibraryCitation {
  index: number;
  resourceId: string;
  category: string;
  tags: string[];
  linkUrl: string;
  linkLabel: string;
  linkNote: string | null;
  score: number;
  confidence?: number;
}

type AskLibraryTurnRole = "user" | "assistant";

interface AskLibraryConversationTurnPayload {
  role: AskLibraryTurnRole;
  content: string;
}

interface AskLibraryReasoning {
  summary: string;
  queryTokens: string[];
  primaryCategories: string[];
  averageConfidence: number;
  confidenceLabel: "low" | "medium" | "high";
}

interface AskLibraryConversationTurn extends AskLibraryConversationTurnPayload {
  id: string;
  usedAi?: boolean;
  model?: string | null;
  citations?: AskLibraryCitation[];
  reasoning?: AskLibraryReasoning | null;
  followUpSuggestions?: string[];
  createdAt?: string;
}

interface AskLibraryThreadSummary {
  id: string;
  userId: string;
  workspaceId: string | null;
  title: string;
  turnCount: number;
  lastQuestion: string | null;
  lastAnswer: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AskLibraryThreadDetail extends AskLibraryThreadSummary {
  conversation: AskLibraryConversationTurn[];
}

interface AskLibraryResponse extends ApiErrorResponse {
  question?: string;
  answer?: string;
  citations?: AskLibraryCitation[];
  reasoning?: AskLibraryReasoning;
  followUpSuggestions?: string[];
  usedAi?: boolean;
  model?: string | null;
  threadId?: string | null;
  threadTitle?: string | null;
}

interface AskLibraryThreadsResponse extends ApiErrorResponse {
  threads?: AskLibraryThreadSummary[];
}

interface AskLibraryThreadResponse extends ApiErrorResponse {
  thread?: AskLibraryThreadDetail;
}

interface WorkspaceResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  workspace?: ResourceWorkspace;
}

interface DeleteCategoryResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  deletedCategory?: ResourceCategory;
  reassignedCategory?: ResourceCategory;
  reassignedResources?: number;
}

interface ResourceResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  resource?: ResourceCard;
}

interface TobyImportResponse extends ApiErrorResponse {
  workspace?: ResourceWorkspace;
  workspaceId?: string | null;
  organizationId?: string | null;
  exactDuplicateCount?: number;
  skippedExactDuplicates?: number;
  duplicateSamples?: Array<{
    url: string;
    label: string;
    matches: Array<{
      resourceId: string;
      category: string;
      linkLabel: string;
      linkUrl: string;
    }>;
  }>;
  importedLists?: number;
  importedCards?: number;
  importedResources?: number;
  failed?: number;
}

interface TobyImportPreviewState {
  importedLists: number;
  importedCards: number;
  exactDuplicateCount: number;
  duplicateSamples: NonNullable<TobyImportResponse["duplicateSamples"]>;
}

interface MoveItemResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  item?: ResourceCard;
  affectedItems?: Array<{
    id: string;
    categoryId: string;
    category: string;
    order: number;
  }>;
}

type AuthMode = "login" | "register";

interface SectionPreferences {
  compactTitles: boolean;
  showContextLine: boolean;
  showRoleHints: boolean;
  adminQuickActions: boolean;
}

interface GeneralSettingsPreferences {
  openLinksInSameTab: boolean;
  showAccountEmail: boolean;
  showAccountRole: boolean;
  showMockModeBadge: boolean;
  aiFeaturesEnabled: boolean;
}

interface PersistedLibraryLocation {
  organizationId: string | null;
  workspaceId: string | null;
  scrollOffsetsBySelection: Record<string, number>;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar-width";
const MOBILE_STACK_BREAKPOINT = 768;
const SIDEBAR_SNAP_GRID = 8;
const DESKTOP_SIDEBAR_DEFAULT_WIDTH = 304;
const DESKTOP_SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_KEYBOARD_STEP = SIDEBAR_SNAP_GRID;
const FALLBACK_VIEWPORT_WIDTH = 1440;
const SECTION_PREFERENCES_STORAGE_KEY = "section-preferences";
const GENERAL_SETTINGS_STORAGE_KEY = "general-settings-preferences";
const REALLY_COMPACT_STORAGE_KEY = "really-compact-mode";
const COMPACT_QUERY_PARAM = "compact";
const ASK_LIBRARY_HISTORY_LIMIT = 8;
const AI_INBOX_MAX_URLS = 25;
const RESOURCE_PAGE_SIZE = 200;
const DEFAULT_TOBY_WORKSPACE_NAME = "Toby Import";
const DEFAULT_SECTION_PREFERENCES: SectionPreferences = {
  compactTitles: false,
  showContextLine: true,
  showRoleHints: true,
  adminQuickActions: true,
};
const DEFAULT_GENERAL_SETTINGS: GeneralSettingsPreferences = {
  openLinksInSameTab: false,
  showAccountEmail: true,
  showAccountRole: true,
  showMockModeBadge: true,
  aiFeaturesEnabled: false,
};
const RESOURCE_ORDER_STEP = 1024;
const MAX_RESOURCE_ORDER = Number.MAX_SAFE_INTEGER;

function compareResourcesByOrder(left: ResourceCard, right: ResourceCard): number {
  const leftOrder =
    typeof left.order === "number" ? left.order : MAX_RESOURCE_ORDER;
  const rightOrder =
    typeof right.order === "number" ? right.order : MAX_RESOURCE_ORDER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftCreated = Date.parse(left.createdAt ?? "");
  const rightCreated = Date.parse(right.createdAt ?? "");
  if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated)) {
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }
  }

  return left.id.localeCompare(right.id);
}

function calculateSparseOrder(
  beforeOrder: number | null,
  afterOrder: number | null,
): number | null {
  if (beforeOrder === null && afterOrder === null) {
    return RESOURCE_ORDER_STEP;
  }

  if (beforeOrder === null) {
    const safeAfterOrder =
      typeof afterOrder === "number" ? afterOrder : RESOURCE_ORDER_STEP;
    const candidate = safeAfterOrder - RESOURCE_ORDER_STEP;
    return candidate > 0 ? candidate : null;
  }

  if (afterOrder === null) {
    return beforeOrder + RESOURCE_ORDER_STEP;
  }

  const gap = afterOrder - beforeOrder;
  if (gap <= 1) {
    return null;
  }

  return beforeOrder + Math.floor(gap / 2);
}

interface ApplyOptimisticMoveInput {
  resources: ResourceCard[];
  itemId: string;
  sourceCategoryId: string;
  targetCategoryId: string;
  targetCategoryName: string;
  sourceIndex: number;
  targetIndex: number;
  resolveCategoryId: (resource: ResourceCard) => string | null;
}

interface ApplyOptimisticMoveResult {
  resources: ResourceCard[];
  newOrder: number;
}

function applyOptimisticMove({
  resources,
  itemId,
  sourceCategoryId,
  targetCategoryId,
  targetCategoryName,
  sourceIndex,
  targetIndex,
  resolveCategoryId,
}: ApplyOptimisticMoveInput): ApplyOptimisticMoveResult | null {
  const moving = resources.find((resource) => resource.id === itemId);
  if (!moving) {
    return null;
  }

  const targetWithoutMoving = resources
    .filter((resource) => {
      if (resource.id === itemId) {
        return false;
      }

      return resolveCategoryId(resource) === targetCategoryId;
    })
    .sort(compareResourcesByOrder);

  const normalizedTargetIndex = Math.max(
    0,
    Math.min(
      targetWithoutMoving.length,
      sourceCategoryId === targetCategoryId && targetIndex > sourceIndex
        ? targetIndex - 1
        : targetIndex,
    ),
  );

  if (
    sourceCategoryId === targetCategoryId &&
    normalizedTargetIndex === sourceIndex
  ) {
    return null;
  }

  const before = targetWithoutMoving[normalizedTargetIndex - 1] ?? null;
  const after = targetWithoutMoving[normalizedTargetIndex] ?? null;
  const beforeOrder =
    typeof before?.order === "number" ? before.order : null;
  const afterOrder = typeof after?.order === "number" ? after.order : null;

  let nextOrder = calculateSparseOrder(beforeOrder, afterOrder);
  const orderUpdates = new Map<string, number>();

  if (nextOrder === null) {
    const rebalanced = [...targetWithoutMoving];
    for (let index = 0; index < rebalanced.length; index += 1) {
      orderUpdates.set(rebalanced[index].id, (index + 1) * RESOURCE_ORDER_STEP);
    }

    const rebalancedBeforeOrder =
      normalizedTargetIndex > 0
        ? normalizedTargetIndex * RESOURCE_ORDER_STEP
        : null;
    const rebalancedAfterOrder =
      normalizedTargetIndex < rebalanced.length
        ? (normalizedTargetIndex + 1) * RESOURCE_ORDER_STEP
        : null;
    nextOrder = calculateSparseOrder(rebalancedBeforeOrder, rebalancedAfterOrder);
  }

  if (nextOrder === null) {
    return null;
  }

  const nextResources = resources.map((resource) => {
    if (resource.id === itemId) {
      return {
        ...resource,
        categoryId: targetCategoryId,
        category: targetCategoryName,
        order: nextOrder,
      };
    }

    const patchedOrder = orderUpdates.get(resource.id);
    if (patchedOrder === undefined) {
      return resource;
    }

    return {
      ...resource,
      order: patchedOrder,
    };
  });

  return {
    resources: nextResources,
    newOrder: nextOrder,
  };
}

function createAskLibraryTurnId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeAiInboxCategory(
  rawCategory: string | null | undefined,
  fallbackCategory: string | null
): string {
  const trimmed = rawCategory?.trim() ?? "";
  if (trimmed.length > 0) {
    return trimmed;
  }

  if (fallbackCategory && fallbackCategory !== "All") {
    return fallbackCategory;
  }

  return "General";
}

function normalizeAiInboxCategoryKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toShortAiInboxCategoryName(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "General";
  }

  return normalized.split(" ").slice(0, 3).join(" ").slice(0, 28);
}

function scoreAiInboxItemPriority(item: AiInboxItem): number {
  let score = 0;
  if (item.selected) {
    score += 40;
  }

  score += item.usedAi ? 8 : 0;
  score += item.tags.length * 2;
  score += item.category?.trim() ? 4 : 0;
  score -= item.nearMatches.length * 12;
  score -= item.exactMatches.length * 50;
  return score;
}

function summarizeDuplicateMatches(matches: LinkDuplicateMatch[]): string {
  if (matches.length === 0) {
    return "none";
  }

  return matches
    .slice(0, 3)
    .map((match) => `${match.category}: ${match.linkLabel}`)
    .join(" | ");
}

function mergeLinkNotes(existing: string, incoming: string): string {
  const normalizedExisting = normalizeDraftNote(existing);
  const normalizedIncoming = normalizeDraftNote(incoming);
  if (!normalizedIncoming) {
    return normalizedExisting;
  }
  if (!normalizedExisting) {
    return normalizedIncoming;
  }

  if (
    normalizedExisting.toLowerCase().includes(normalizedIncoming.toLowerCase())
  ) {
    return normalizedExisting;
  }

  return normalizeDraftNote(`${normalizedExisting} | ${normalizedIncoming}`);
}

function snapSidebarWidth(width: number): number {
  return Math.round(width / SIDEBAR_SNAP_GRID) * SIDEBAR_SNAP_GRID;
}

function getDesktopSidebarMaxWidth(viewportWidth: number): number {
  return Math.max(
    DESKTOP_SIDEBAR_MIN_WIDTH,
    Math.floor((viewportWidth * 0.5) / SIDEBAR_SNAP_GRID) * SIDEBAR_SNAP_GRID,
  );
}

function getViewportWidth(): number {
  if (typeof window === "undefined") {
    return FALLBACK_VIEWPORT_WIDTH;
  }

  return window.innerWidth;
}

function clampDesktopSidebarWidth(
  width: number,
  viewportWidth = getViewportWidth(),
): number {
  const maxWidth = getDesktopSidebarMaxWidth(viewportWidth);

  return Math.min(
    maxWidth,
    Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, snapSidebarWidth(width)),
  );
}

function suggestTobyWorkspaceName(fileName: string | null): string {
  const normalizedFileName = fileName?.trim() ?? "";
  if (!normalizedFileName) {
    return DEFAULT_TOBY_WORKSPACE_NAME;
  }

  const withoutExtension = normalizedFileName.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || DEFAULT_TOBY_WORKSPACE_NAME;
}

function parseSectionPreferences(
  rawValue: string | null,
): SectionPreferences | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<SectionPreferences>;
    return {
      compactTitles:
        typeof parsed.compactTitles === "boolean"
          ? parsed.compactTitles
          : DEFAULT_SECTION_PREFERENCES.compactTitles,
      showContextLine:
        typeof parsed.showContextLine === "boolean"
          ? parsed.showContextLine
          : DEFAULT_SECTION_PREFERENCES.showContextLine,
      showRoleHints:
        typeof parsed.showRoleHints === "boolean"
          ? parsed.showRoleHints
          : DEFAULT_SECTION_PREFERENCES.showRoleHints,
      adminQuickActions:
        typeof parsed.adminQuickActions === "boolean"
          ? parsed.adminQuickActions
          : DEFAULT_SECTION_PREFERENCES.adminQuickActions,
    };
  } catch {
    return null;
  }
}

function parseGeneralSettingsPreferences(
  rawValue: string | null,
): GeneralSettingsPreferences | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<GeneralSettingsPreferences>;
    return {
      openLinksInSameTab:
        typeof parsed.openLinksInSameTab === "boolean"
          ? parsed.openLinksInSameTab
          : DEFAULT_GENERAL_SETTINGS.openLinksInSameTab,
      showAccountEmail:
        typeof parsed.showAccountEmail === "boolean"
          ? parsed.showAccountEmail
          : DEFAULT_GENERAL_SETTINGS.showAccountEmail,
      showAccountRole:
        typeof parsed.showAccountRole === "boolean"
          ? parsed.showAccountRole
          : DEFAULT_GENERAL_SETTINGS.showAccountRole,
      showMockModeBadge:
        typeof parsed.showMockModeBadge === "boolean"
          ? parsed.showMockModeBadge
          : DEFAULT_GENERAL_SETTINGS.showMockModeBadge,
      aiFeaturesEnabled:
        typeof parsed.aiFeaturesEnabled === "boolean"
          ? parsed.aiFeaturesEnabled
          : DEFAULT_GENERAL_SETTINGS.aiFeaturesEnabled,
    };
  } catch {
    return null;
  }
}

function buildLibrarySelectionStorageKey(
  organizationId: string | null,
  workspaceId: string | null,
): string {
  return [
    organizationId ?? "__all_organizations__",
    workspaceId ?? "__all_workspaces__",
  ].join("::");
}

function parsePersistedLibraryLocation(
  rawValue: string | null,
): PersistedLibraryLocation | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as {
      organizationId?: unknown;
      workspaceId?: unknown;
      scrollOffsetsBySelection?: unknown;
    };

    const scrollOffsetsBySelection: Record<string, number> = {};
    if (
      parsed.scrollOffsetsBySelection &&
      typeof parsed.scrollOffsetsBySelection === "object"
    ) {
      for (const [selectionKey, rawOffset] of Object.entries(
        parsed.scrollOffsetsBySelection as Record<string, unknown>,
      )) {
        if (!selectionKey) {
          continue;
        }

        const numericOffset =
          typeof rawOffset === "number" ? rawOffset : Number(rawOffset);
        if (!Number.isFinite(numericOffset) || numericOffset < 0) {
          continue;
        }

        scrollOffsetsBySelection[selectionKey] = Math.floor(numericOffset);
      }
    }

    return {
      organizationId: normalizePersistedId(parsed.organizationId),
      workspaceId: normalizePersistedId(parsed.workspaceId),
      scrollOffsetsBySelection,
    };
  } catch {
    return null;
  }
}

function writePersistedIdCookie(name: string, value: string | null) {
  if (typeof document === "undefined") {
    return;
  }

  const encodedName = encodeURIComponent(name);
  if (!value) {
    document.cookie = `${encodedName}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }

  const encodedValue = encodeURIComponent(value);
  document.cookie = `${encodedName}=${encodedValue}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function parseCompactQueryValue(rawValue: string | null): boolean | null {
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

interface LibraryPageClientProps {
  initialLibrarySnapshot: LibraryBootstrapResponse | null;
}

export default function LibraryPageClient({
  initialLibrarySnapshot,
}: LibraryPageClientProps) {
  const { data: session, status: sessionStatus } = useSession();
  const [organizations, setOrganizations] = useState<ResourceOrganization[]>(
    () => initialLibrarySnapshot?.organizations ?? [],
  );
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(
    () => initialLibrarySnapshot?.organizationId ?? null,
  );
  const [resources, setResources] = useState<ResourceCard[]>(
    () => initialLibrarySnapshot?.resources ?? [],
  );
  const [resourcesNextOffset, setResourcesNextOffset] = useState<number | null>(
    () => initialLibrarySnapshot?.nextOffset ?? null,
  );
  const [isLoadingMoreResources, setIsLoadingMoreResources] = useState(false);
  const [workspaces, setWorkspaces] = useState<ResourceWorkspace[]>(
    () => initialLibrarySnapshot?.workspaces ?? [],
  );
  const [workspaceResourceCounts, setWorkspaceResourceCounts] = useState<
    Record<string, number>
  >(() => initialLibrarySnapshot?.workspaceCounts ?? {});
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () => initialLibrarySnapshot?.workspaceId ?? null,
  );
  const [hasResolvedInitialWorkspace, setHasResolvedInitialWorkspace] =
    useState(false);
  const [categoryRecords, setCategoryRecords] = useState<ResourceCategory[]>(
    () => initialLibrarySnapshot?.categories ?? [],
  );
  const [activeCategory, setActiveCategory] = useState<string | "All">("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [aiInboxOpen, setAiInboxOpen] = useState(false);
  const [aiInboxRawInput, setAiInboxRawInput] = useState("");
  const [tobyImportOpen, setTobyImportOpen] = useState(false);
  const [tobyImportRawInput, setTobyImportRawInput] = useState("");
  const [tobyImportFileName, setTobyImportFileName] = useState<string | null>(
    null,
  );
  const [tobyImportCreateWorkspace, setTobyImportCreateWorkspace] =
    useState(false);
  const [tobyImportWorkspaceName, setTobyImportWorkspaceName] = useState(
    DEFAULT_TOBY_WORKSPACE_NAME,
  );
  const [tobyImportSkipExactDuplicates, setTobyImportSkipExactDuplicates] =
    useState(true);
  const [isTobyImportPreviewing, setIsTobyImportPreviewing] = useState(false);
  const [tobyImportPreview, setTobyImportPreview] =
    useState<TobyImportPreviewState | null>(null);
  const [aiInboxItems, setAiInboxItems] = useState<AiInboxItem[]>([]);
  const [aiInboxUseAi, setAiInboxUseAi] = useState(true);
  const [isAiInboxAnalyzing, setIsAiInboxAnalyzing] = useState(false);
  const [isAiInboxImporting, setIsAiInboxImporting] = useState(false);
  const [isTobyImporting, setIsTobyImporting] = useState(false);
  const [isAiInboxMerging, setIsAiInboxMerging] = useState(false);
  const [isAiInboxRenamingCategories, setIsAiInboxRenamingCategories] =
    useState(false);
  const [isAiInboxSummarizing, setIsAiInboxSummarizing] = useState(false);
  const [aiInboxSummary, setAiInboxSummary] = useState<AiInboxSummaryState | null>(
    null,
  );
  const [askLibraryOpen, setAskLibraryOpen] = useState(false);
  const [askLibraryQuery, setAskLibraryQuery] = useState("");
  const [askLibraryAnswer, setAskLibraryAnswer] = useState<string | null>(null);
  const [askLibraryCitations, setAskLibraryCitations] = useState<
    AskLibraryCitation[]
  >([]);
  const [askLibraryReasoning, setAskLibraryReasoning] =
    useState<AskLibraryReasoning | null>(null);
  const [askLibraryFollowUpSuggestions, setAskLibraryFollowUpSuggestions] =
    useState<string[]>([]);
  const [askLibraryConversation, setAskLibraryConversation] = useState<
    AskLibraryConversationTurn[]
  >([]);
  const [askLibraryThreadId, setAskLibraryThreadId] = useState<string | null>(
    null,
  );
  const [askLibraryThreads, setAskLibraryThreads] = useState<
    AskLibraryThreadSummary[]
  >([]);
  const [askLibraryUsedAi, setAskLibraryUsedAi] = useState(false);
  const [askLibraryModel, setAskLibraryModel] = useState<string | null>(null);
  const [askScopeWorkspace, setAskScopeWorkspace] = useState(true);
  const [askScopeCategory, setAskScopeCategory] = useState(true);
  const [askScopeTags, setAskScopeTags] = useState(false);
  const [askScopeSelectedTags, setAskScopeSelectedTags] = useState<string[]>([]);
  const [isAskLibraryThreadsLoading, setIsAskLibraryThreadsLoading] =
    useState(false);
  const [isAskLibraryThreadLoading, setIsAskLibraryThreadLoading] =
    useState(false);
  const [askLibraryThreadsError, setAskLibraryThreadsError] =
    useState<string | null>(null);
  const [isAskingLibrary, setIsAskingLibrary] = useState(false);
  const [initialLinkDraft, setInitialLinkDraft] =
    useState<PastedLinkDraft | null>(null);
  const [initialCategoryDraft, setInitialCategoryDraft] = useState<
    string | null
  >(null);
  const [initialTagsDraft, setInitialTagsDraft] = useState<string[]>([]);
  const [clipboardUrlForPaste, setClipboardUrlForPaste] = useState<
    string | null
  >(null);
  const [aiPastePromptDecision, setAiPastePromptDecision] =
    useState<AiPastePromptDecision | null>(null);
  const [isAiPastePreferenceLoading, setIsAiPastePreferenceLoading] =
    useState(false);
  const [isAiPastePreferenceSaving, setIsAiPastePreferenceSaving] =
    useState(false);
  const [aiPastePromptOpen, setAiPastePromptOpen] = useState(false);
  const [pendingPasteUrl, setPendingPasteUrl] = useState<string | null>(null);
  const [pendingPasteCategory, setPendingPasteCategory] = useState<
    string | null
  >(null);
  const [pasteFlowActivityCount, setPasteFlowActivityCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarWidth, setDesktopSidebarWidth] = useState<number>(
    clampDesktopSidebarWidth(DESKTOP_SIDEBAR_DEFAULT_WIDTH),
  );
  const [viewportWidth, setViewportWidth] = useState<number>(
    FALLBACK_VIEWPORT_WIDTH,
  );
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const hasLoadedSidebarWidthRef = useRef(false);
  const resizeRafIdRef = useRef<number | null>(null);
  const pendingSidebarWidthRef = useRef<number | null>(null);
  const snapshotRequestIdRef = useRef(0);
  const snapshotInFlightSelectionKeyRef = useRef<string | null>(null);
  const loadedSnapshotSelectionKeyRef = useRef<string | null>(
    initialLibrarySnapshot
      ? buildLibrarySelectionStorageKey(
          initialLibrarySnapshot.organizationId ?? null,
          initialLibrarySnapshot.workspaceId ?? null,
        )
      : null,
  );
  const previousOrganizationIdRef = useRef<string | null>(null);
  const previousWorkspaceIdRef = useRef<string | null>(null);
  const [editingResource, setEditingResource] = useState<ResourceCard | null>(
    null,
  );
  const [isResourcesLoading, setIsResourcesLoading] = useState(
    initialLibrarySnapshot === null,
  );
  const [isOrganizationsLoading, setIsOrganizationsLoading] = useState(
    initialLibrarySnapshot === null,
  );
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(
    initialLibrarySnapshot === null,
  );
  const [isWorkspacesLoading, setIsWorkspacesLoading] = useState(
    initialLibrarySnapshot === null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [deletingResourceId, setDeletingResourceId] = useState<string | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [organizationLoadError, setOrganizationLoadError] =
    useState<string | null>(null);
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(
    null,
  );
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(
    null,
  );
  const [workspaceCountsError, setWorkspaceCountsError] =
    useState<string | null>(null);
  const [dataMode, setDataMode] = useState<"database" | "mock">(
    initialLibrarySnapshot?.mode === "database" ? "database" : "mock",
  );
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [isRequestingPasswordReset, setIsRequestingPasswordReset] =
    useState(false);
  const [deleteAccountDialogOpen, setDeleteAccountDialogOpen] = useState(false);
  const [deleteAccountEmailConfirm, setDeleteAccountEmailConfirm] =
    useState("");
  const [deleteAccountPhraseConfirm, setDeleteAccountPhraseConfirm] =
    useState("");
  const [hasExportedAccountData, setHasExportedAccountData] = useState(false);
  const [isExportingAccountData, setIsExportingAccountData] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [createCategoryDialogOpen, setCreateCategoryDialogOpen] =
    useState(false);
  const [editCategoryDialogOpen, setEditCategoryDialogOpen] = useState(false);
  const [editingCategoryRecord, setEditingCategoryRecord] =
    useState<ResourceCategory | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategorySymbol, setEditingCategorySymbol] = useState("");
  const [isSuggestingCategoryName, setIsSuggestingCategoryName] =
    useState(false);
  const [createWorkspaceDialogOpen, setCreateWorkspaceDialogOpen] =
    useState(false);
  const [createOrganizationDialogOpen, setCreateOrganizationDialogOpen] =
    useState(false);
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [isOrganizationMutating, setIsOrganizationMutating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isWorkspaceMutating, setIsWorkspaceMutating] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategorySymbol, setNewCategorySymbol] = useState("");
  const [isCategoryMutating, setIsCategoryMutating] = useState(false);
  const [generalSettingsOpen, setGeneralSettingsOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [workspaceRenameInput, setWorkspaceRenameInput] = useState("");
  const [isWorkspaceRenaming, setIsWorkspaceRenaming] = useState(false);
  const [isWorkspaceDeleting, setIsWorkspaceDeleting] = useState(false);
  const [isRefreshingLibrary, setIsRefreshingLibrary] = useState(false);
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState(false);
  const [sectionPreferences, setSectionPreferences] =
    useState<SectionPreferences>(DEFAULT_SECTION_PREFERENCES);
  const [generalSettings, setGeneralSettings] =
    useState<GeneralSettingsPreferences>(DEFAULT_GENERAL_SETTINGS);
  const [isReallyCompactMode, setIsReallyCompactMode] = useState(false);
  const [hasHydratedCompactMode, setHasHydratedCompactMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resourceScrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollOffsetsBySelectionRef = useRef<Record<string, number>>({});
  const pendingScrollRestoreSelectionKeyRef = useRef<string | null>(null);
  const hasSeenResourcesLoadingForScrollRestoreRef = useRef(false);
  const scrollPersistRafRef = useRef<number | null>(null);
  const scrollRestoreRafRef = useRef<number | null>(null);
  const isApplyingScrollRestoreRef = useRef(false);
  const {
    schemes: colorSchemes,
    currentSchemeIndex,
    isSaving: isSavingColorScheme,
  } = useColorScheme();

  const isAuthenticated = Boolean(session?.user?.id);
  const isAdmin = Boolean(session?.user?.isAdmin);
  const isFirstAdmin = Boolean(session?.user?.isFirstAdmin);
  const userRole = deriveUserRole({
    role: session?.user?.role ?? null,
    isAdmin,
    isFirstAdmin,
  });
  const roleLabel =
    userRole === "first_admin"
      ? "FirstAdmin"
      : userRole === "admin"
        ? "Admin"
        : userRole === "editor"
          ? "Editor"
          : "Viewer";
  const sessionUserId = session?.user?.id ?? null;
  const ownedWorkspaceCount =
    sessionUserId === null
      ? 0
      : workspaces.filter(
          (workspace) => workspace.ownerUserId === sessionUserId,
        ).length;
  const canCreateOrganizations = hasAdminAccess(userRole);
  const canCreateWorkspaces = isAuthenticated && ownedWorkspaceCount < 1;
  const canManageResources = isAuthenticated && canCreateResources(userRole);
  const canManageCategories = hasAdminAccess(userRole);
  const canSubmitAuth = authEmail.trim().length > 0 && authPassword.length > 0;
  const normalizedSessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const canSubmitDeleteAccount =
    isAuthenticated &&
    normalizedSessionEmail.length > 0 &&
    hasExportedAccountData &&
    !isDeletingAccount &&
    deleteAccountEmailConfirm.trim().toLowerCase() === normalizedSessionEmail &&
    deleteAccountPhraseConfirm.trim() === "DELETE MY ACCOUNT";
  const canSubmitOrganization =
    canCreateOrganizations &&
    newOrganizationName.trim().length > 0 &&
    !isOrganizationMutating;
  const canSubmitWorkspace =
    canCreateWorkspaces &&
    newWorkspaceName.trim().length > 0 &&
    !isWorkspaceMutating;
  const canSubmitCategory =
    newCategoryName.trim().length > 0 &&
    !isCategoryMutating &&
    canManageCategories &&
    Boolean(activeWorkspaceId);
  const canSubmitCategoryCustomization =
    Boolean(editingCategoryRecord) &&
    !isCategoryMutating &&
    editingCategoryName.trim().length > 0 &&
    (editingCategoryName.trim() !== (editingCategoryRecord?.name ?? "") ||
      editingCategorySymbol.trim() !==
        (editingCategoryRecord?.symbol?.trim() ?? ""));
  const canUseAiFeatures = isAuthenticated && generalSettings.aiFeaturesEnabled;
  const isPasteFlowInProgress = pasteFlowActivityCount > 0;
  const isAiInboxBusy =
    isAiInboxAnalyzing ||
    isAiInboxImporting ||
    isAiInboxMerging ||
    isAiInboxRenamingCategories ||
    isAiInboxSummarizing;
  const globalActivityMessage = useMemo(() => {
    if (isPasteFlowInProgress) {
      return "Processing pasted URL...";
    }
    if (isRefreshingLibrary) {
      return "Refreshing library...";
    }
    if (isLoadingMoreResources) {
      return "Loading more resources...";
    }
    if (isAiInboxAnalyzing) {
      return "Analyzing AI inbox links...";
    }
    if (isAiInboxImporting) {
      return "Importing AI inbox links...";
    }
    if (isAiInboxMerging) {
      return "Merging duplicate links...";
    }
    if (isAiInboxRenamingCategories) {
      return "Renaming categories...";
    }
    if (isAiInboxSummarizing) {
      return "Summarizing AI inbox...";
    }
    if (isAskingLibrary) {
      return "Analyzing your library...";
    }
    if (isAskLibraryThreadLoading) {
      return "Loading Ask Library thread...";
    }
    if (isAskLibraryThreadsLoading) {
      return "Loading Ask Library threads...";
    }
    if (isSaving) {
      return "Saving resource...";
    }
    if (deletingResourceId) {
      return "Archiving resource...";
    }
    if (isCategoryMutating) {
      return "Updating category...";
    }
    if (isOrganizationMutating) {
      return "Updating organization...";
    }
    if (isWorkspaceMutating) {
      return "Updating workspace...";
    }
    if (isWorkspaceRenaming) {
      return "Renaming workspace...";
    }
    if (isWorkspaceDeleting) {
      return "Deleting workspace...";
    }
    if (isSuggestingCategoryName) {
      return "Generating AI category suggestion...";
    }
    if (isAuthSubmitting) {
      return authMode === "register" ? "Creating account..." : "Signing in...";
    }
    if (isResendingVerification) {
      return "Resending verification email...";
    }
    if (isRequestingPasswordReset) {
      return "Preparing password reset email...";
    }
    if (isExportingAccountData) {
      return "Exporting account data...";
    }
    if (isDeletingAccount) {
      return "Deleting account...";
    }
    if (isAiPastePreferenceSaving) {
      return "Saving AI paste preference...";
    }
    if (isSavingColorScheme) {
      return "Saving color scheme...";
    }
    return null;
  }, [
    authMode,
    deletingResourceId,
    isAskLibraryThreadLoading,
    isAskLibraryThreadsLoading,
    isAiInboxAnalyzing,
    isAiInboxImporting,
    isAiInboxMerging,
    isAiInboxRenamingCategories,
    isAiInboxSummarizing,
    isAiPastePreferenceSaving,
    isAskingLibrary,
    isAuthSubmitting,
    isCategoryMutating,
    isOrganizationMutating,
    isLoadingMoreResources,
    isPasteFlowInProgress,
    isRefreshingLibrary,
    isExportingAccountData,
    isDeletingAccount,
    isRequestingPasswordReset,
    isResendingVerification,
    isSaving,
    isSavingColorScheme,
    isSuggestingCategoryName,
    isWorkspaceDeleting,
    isWorkspaceMutating,
    isWorkspaceRenaming,
  ]);
  const desktopSidebarMaxWidth = getDesktopSidebarMaxWidth(viewportWidth);
  const updateSectionPreference = useCallback(
    (key: keyof SectionPreferences, checked: boolean) => {
      setSectionPreferences((previous) => ({
        ...previous,
        [key]: checked,
      }));
    },
    [],
  );
  const updateGeneralSetting = useCallback(
    (key: keyof GeneralSettingsPreferences, checked: boolean) => {
      setGeneralSettings((previous) => ({
        ...previous,
        [key]: checked,
      }));
    },
    [],
  );
  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const fetchAiPastePreference = useCallback(async () => {
    if (!sessionUserId) {
      setAiPastePromptDecision(null);
      return null;
    }

    setIsAiPastePreferenceLoading(true);
    try {
      const response = await fetch("/api/preferences/ai-paste", {
        cache: "no-store",
      });
      const payload = await readJson<AiPastePreferenceResponse>(response);
      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Failed to load AI paste preference.",
        );
      }

      const decision =
        payload?.decision === "accepted" || payload?.decision === "declined"
          ? payload.decision
          : null;
      setAiPastePromptDecision(decision);
      return decision;
    } catch (error) {
      console.error("Failed to fetch AI paste preference:", error);
      setAiPastePromptDecision(null);
      return null;
    } finally {
      setIsAiPastePreferenceLoading(false);
    }
  }, [sessionUserId]);

  const saveAiPastePreference = useCallback(
    async (decision: AiPastePromptDecision) => {
      if (!sessionUserId) {
        setAiPastePromptDecision(decision);
        return;
      }

      setIsAiPastePreferenceSaving(true);
      try {
        const response = await fetch("/api/preferences/ai-paste", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ decision }),
        });
        const payload = await readJson<AiPastePreferenceResponse>(response);
        if (!response.ok) {
          throw new Error(
            payload?.error ?? "Failed to save AI paste preference.",
          );
        }

        setAiPastePromptDecision(decision);
      } catch (error) {
        setAiPastePromptDecision(decision);
        toast.error("Could not save AI preference", {
          description:
            error instanceof Error
              ? `${error.message} Keeping this choice for this session.`
              : "Keeping this choice for this session.",
        });
      } finally {
        setIsAiPastePreferenceSaving(false);
      }
    },
    [sessionUserId],
  );

  const readClipboardUrl = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      setClipboardUrlForPaste(null);
      return null;
    }

    try {
      const rawClipboard = await navigator.clipboard.readText();
      const url = normalizeHttpUrl(rawClipboard);
      setClipboardUrlForPaste(url);
      return url;
    } catch {
      setClipboardUrlForPaste(null);
      return null;
    }
  }, []);

  const buildLinkDraftForPaste = useCallback(
    async (url: string, useAi: boolean): Promise<PastedLinkDraft> => {
      const fallback = buildLinkDraftFromUrl(url);
      if (!useAi) {
        return fallback;
      }

      const categoryHints = categoryRecords
        .filter((category) =>
          activeWorkspaceId ? category.workspaceId === activeWorkspaceId : true,
        )
        .map((category) => category.name)
        .filter((name) => name.trim().length > 0);

      try {
        const response = await fetch("/api/links/suggest-from-url", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: fallback.url,
            categories: categoryHints,
          }),
        });
        const payload = await readJson<LinkSuggestionResponse>(response);
        if (!response.ok) {
          throw new Error(
            payload?.error ?? "Failed to fetch AI paste suggestion.",
          );
        }

        return {
          url: normalizeHttpUrl(payload?.url ?? "") ?? fallback.url,
          label: normalizeDraftLabel(payload?.label ?? fallback.label),
          note: normalizeDraftNote(payload?.note ?? fallback.note),
          category: normalizeDraftCategory(payload?.category ?? "") ?? null,
          tags: normalizeDraftTags(payload?.tags ?? []),
        };
      } catch (error) {
        toast.error("AI paste fallback", {
          description:
            error instanceof Error
              ? `${error.message} Using standard paste fields instead.`
              : "Using standard paste fields instead.",
        });
        return fallback;
      }
    },
    [activeWorkspaceId, categoryRecords],
  );

  const openCreateModalFromPastedUrl = useCallback(
    async (url: string, useAi: boolean, targetCategory?: string | null) => {
      const draft = await buildLinkDraftForPaste(url, useAi);
      const duplicateInsight = detectLinkDuplicates({
        links: [{ url: draft.url, label: draft.label }],
        resources,
        workspaceId: activeWorkspaceId,
      });
      if (duplicateInsight.exactMatches.length > 0) {
        toast.warning("Possible duplicate link", {
          description: `Already saved: ${summarizeDuplicateMatches(
            duplicateInsight.exactMatches
          )}`,
        });
      } else if (duplicateInsight.nearMatches.length > 0) {
        toast.message("Similar links found", {
          description: `Related entries: ${summarizeDuplicateMatches(
            duplicateInsight.nearMatches
          )}`,
        });
      }

      setEditingResource(null);
      setInitialLinkDraft(draft);
      const resolvedCategory =
        targetCategory?.trim() ||
        normalizeDraftCategory(draft.category ?? "") ||
        null;
      setInitialCategoryDraft(resolvedCategory);
      setInitialTagsDraft(normalizeDraftTags(draft.tags ?? []));
      setModalOpen(true);
    },
    [activeWorkspaceId, buildLinkDraftForPaste, resources],
  );

  const handlePasteFromClipboard = useCallback(
    async (
      targetCategory?: string | null,
      providedUrl?: string | null,
    ): Promise<void> => {
      setPasteFlowActivityCount((current) => current + 1);
      try {
        if (!canManageResources) {
          toast.error("Insufficient permissions", {
            description: "You do not have access to create resource cards.",
          });
          return;
        }

        if (!activeWorkspaceId) {
          toast.error("Workspace unavailable", {
            description: "Select a workspace before pasting a link.",
          });
          return;
        }

        let pastedUrl =
          providedUrl ?? clipboardUrlForPaste ?? (await readClipboardUrl());
        if (!pastedUrl && typeof window !== "undefined") {
          const manualInput = window.prompt(
            "Paste an http(s) URL to continue:",
            "",
          );
          pastedUrl = normalizeHttpUrl(manualInput ?? "");
        }
        if (!pastedUrl) {
          toast.error("No valid URL in clipboard", {
            description: "Copy an http(s) URL first, then try pasting again.",
          });
          return;
        }

        if (canUseAiFeatures) {
          await openCreateModalFromPastedUrl(pastedUrl, true, targetCategory);
          return;
        }

        let decision = aiPastePromptDecision;
        if (decision === null && !isAiPastePreferenceLoading) {
          decision = await fetchAiPastePreference();
        }

        if (decision === null && isAuthenticated) {
          setPendingPasteUrl(pastedUrl);
          setPendingPasteCategory(targetCategory?.trim() || null);
          setAiPastePromptOpen(true);
          return;
        }

        if (decision === "accepted") {
          updateGeneralSetting("aiFeaturesEnabled", true);
          await openCreateModalFromPastedUrl(pastedUrl, true, targetCategory);
          return;
        }

        await openCreateModalFromPastedUrl(pastedUrl, false, targetCategory);
      } finally {
        setPasteFlowActivityCount((current) => Math.max(0, current - 1));
      }
    },
    [
      activeWorkspaceId,
      aiPastePromptDecision,
      canManageResources,
      canUseAiFeatures,
      clipboardUrlForPaste,
      fetchAiPastePreference,
      isAiPastePreferenceLoading,
      isAuthenticated,
      openCreateModalFromPastedUrl,
      readClipboardUrl,
      updateGeneralSetting,
    ],
  );

  const handleAiPastePromptChoice = useCallback(
    async (decision: AiPastePromptDecision) => {
      if (!pendingPasteUrl || isAiPastePreferenceSaving) {
        return;
      }

      setPasteFlowActivityCount((current) => current + 1);
      try {
        const url = pendingPasteUrl;
        const targetCategory = pendingPasteCategory;
        await saveAiPastePreference(decision);
        setAiPastePromptOpen(false);
        setPendingPasteUrl(null);
        setPendingPasteCategory(null);

        if (decision === "accepted") {
          updateGeneralSetting("aiFeaturesEnabled", true);
          await openCreateModalFromPastedUrl(url, true, targetCategory);
          return;
        }

        await openCreateModalFromPastedUrl(url, false, targetCategory);
      } finally {
        setPasteFlowActivityCount((current) => Math.max(0, current - 1));
      }
    },
    [
      isAiPastePreferenceSaving,
      openCreateModalFromPastedUrl,
      pendingPasteCategory,
      pendingPasteUrl,
      saveAiPastePreference,
      updateGeneralSetting,
    ],
  );

  const handleLibraryContextMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setClipboardUrlForPaste(null);
        return;
      }

      if (!canManageResources) {
        return;
      }

      void readClipboardUrl();
    },
    [canManageResources, readClipboardUrl],
  );

  const handlePasteIntoCategory = useCallback(
    (categoryName: string) => {
      void handlePasteFromClipboard(categoryName);
    },
    [handlePasteFromClipboard],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleWindowPaste = (event: ClipboardEvent) => {
      if (!canManageResources || !activeWorkspaceId) {
        return;
      }

      const target = event.target;
      if (target instanceof Element) {
        const editableTarget = target.closest(
          "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']",
        );
        if (editableTarget) {
          return;
        }
      }

      const rawClipboard =
        event.clipboardData?.getData("text/plain") ??
        event.clipboardData?.getData("text") ??
        "";
      const pastedUrl = normalizeHttpUrl(rawClipboard);
      if (!pastedUrl) {
        return;
      }

      event.preventDefault();
      setClipboardUrlForPaste(pastedUrl);
      void handlePasteFromClipboard(
        activeCategory === "All" ? null : activeCategory,
        pastedUrl,
      );
    };

    window.addEventListener("paste", handleWindowPaste);
    return () => {
      window.removeEventListener("paste", handleWindowPaste);
    };
  }, [
    activeCategory,
    activeWorkspaceId,
    canManageResources,
    handlePasteFromClipboard,
  ]);

  const canManageResourceCard = useCallback(
    (resource: ResourceCard | null | undefined) => {
      if (!resource) {
        return false;
      }

      return canManageResourceByRole(
        userRole,
        sessionUserId,
        resource.ownerUserId ?? null,
      );
    },
    [sessionUserId, userRole],
  );

  const isDesktopSidebarEnabled = useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.innerWidth >= MOBILE_STACK_BREAKPOINT;
  }, []);

  const queueSidebarWidthUpdate = useCallback((nextWidth: number) => {
    if (typeof window === "undefined") {
      return;
    }

    pendingSidebarWidthRef.current = nextWidth;
    if (resizeRafIdRef.current !== null) {
      return;
    }

    resizeRafIdRef.current = window.requestAnimationFrame(() => {
      resizeRafIdRef.current = null;
      const pendingWidth = pendingSidebarWidthRef.current;
      if (pendingWidth === null) {
        return;
      }

      pendingSidebarWidthRef.current = null;
      setDesktopSidebarWidth(pendingWidth);
    });
  }, []);

  const activeOrganization = useMemo(() => {
    if (!activeOrganizationId) {
      return null;
    }

    return (
      organizations.find((organization) => organization.id === activeOrganizationId) ??
      null
    );
  }, [activeOrganizationId, organizations]);
  const activeWorkspace = useMemo(() => {
    if (!activeWorkspaceId) {
      return null;
    }

    return (
      workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    );
  }, [activeWorkspaceId, workspaces]);
  const resolvedActiveOrganizationId = activeOrganization?.id ?? null;
  const resolvedActiveWorkspaceId = activeWorkspace?.id ?? null;
  const hasActiveWorkspace = Boolean(activeWorkspace);

  const resourcesInActiveWorkspace = useMemo(() => {
    if (!activeWorkspaceId) {
      return [];
    }

    return resources.filter(
      (resource) => resource.workspaceId === activeWorkspaceId,
    );
  }, [activeWorkspaceId, resources]);

  const resourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const resource of resourcesInActiveWorkspace) {
      counts[resource.category] = (counts[resource.category] ?? 0) + 1;
    }

    return counts;
  }, [resourcesInActiveWorkspace]);

  const categories = useMemo(() => {
    if (!activeWorkspaceId) {
      return [];
    }

    const uniqueByKey = new Map<string, string>();

    for (const categoryRecord of categoryRecords) {
      if (categoryRecord.workspaceId !== activeWorkspaceId) {
        continue;
      }

      const normalized = categoryRecord.name.trim();
      if (!normalized) {
        continue;
      }

      uniqueByKey.set(normalized.toLowerCase(), normalized);
    }

    for (const resource of resourcesInActiveWorkspace) {
      const normalized = resource.category.trim();
      if (!normalized) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (!uniqueByKey.has(key)) {
        uniqueByKey.set(key, normalized);
      }
    }

    return [...uniqueByKey.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [activeWorkspaceId, categoryRecords, resourcesInActiveWorkspace]);

  const categorySymbols = useMemo(() => {
    const next: Record<string, string | undefined> = {};
    if (!activeWorkspaceId) {
      return next;
    }

    for (const category of categoryRecords) {
      if (category.workspaceId !== activeWorkspaceId) {
        continue;
      }

      const normalized = category.name.trim();
      if (!normalized) {
        continue;
      }

      const symbol = category.symbol?.trim();
      next[normalized] = symbol || undefined;
    }
    return next;
  }, [activeWorkspaceId, categoryRecords]);

  const filteredResources = useMemo(() => {
    let result = resourcesInActiveWorkspace;

    if (activeCategory !== "All") {
      result = result.filter(
        (resource) => resource.category === activeCategory,
      );
    }

    if (searchQuery.trim()) {
      const normalizedSearchQuery = searchQuery.toLowerCase();
      result = result.filter(
        (resource) =>
          resource.category.toLowerCase().includes(normalizedSearchQuery) ||
          resource.tags.some((tag) =>
            tag.toLowerCase().includes(normalizedSearchQuery),
          ) ||
          resource.links.some(
            (link) =>
              link.label.toLowerCase().includes(normalizedSearchQuery) ||
              link.url.toLowerCase().includes(normalizedSearchQuery) ||
              link.note?.toLowerCase().includes(normalizedSearchQuery),
          ),
      );
    }

    return result;
  }, [resourcesInActiveWorkspace, activeCategory, searchQuery]);
  const askScopeTagOptions = useMemo(() => {
    const sourceResources = askScopeWorkspace
      ? resourcesInActiveWorkspace
      : resources;
    const deduped = new Map<string, string>();

    for (const resource of sourceResources) {
      for (const tag of resource.tags) {
        const normalized = tag.trim();
        if (!normalized) {
          continue;
        }

        const key = normalized.toLowerCase();
        if (!deduped.has(key)) {
          deduped.set(key, normalized);
        }
      }
    }

    return [...deduped.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [askScopeWorkspace, resources, resourcesInActiveWorkspace]);
  const aiInboxSelectedCount = useMemo(
    () => aiInboxItems.filter((item) => item.selected).length,
    [aiInboxItems],
  );
  const aiInboxMergeCandidateCount = useMemo(
    () =>
      aiInboxItems.filter(
        (item) => item.selected && item.exactMatches.length > 0,
      ).length,
    [aiInboxItems],
  );
  const aiInboxExactMatchCount = useMemo(
    () => aiInboxItems.reduce((count, item) => count + item.exactMatches.length, 0),
    [aiInboxItems],
  );
  const isWorkspaceSelectionPending =
    (isOrganizationsLoading || isWorkspacesLoading) &&
    !activeWorkspaceId &&
    workspaces.length === 0;
  const showResourceSkeleton =
    !loadError &&
    filteredResources.length === 0 &&
    (isResourcesLoading || isWorkspaceSelectionPending);
  const showResourceLoadError =
    Boolean(loadError) && !isResourcesLoading && resources.length === 0;
  const isResourceActionDisabled = isResourcesLoading || !activeWorkspaceId;
  const showOrganizationsEmptyState =
    !isOrganizationsLoading && organizations.length === 0;
  const showWorkspacesEmptyState =
    !isWorkspacesLoading && Boolean(activeOrganizationId) && workspaces.length === 0;
  const showCategoriesEmptyState =
    !isCategoriesLoading && Boolean(activeWorkspaceId) && categories.length === 0;
  const activeWorkspaceResourceTotal = activeWorkspaceId
    ? (workspaceResourceCounts[activeWorkspaceId] ?? resourcesInActiveWorkspace.length)
    : resourcesInActiveWorkspace.length;
  const hasMoreResources = resourcesNextOffset !== null;

  const activeCategoryCount =
    activeCategory === "All"
      ? activeWorkspaceResourceTotal
      : (resourceCounts[activeCategory] ?? 0);
  const activeCategorySymbol =
    activeCategory === "All" ? null : (categorySymbols[activeCategory] ?? null);
  const activeSectionTitle =
    activeCategory === "All" ? "All Resources" : activeCategory;
  const isSearchActive = searchQuery.trim().length > 0;
  const sectionRoleHint = useMemo(() => {
    if (!isAuthenticated) {
      return "Guest mode: sign in to create workspaces, categories, and copy paste with ai features etc.";
    }

    if (canManageCategories) {
      return "Admin mode: category governance and moderation controls are enabled.";
    }

    if (canManageResources) {
      return "Editor mode: create and manage your own resource cards.";
    }

    return "Viewer mode: browse only. Ask FirstAdmin for elevated access.";
  }, [canManageCategories, canManageResources, isAuthenticated]);
  const organizationDisplayName = activeOrganization?.name
    ? activeOrganization.name
    : "Public";
  const workspaceDisplayName = activeWorkspace?.name
    ? activeWorkspace.name
    : isAuthenticated
      ? "No Workspace"
      : "Main Workspace";
  const sidebarHeadingLabel = sectionPreferences.compactTitles
    ? "Explorer"
    : "Category Explorer";
  const sidebarHeadingMeta = sectionPreferences.showContextLine
    ? `${organizationDisplayName} / ${workspaceDisplayName} / ${categories.length} categories`
    : undefined;
  const mainSectionPillLabel = isSearchActive
    ? "Search Results"
    : activeCategory === "All"
      ? "Resource Library"
      : "Category Focus";
  const mainSectionMetaLine = sectionPreferences.showContextLine
    ? `Organization: ${organizationDisplayName} / Workspace: ${workspaceDisplayName}`
    : null;
  const capabilityBadges = useMemo(() => {
    const badges: string[] = [];

    if (isAuthenticated) {
      badges.push(`Workspaces ${Math.min(ownedWorkspaceCount, 1)}/1`);
    }
    if (canManageResources) {
      badges.push("Cards");
    }
    if (canManageCategories) {
      badges.push("Categories");
    }
    if (isAdmin) {
      badges.push("Admin Tools");
    }

    return badges;
  }, [
    canManageCategories,
    canManageResources,
    isAdmin,
    isAuthenticated,
    ownedWorkspaceCount,
  ]);

  const categoryRecordByLowerName = useMemo(() => {
    const next = new Map<string, ResourceCategory>();
    for (const category of categoryRecords) {
      if (activeWorkspaceId && category.workspaceId !== activeWorkspaceId) {
        continue;
      }
      next.set(category.name.toLowerCase(), category);
    }
    return next;
  }, [activeWorkspaceId, categoryRecords]);

  const activeCategoryRecord = useMemo(() => {
    if (activeCategory === "All") {
      return null;
    }

    return categoryRecordByLowerName.get(activeCategory.toLowerCase()) ?? null;
  }, [activeCategory, categoryRecordByLowerName]);

  const canEditCategoryByName = useCallback(
    (categoryName: string) => {
      if (!sessionUserId || categoryName === "All") {
        return false;
      }

      const categoryRecord =
        categoryRecordByLowerName.get(categoryName.toLowerCase()) ?? null;
      if (!categoryRecord?.ownerUserId) {
        return false;
      }

      return categoryRecord.ownerUserId === sessionUserId;
    },
    [categoryRecordByLowerName, sessionUserId],
  );
  const resolveResourceCategoryId = useCallback(
    (resource: ResourceCard): string | null => {
      if (resource.categoryId) {
        return resource.categoryId;
      }

      const categoryRecord =
        categoryRecordByLowerName.get(resource.category.toLowerCase()) ?? null;
      return categoryRecord?.id ?? null;
    },
    [categoryRecordByLowerName],
  );
  const boardColumns = useMemo(() => {
    const columnNames =
      activeCategory === "All" ? categories : [activeCategory];

    const filteredColumnNames =
      isSearchActive && activeCategory === "All"
        ? columnNames.filter((name) =>
            filteredResources.some((resource) => resource.category === name),
          )
        : columnNames;

    return filteredColumnNames.map((name) => {
      const record = categoryRecordByLowerName.get(name.toLowerCase()) ?? null;
      return {
        id: record?.id ?? null,
        name,
        symbol: categorySymbols[name] ?? null,
      };
    });
  }, [
    activeCategory,
    categories,
    categoryRecordByLowerName,
    categorySymbols,
    filteredResources,
    isSearchActive,
  ]);

  const activeColorScheme =
    colorSchemes[currentSchemeIndex] ?? colorSchemes[0] ?? null;

  const fetchWorkspaceCounts = useCallback(async () => {
    setWorkspaceCountsError(null);
    try {
      const response = await fetch("/api/workspaces/counts", {
        cache: "no-store",
      });
      const payload = await readJson<WorkspaceCountsResponse>(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load workspace counts.");
      }

      setWorkspaceResourceCounts(payload?.countsByWorkspace ?? {});
      if (payload?.mode) {
        setDataMode(payload.mode);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load workspace counts.";
      setWorkspaceCountsError(message);
      console.error(
        "Failed to fetch workspace counts:",
        message,
      );
    }
  }, []);

  const loadLibrarySnapshot = useCallback(
    async (selection: {
      organizationId: string | null;
      workspaceId: string | null;
    }) => {
      const selectionKey = buildLibrarySelectionStorageKey(
        selection.organizationId,
        selection.workspaceId,
      );
      if (snapshotInFlightSelectionKeyRef.current === selectionKey) {
        return;
      }
      snapshotInFlightSelectionKeyRef.current = selectionKey;

      const requestId = snapshotRequestIdRef.current + 1;
      snapshotRequestIdRef.current = requestId;
      setIsResourcesLoading(true);
      setIsOrganizationsLoading(true);
      setIsCategoriesLoading(true);
      setIsWorkspacesLoading(true);
      setLoadError(null);
      setOrganizationLoadError(null);
      setWorkspaceLoadError(null);
      setCategoryLoadError(null);
      setWorkspaceCountsError(null);

      try {
        const params = new URLSearchParams();
        params.set("limit", String(RESOURCE_PAGE_SIZE));
        if (selection.organizationId) {
          params.set("organizationId", selection.organizationId);
        }
        if (selection.workspaceId) {
          params.set("workspaceId", selection.workspaceId);
        }

        const response = await fetch(
          `/api/library/bootstrap?${params.toString()}`,
          {
            cache: "no-store",
          },
        );
        const payload = await readJson<LibraryBootstrapResponse>(response);

        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to load library.");
        }

        if (snapshotRequestIdRef.current !== requestId) {
          return;
        }

        setResources(payload?.resources ?? []);
        setResourcesNextOffset(
          typeof payload?.nextOffset === "number" ? payload.nextOffset : null,
        );
        setOrganizations(payload?.organizations ?? []);
        setCategoryRecords(payload?.categories ?? []);
        setWorkspaces(payload?.workspaces ?? []);
        setWorkspaceResourceCounts(payload?.workspaceCounts ?? {});
        setDataMode(payload?.mode === "database" ? "database" : "mock");

        const resolvedOrganizationId = payload?.organizationId ?? null;
        const resolvedWorkspaceId = payload?.workspaceId ?? null;
        loadedSnapshotSelectionKeyRef.current = buildLibrarySelectionStorageKey(
          resolvedOrganizationId,
          resolvedWorkspaceId,
        );
        setActiveOrganizationId((previous) =>
          previous === resolvedOrganizationId ? previous : resolvedOrganizationId,
        );
        setActiveWorkspaceId((previous) =>
          previous === resolvedWorkspaceId ? previous : resolvedWorkspaceId,
        );
      } catch (error) {
        if (snapshotRequestIdRef.current !== requestId) {
          return;
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load library. Check the database setup and retry.",
        );
        setResourcesNextOffset(null);
      } finally {
        if (snapshotInFlightSelectionKeyRef.current === selectionKey) {
          snapshotInFlightSelectionKeyRef.current = null;
        }

        if (snapshotRequestIdRef.current !== requestId) {
          return;
        }

        setIsResourcesLoading(false);
        setIsOrganizationsLoading(false);
        setIsCategoriesLoading(false);
        setIsWorkspacesLoading(false);
      }
    },
    [],
  );

  const persistLibraryLocation = useCallback(
    (
      selection: { organizationId: string | null; workspaceId: string | null } = {
        organizationId: activeOrganizationId,
        workspaceId: activeWorkspaceId,
      },
    ) => {
      if (typeof window === "undefined") {
        return;
      }

      const nextValue: PersistedLibraryLocation = {
        organizationId: selection.organizationId,
        workspaceId: selection.workspaceId,
        scrollOffsetsBySelection: scrollOffsetsBySelectionRef.current,
      };

      window.localStorage.setItem(
        LIBRARY_LOCATION_STORAGE_KEY,
        JSON.stringify(nextValue),
      );
    },
    [activeOrganizationId, activeWorkspaceId],
  );

  const fetchCategories = useCallback(async () => {
    setIsCategoriesLoading(true);
    setCategoryLoadError(null);
    try {
      const params = new URLSearchParams();
      if (activeWorkspaceId) {
        params.set("workspaceId", activeWorkspaceId);
      }

      const response = await fetch(
        params.toString() ? `/api/categories?${params.toString()}` : "/api/categories",
        {
          cache: "no-store",
        },
      );
      const payload = await readJson<ListCategoriesResponse>(response);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load categories.");
      }

      setCategoryRecords(payload?.categories ?? []);
      if (payload?.mode) {
        setDataMode(payload.mode);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load categories.";
      setCategoryLoadError(message);
      console.error(
        "Failed to fetch categories:",
        message,
      );
    } finally {
      setIsCategoriesLoading(false);
    }
  }, [activeWorkspaceId]);

  const fetchWorkspaces = useCallback(async () => {
    setIsWorkspacesLoading(true);
    setWorkspaceLoadError(null);
    try {
      const params = new URLSearchParams();
      if (activeOrganizationId) {
        params.set("organizationId", activeOrganizationId);
      }
      const response = await fetch(
        params.toString() ? `/api/workspaces?${params.toString()}` : "/api/workspaces",
        {
          cache: "no-store",
        },
      );
      const payload = await readJson<ListWorkspacesResponse>(response);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load workspaces.");
      }

      setWorkspaces(payload?.workspaces ?? []);
      if (payload?.mode) {
        setDataMode(payload.mode);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load workspaces.";
      setWorkspaceLoadError(message);
      console.error(
        "Failed to fetch workspaces:",
        message,
      );
    } finally {
      setIsWorkspacesLoading(false);
    }
  }, [activeOrganizationId]);

  const fetchOrganizations = useCallback(async () => {
    setIsOrganizationsLoading(true);
    setOrganizationLoadError(null);
    try {
      const response = await fetch("/api/organizations", {
        cache: "no-store",
      });
      const payload = await readJson<ListOrganizationsResponse>(response);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load organizations.");
      }

      setOrganizations(payload?.organizations ?? []);
      if (payload?.mode) {
        setDataMode(payload.mode);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load organizations.";
      setOrganizationLoadError(message);
      console.error(
        "Failed to fetch organizations:",
        message,
      );
    } finally {
      setIsOrganizationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasResolvedInitialWorkspace) {
      return;
    }

    const selectionKey = buildLibrarySelectionStorageKey(
      activeOrganizationId,
      activeWorkspaceId,
    );
    if (loadedSnapshotSelectionKeyRef.current === selectionKey) {
      return;
    }

    void loadLibrarySnapshot({
      organizationId: activeOrganizationId,
      workspaceId: activeWorkspaceId,
    });
  }, [
    activeOrganizationId,
    activeWorkspaceId,
    hasResolvedInitialWorkspace,
    loadLibrarySnapshot,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const persistedLocation = parsePersistedLibraryLocation(
      window.localStorage.getItem(LIBRARY_LOCATION_STORAGE_KEY),
    );
    if (persistedLocation) {
      scrollOffsetsBySelectionRef.current =
        persistedLocation.scrollOffsetsBySelection;
    }

    const savedOrganizationId =
      persistedLocation?.organizationId ??
      normalizePersistedId(
        window.localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY),
      );
    if (savedOrganizationId) {
      setActiveOrganizationId(savedOrganizationId);
    }

    const savedWorkspaceId =
      persistedLocation?.workspaceId ??
      normalizePersistedId(
        window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY),
      );
    if (savedWorkspaceId) {
      setActiveWorkspaceId(savedWorkspaceId);
    }

    setHasResolvedInitialWorkspace(true);
  }, []);

  useEffect(() => {
    if (organizations.length === 0) {
      setActiveOrganizationId(null);
      return;
    }

    setActiveOrganizationId((previous) => {
      if (
        previous &&
        organizations.some((organization) => organization.id === previous)
      ) {
        return previous;
      }

      return organizations[0]?.id ?? null;
    });
  }, [organizations]);

  useEffect(() => {
    if (workspaces.length === 0) {
      setActiveWorkspaceId(null);
      return;
    }

    setActiveWorkspaceId((previous) => {
      if (
        previous &&
        workspaces.some((workspace) => workspace.id === previous)
      ) {
        return previous;
      }

      return workspaces[0]?.id ?? null;
    });
  }, [workspaces]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (activeOrganizationId) {
      window.localStorage.setItem(
        ACTIVE_ORGANIZATION_STORAGE_KEY,
        activeOrganizationId,
      );
    } else {
      window.localStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
    }

    writePersistedIdCookie(ACTIVE_ORGANIZATION_COOKIE, activeOrganizationId);
  }, [activeOrganizationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (activeWorkspaceId) {
      window.localStorage.setItem(
        ACTIVE_WORKSPACE_STORAGE_KEY,
        activeWorkspaceId,
      );
    } else {
      window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    }

    writePersistedIdCookie(ACTIVE_WORKSPACE_COOKIE, activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    persistLibraryLocation({
      organizationId: activeOrganizationId,
      workspaceId: activeWorkspaceId,
    });
  }, [activeOrganizationId, activeWorkspaceId, persistLibraryLocation]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedPreferences = parseSectionPreferences(
      window.localStorage.getItem(SECTION_PREFERENCES_STORAGE_KEY),
    );

    if (storedPreferences) {
      setSectionPreferences(storedPreferences);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedGeneralSettings = parseGeneralSettingsPreferences(
      window.localStorage.getItem(GENERAL_SETTINGS_STORAGE_KEY),
    );
    if (storedGeneralSettings) {
      setGeneralSettings(storedGeneralSettings);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const compactFromQuery = parseCompactQueryValue(
      url.searchParams.get(COMPACT_QUERY_PARAM),
    );
    const compactFromStorage = parseCompactQueryValue(
      window.localStorage.getItem(REALLY_COMPACT_STORAGE_KEY),
    );
    const nextCompactMode = compactFromQuery ?? compactFromStorage ?? false;
    setIsReallyCompactMode(nextCompactMode);
    setHasHydratedCompactMode(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedCompactMode || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      REALLY_COMPACT_STORAGE_KEY,
      isReallyCompactMode ? "true" : "false",
    );

    const url = new URL(window.location.href);
    if (isReallyCompactMode) {
      url.searchParams.set(COMPACT_QUERY_PARAM, "true");
    } else {
      url.searchParams.delete(COMPACT_QUERY_PARAM);
    }

    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const nextPath = `${url.pathname}${url.search}${url.hash}`;
    if (currentPath !== nextPath) {
      window.history.replaceState({}, "", nextPath || "/");
    }
  }, [hasHydratedCompactMode, isReallyCompactMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePopState = () => {
      const url = new URL(window.location.href);
      const compactFromQuery = parseCompactQueryValue(
        url.searchParams.get(COMPACT_QUERY_PARAM),
      );
      if (compactFromQuery !== null) {
        setIsReallyCompactMode(compactFromQuery);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      SECTION_PREFERENCES_STORAGE_KEY,
      JSON.stringify(sectionPreferences),
    );
  }, [sectionPreferences]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      GENERAL_SETTINGS_STORAGE_KEY,
      JSON.stringify(generalSettings),
    );
  }, [generalSettings]);

  useEffect(() => {
    if (!sessionUserId) {
      setAiPastePromptDecision(null);
      setAiPastePromptOpen(false);
      setPendingPasteUrl(null);
      setPendingPasteCategory(null);
      return;
    }

    void fetchAiPastePreference();
  }, [fetchAiPastePreference, sessionUserId]);

  useEffect(() => {
    if (sessionUserId) {
      return;
    }

    setAskLibraryThreads([]);
    setAskLibraryThreadId(null);
    setAiInboxItems([]);
    setAiInboxOpen(false);
  }, [sessionUserId]);

  useEffect(() => {
    if (canUseAiFeatures) {
      return;
    }

    setAiInboxUseAi(false);
  }, [canUseAiFeatures]);

  useEffect(() => {
    if (activeCategory !== "All" && !categories.includes(activeCategory)) {
      setActiveCategory("All");
    }
  }, [activeCategory, categories]);

  useEffect(() => {
    if (activeCategory === "All") {
      setAskScopeCategory(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    if (!askScopeTags) {
      setAskScopeSelectedTags([]);
    }
  }, [askScopeTags]);

  useEffect(() => {
    if (askScopeTagOptions.length === 0) {
      setAskScopeSelectedTags([]);
      return;
    }

    const allowedTags = new Set(
      askScopeTagOptions.map((tag) => tag.toLowerCase()),
    );
    setAskScopeSelectedTags((previous) =>
      previous.filter((tag) => allowedTags.has(tag.toLowerCase())),
    );
  }, [askScopeTagOptions]);

  useEffect(() => {
    if (
      previousOrganizationIdRef.current !== null &&
      previousOrganizationIdRef.current !== activeOrganizationId
    ) {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      setResources([]);
      setResourcesNextOffset(null);
      setCategoryRecords([]);
    }

    previousOrganizationIdRef.current = activeOrganizationId;
  }, [activeOrganizationId]);

  useEffect(() => {
    if (
      previousWorkspaceIdRef.current !== null &&
      previousWorkspaceIdRef.current !== activeWorkspaceId
    ) {
      setResources([]);
      setResourcesNextOffset(null);
      setCategoryRecords([]);
    }

    previousWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    setAskLibraryThreadId(null);
    setAskLibraryThreads([]);
    setAskLibraryConversation([]);
    setAskLibraryAnswer(null);
    setAskLibraryCitations([]);
    setAskLibraryReasoning(null);
    setAskLibraryFollowUpSuggestions([]);
    setAskLibraryUsedAi(false);
    setAskLibraryModel(null);
    setAiInboxItems([]);
  }, [activeWorkspaceId]);

  useEffect(() => {
    pendingScrollRestoreSelectionKeyRef.current =
      buildLibrarySelectionStorageKey(activeOrganizationId, activeWorkspaceId);
    hasSeenResourcesLoadingForScrollRestoreRef.current = false;
  }, [activeOrganizationId, activeWorkspaceId]);

  useEffect(() => {
    if (
      !pendingScrollRestoreSelectionKeyRef.current ||
      !isResourcesLoading
    ) {
      return;
    }

    hasSeenResourcesLoadingForScrollRestoreRef.current = true;
  }, [isResourcesLoading]);

  useEffect(() => {
    if (typeof window === "undefined" || isReallyCompactMode) {
      return;
    }

    const resourceViewport = resourceScrollContainerRef.current;
    if (!resourceViewport) {
      return;
    }

    const selectionKey = buildLibrarySelectionStorageKey(
      activeOrganizationId,
      activeWorkspaceId,
    );
    const handleScroll = () => {
      if (isApplyingScrollRestoreRef.current) {
        return;
      }

      scrollOffsetsBySelectionRef.current[selectionKey] = Math.max(
        0,
        Math.floor(resourceViewport.scrollTop),
      );

      if (scrollPersistRafRef.current !== null) {
        return;
      }

      scrollPersistRafRef.current = window.requestAnimationFrame(() => {
        scrollPersistRafRef.current = null;
        persistLibraryLocation({
          organizationId: activeOrganizationId,
          workspaceId: activeWorkspaceId,
        });
      });
    };

    resourceViewport.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    return () => {
      resourceViewport.removeEventListener("scroll", handleScroll);
    };
  }, [
    activeOrganizationId,
    activeWorkspaceId,
    isReallyCompactMode,
    persistLibraryLocation,
  ]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      isReallyCompactMode ||
      !hasResolvedInitialWorkspace ||
      isResourcesLoading
    ) {
      return;
    }

    const resourceViewport = resourceScrollContainerRef.current;
    if (!resourceViewport) {
      return;
    }

    const selectionKey = buildLibrarySelectionStorageKey(
      activeOrganizationId,
      activeWorkspaceId,
    );
    if (pendingScrollRestoreSelectionKeyRef.current !== selectionKey) {
      return;
    }
    if (!hasSeenResourcesLoadingForScrollRestoreRef.current) {
      return;
    }

    const targetOffset = scrollOffsetsBySelectionRef.current[selectionKey] ?? 0;
    isApplyingScrollRestoreRef.current = true;
    resourceViewport.scrollTop = targetOffset;

    if (scrollRestoreRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRestoreRafRef.current);
    }
    scrollRestoreRafRef.current = window.requestAnimationFrame(() => {
      isApplyingScrollRestoreRef.current = false;
      scrollRestoreRafRef.current = null;
    });

    pendingScrollRestoreSelectionKeyRef.current = null;
    hasSeenResourcesLoadingForScrollRestoreRef.current = false;
  }, [
    activeOrganizationId,
    activeWorkspaceId,
    hasResolvedInitialWorkspace,
    isReallyCompactMode,
    isResourcesLoading,
  ]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") {
        return;
      }

      if (scrollPersistRafRef.current !== null) {
        window.cancelAnimationFrame(scrollPersistRafRef.current);
        scrollPersistRafRef.current = null;
      }

      if (scrollRestoreRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRestoreRafRef.current);
        scrollRestoreRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedWidth = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (storedWidth) {
      const parsedWidth = Number.parseInt(storedWidth, 10);
      if (Number.isFinite(parsedWidth)) {
        setDesktopSidebarWidth(
          clampDesktopSidebarWidth(parsedWidth, window.innerWidth),
        );
      }
    } else {
      window.localStorage.setItem(
        SIDEBAR_WIDTH_STORAGE_KEY,
        String(
          clampDesktopSidebarWidth(
            DESKTOP_SIDEBAR_DEFAULT_WIDTH,
            window.innerWidth,
          ),
        ),
      );
    }

    hasLoadedSidebarWidthRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncSidebarWidth = (viewportWidth: number) => {
      setViewportWidth((currentWidth) =>
        currentWidth === viewportWidth ? currentWidth : viewportWidth,
      );
      setDesktopSidebarWidth((currentWidth) =>
        clampDesktopSidebarWidth(currentWidth, viewportWidth),
      );
    };

    syncSidebarWidth(window.innerWidth);

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const viewportWidth =
          entries[0]?.contentRect.width ?? window.innerWidth;
        syncSidebarWidth(viewportWidth);
      });

      observer.observe(document.documentElement);
      return () => {
        observer.disconnect();
      };
    }

    const handleWindowResize = () => {
      syncSidebarWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !hasLoadedSidebarWidthRef.current) {
      return;
    }

    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(desktopSidebarWidth),
    );
  }, [desktopSidebarWidth]);

  useEffect(() => {
    return () => {
      if (resizeRafIdRef.current !== null) {
        window.cancelAnimationFrame(resizeRafIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const currentUrl = new URL(window.location.href);
    const verificationStatus = currentUrl.searchParams.get("emailVerification");
    if (!verificationStatus) {
      return;
    }

    if (verificationStatus === "success") {
      toast.success("Email verified", {
        description: "You can now sign in with your credentials.",
      });
    } else {
      toast.error("Verification link invalid", {
        description: "Request a new verification email and try again.",
      });
    }

    currentUrl.searchParams.delete("emailVerification");
    const nextPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    window.history.replaceState({}, "", nextPath || "/");
  }, []);

  const resetAuthForm = useCallback(() => {
    setAuthEmail("");
    setAuthPassword("");
    setIsAuthSubmitting(false);
    setIsResendingVerification(false);
    setIsRequestingPasswordReset(false);
  }, []);

  const handleAuthDialogOpenChange = useCallback(
    (open: boolean) => {
      setAuthDialogOpen(open);
      if (!open) {
        resetAuthForm();
      }
    },
    [resetAuthForm],
  );

  const openAuthDialog = useCallback((mode: AuthMode) => {
    setAuthMode(mode);
    setAuthDialogOpen(true);
  }, []);

  const handleAuthSubmit = useCallback(async () => {
    if (isAuthSubmitting) {
      return;
    }

    setIsAuthSubmitting(true);

    try {
      const email = authEmail.trim().toLowerCase();
      const password = authPassword;

      if (!email || !password) {
        throw new Error("Username/email and password are required.");
      }

      if (authMode === "register") {
        const registerResponse = await fetch("/api/auth/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
        const registerPayload =
          await readJson<AuthRegisterResponse>(registerResponse);

        if (!registerResponse.ok) {
          throw new Error(registerPayload?.error ?? "Registration failed.");
        }

        handleAuthDialogOpenChange(false);
        setAuthMode("login");
        setAuthEmail(email);
        setAuthPassword("");

        if (registerPayload?.verificationEmailMode === "mock") {
          toast.success("Registration complete", {
            description: registerPayload.verificationPreviewUrl
              ? `Open the verification link: ${registerPayload.verificationPreviewUrl}`
              : "Verification link available in server logs.",
          });
        } else {
          toast.success("Registration complete", {
            description:
              "Check your inbox and confirm your email before sign in.",
          });
        }

        return;
      }

      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signInResult?.error) {
        if (signInResult.error === "EMAIL_NOT_VERIFIED") {
          throw new Error(
            "Email not verified yet. Check your inbox or resend verification.",
          );
        }
        if (signInResult.error === "RATE_LIMITED") {
          throw new Error(
            "Too many sign-in attempts. Please wait a bit and try again.",
          );
        }

        throw new Error("Invalid username/email or password.");
      }

      handleAuthDialogOpenChange(false);

      toast.success("Signed in", {
        description: "Authenticated actions are now unlocked.",
      });
    } catch (error) {
      toast.error(
        authMode === "register" ? "Registration failed" : "Sign-in failed",
        {
          description:
            error instanceof Error
              ? error.message
              : "Could not authenticate user.",
        },
      );
    } finally {
      setIsAuthSubmitting(false);
    }
  }, [
    authEmail,
    authMode,
    authPassword,
    handleAuthDialogOpenChange,
    isAuthSubmitting,
  ]);

  const handleResendVerification = useCallback(async () => {
    if (isResendingVerification) {
      return;
    }

    const email = authEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Email required", {
        description: "Enter your email first, then resend verification.",
      });
      return;
    }

    setIsResendingVerification(true);

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const payload = await readJson<ResendVerificationResponse>(response);

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Failed to resend verification email.",
        );
      }

      if (payload?.alreadyVerified) {
        toast.success("Email already verified", {
          description: "You can sign in now.",
        });
        return;
      }

      if (payload?.verificationEmailMode === "mock") {
        toast.success("Verification link regenerated", {
          description: payload.verificationPreviewUrl
            ? `Open this link: ${payload.verificationPreviewUrl}`
            : "Verification link available in server logs.",
        });
        return;
      }

      toast.success("Verification email sent", {
        description: "Check your inbox for a new verification link.",
      });
    } catch (error) {
      toast.error("Resend failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not resend verification email.",
      });
    } finally {
      setIsResendingVerification(false);
    }
  }, [authEmail, isResendingVerification]);

  const handleRequestPasswordReset = useCallback(async () => {
    if (isRequestingPasswordReset) {
      return;
    }

    const email = authEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Email required", {
        description: "Enter your account email first, then request reset.",
      });
      return;
    }

    setIsRequestingPasswordReset(true);

    try {
      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const payload = await readJson<RequestPasswordResetResponse>(response);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to request password reset.");
      }

      if (payload?.resetEmailMode === "mock" && payload.resetPreviewUrl) {
        toast.success("Reset link generated", {
          description: `Open this link: ${payload.resetPreviewUrl}`,
        });
        return;
      }

      toast.success("Password reset requested", {
        description:
          "If an account exists for this email, reset instructions were sent.",
      });
    } catch (error) {
      toast.error("Password reset failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not request password reset.",
      });
    } finally {
      setIsRequestingPasswordReset(false);
    }
  }, [authEmail, isRequestingPasswordReset]);

  const resetDeleteAccountDialogState = useCallback(() => {
    setDeleteAccountEmailConfirm("");
    setDeleteAccountPhraseConfirm("");
    setHasExportedAccountData(false);
    setIsExportingAccountData(false);
    setIsDeletingAccount(false);
  }, []);

  const handleExportAccountData = useCallback(async () => {
    if (!isAuthenticated || isExportingAccountData) {
      return;
    }

    setIsExportingAccountData(true);

    try {
      const response = await fetch("/api/account/export", {
        method: "GET",
      });

      if (!response.ok) {
        const payload = await readJson<ApiErrorResponse>(response);
        throw new Error(payload?.error ?? "Failed to export account data.");
      }

      const blob = await response.blob();
      const fallbackFilename = `bluesix-account-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch =
        /filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i.exec(
          disposition,
        );
      const rawFilename = filenameMatch?.[1] ?? filenameMatch?.[2] ?? null;
      const filename = rawFilename
        ? decodeURIComponent(rawFilename)
        : fallbackFilename;

      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);

      setHasExportedAccountData(true);
      toast.success("Account data exported", {
        description: "Download complete. Continue with deletion confirmation.",
      });
    } catch (error) {
      toast.error("Export failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not export account data.",
      });
    } finally {
      setIsExportingAccountData(false);
    }
  }, [isAuthenticated, isExportingAccountData]);

  const handleDeleteAccount = useCallback(async () => {
    if (!canSubmitDeleteAccount || isDeletingAccount) {
      return;
    }

    setIsDeletingAccount(true);

    try {
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: deleteAccountEmailConfirm.trim(),
          confirmation: deleteAccountPhraseConfirm.trim(),
          exportConfirmed: hasExportedAccountData,
        }),
      });
      const payload = await readJson<DeleteAccountResponse>(response);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Failed to delete account.");
      }

      toast.success("Account deleted", {
        description: "Signing you out.",
      });
      setDeleteAccountDialogOpen(false);
      resetDeleteAccountDialogState();
      await signOut({ callbackUrl: "/" });
    } catch (error) {
      toast.error("Account deletion failed", {
        description:
          error instanceof Error ? error.message : "Could not delete account.",
      });
    } finally {
      setIsDeletingAccount(false);
    }
  }, [
    canSubmitDeleteAccount,
    deleteAccountEmailConfirm,
    deleteAccountPhraseConfirm,
    hasExportedAccountData,
    isDeletingAccount,
    resetDeleteAccountDialogState,
  ]);

  const handleCreateOrganization = useCallback(async () => {
    if (!canSubmitOrganization) {
      return;
    }

    setIsOrganizationMutating(true);
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newOrganizationName.trim(),
        }),
      });
      const payload = await readJson<OrganizationResponse>(response);

      if (!response.ok || !payload?.organization) {
        throw new Error(payload?.error ?? "Failed to create organization.");
      }
      const createdOrganization = payload.organization;

      if (payload.mode) {
        setDataMode(payload.mode);
      }

      setOrganizations((previous) => {
        const next = [
          ...previous.filter((item) => item.id !== createdOrganization.id),
        ];
        next.push(createdOrganization);
        return next;
      });
      setActiveOrganizationId(createdOrganization.id);
      setNewOrganizationName("");
      setCreateOrganizationDialogOpen(false);
      void fetchOrganizations();

      toast.success("Organization created", {
        description: `${createdOrganization.name} is ready.`,
      });
    } catch (error) {
      toast.error("Organization creation failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not create organization.",
      });
    } finally {
      setIsOrganizationMutating(false);
    }
  }, [canSubmitOrganization, fetchOrganizations, newOrganizationName]);

  const handleCreateWorkspace = useCallback(async () => {
    if (!canSubmitWorkspace) {
      return;
    }

    setIsWorkspaceMutating(true);

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: activeOrganizationId,
          name: newWorkspaceName.trim(),
        }),
      });
      const payload = await readJson<WorkspaceResponse>(response);

      if (!response.ok || !payload?.workspace) {
        throw new Error(payload?.error ?? "Failed to create workspace.");
      }
      const createdWorkspace = payload.workspace;

      if (payload.mode) {
        setDataMode(payload.mode);
      }

      setWorkspaces((previous) => {
        const next = [
          ...previous.filter((item) => item.id !== createdWorkspace.id),
        ];
        next.push(createdWorkspace);
        return next;
      });
      setActiveWorkspaceId(createdWorkspace.id);
      setActiveCategory("All");
      setWorkspaceResourceCounts((previous) => ({
        ...previous,
        [createdWorkspace.id]: previous[createdWorkspace.id] ?? 0,
      }));
      setNewWorkspaceName("");
      setCreateWorkspaceDialogOpen(false);
      void fetchWorkspaces();
      void fetchWorkspaceCounts();

      toast.success("Workspace created", {
        description: `${createdWorkspace.name} is ready.`,
      });
    } catch (error) {
      toast.error("Workspace creation failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not create workspace.",
      });
    } finally {
      setIsWorkspaceMutating(false);
    }
  }, [
    activeOrganizationId,
    canSubmitWorkspace,
    fetchWorkspaceCounts,
    fetchWorkspaces,
    newWorkspaceName,
  ]);

  const handleCreateCategory = useCallback(async () => {
    if (!canSubmitCategory || !activeWorkspaceId) {
      return;
    }

    setIsCategoryMutating(true);

    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          name: newCategoryName.trim(),
          symbol: newCategorySymbol.trim() || null,
        }),
      });
      const payload = await readJson<CategoryResponse>(response);

      if (!response.ok || !payload?.category) {
        throw new Error(payload?.error ?? "Failed to create category.");
      }
      const createdCategory = payload.category;

      if (payload.mode) {
        setDataMode(payload.mode);
      }

      setCategoryRecords((previous) => {
        const next = [
          ...previous.filter((item) => item.id !== createdCategory.id),
        ];
        next.push(createdCategory);
        return next;
      });
      void fetchCategories();
      setNewCategoryName("");
      setNewCategorySymbol("");
      setCreateCategoryDialogOpen(false);
      setActiveCategory(createdCategory.name);

      toast.success("Category created", {
        description: `${createdCategory.name} is now available.`,
      });
    } catch (error) {
      toast.error("Category creation failed", {
        description:
          error instanceof Error ? error.message : "Could not create category.",
      });
    } finally {
      setIsCategoryMutating(false);
    }
  }, [
    activeWorkspaceId,
    canSubmitCategory,
    fetchCategories,
    newCategoryName,
    newCategorySymbol,
  ]);

  const handleOpenEditCategoryDialogByName = useCallback(
    (categoryName: string) => {
      if (categoryName === "All") {
        return;
      }

      if (!sessionUserId) {
        toast.error("Authentication required", {
          description: "Sign in to edit category settings.",
        });
        return;
      }

      const categoryRecord =
        categoryRecordByLowerName.get(categoryName.toLowerCase()) ?? null;
      if (!categoryRecord) {
        toast.error("Category not found", {
          description: `Could not find "${categoryName}".`,
        });
        return;
      }

      if (categoryRecord.ownerUserId !== sessionUserId) {
        toast.error("Insufficient permissions", {
          description: "You can only edit categories you own.",
        });
        return;
      }

      setEditingCategoryRecord(categoryRecord);
      setEditingCategoryName(categoryRecord.name);
      setEditingCategorySymbol(categoryRecord.symbol ?? "");
      setEditCategoryDialogOpen(true);
    },
    [categoryRecordByLowerName, sessionUserId],
  );

  const handleSaveCategoryCustomization = useCallback(async () => {
    if (!editingCategoryRecord) {
      return;
    }

    if (!canEditCategoryByName(editingCategoryRecord.name)) {
      toast.error("Insufficient permissions", {
        description: "You can only edit categories you own.",
      });
      return;
    }

    const nextName = editingCategoryName.trim();
    if (!nextName) {
      toast.error("Category name required", {
        description: "Enter a category name before saving.",
      });
      return;
    }

    const previousName = editingCategoryRecord.name;
    const previousNameLower = previousName.toLowerCase();

    setIsCategoryMutating(true);
    try {
      const response = await fetch(`/api/categories/${editingCategoryRecord.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: nextName,
          symbol: editingCategorySymbol.trim() || null,
        }),
      });
      const payload = await readJson<CategoryResponse>(response);
      if (!response.ok || !payload?.category) {
        throw new Error(
          payload?.error ?? "Failed to update category settings.",
        );
      }
      const updatedCategory = payload.category;

      if (payload.mode) {
        setDataMode(payload.mode);
      }

      setCategoryRecords((previous) =>
        previous.map((category) =>
          category.id === updatedCategory.id ? updatedCategory : category,
        ),
      );

      if (updatedCategory.name !== previousName) {
        setResources((previous) =>
          previous.map((resource) =>
            resource.workspaceId === updatedCategory.workspaceId &&
            resource.category.toLowerCase() === previousNameLower
              ? {
                  ...resource,
                  category: updatedCategory.name,
                  ownerUserId: updatedCategory.ownerUserId ?? null,
                }
              : resource,
          ),
        );
      }

      setActiveCategory((previous) =>
        previous.toLowerCase() === previousNameLower
          ? updatedCategory.name
          : previous,
      );
      setEditingCategoryRecord(updatedCategory);
      setEditingCategoryName(updatedCategory.name);
      setEditingCategorySymbol(updatedCategory.symbol ?? "");
      setEditCategoryDialogOpen(false);
      toast.success("Category updated", {
        description:
          updatedCategory.name === previousName
            ? `${updatedCategory.name} now uses ${updatedCategory.symbol || "no symbol"}.`
            : `${previousName} renamed to ${updatedCategory.name}.`,
      });
    } catch (error) {
      toast.error("Category update failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not update category settings.",
      });
    } finally {
      setIsCategoryMutating(false);
    }
  }, [
    canEditCategoryByName,
    editingCategoryName,
    editingCategoryRecord,
    editingCategorySymbol,
  ]);

  const handleSuggestCategoryNameWithAi = useCallback(async () => {
    if (!editingCategoryRecord) {
      return;
    }

    if (!canUseAiFeatures) {
      toast.error("AI features disabled", {
        description: "Enable AI features in Preferences to use this action.",
      });
      return;
    }

    setIsSuggestingCategoryName(true);
    try {
      const response = await fetch(
        `/api/categories/${editingCategoryRecord.id}/suggest-name`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      const payload = await readJson<CategoryNameSuggestionResponse>(response);
      if (!response.ok || !payload?.suggestedName) {
        throw new Error(
          payload?.error ?? "Failed to generate an AI category name suggestion.",
        );
      }

      const suggestedName = payload.suggestedName.trim();
      if (!suggestedName) {
        throw new Error("AI suggestion returned an empty name.");
      }

      setEditingCategoryName(suggestedName);
      toast.success("AI suggestion ready", {
        description:
          payload.analyzedLinks && payload.analyzedLinks > 0
            ? `Suggested name: ${suggestedName} (analyzed ${payload.analyzedLinks} links).`
            : `Suggested name: ${suggestedName}.`,
      });
    } catch (error) {
      toast.error("AI suggestion failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not suggest a category name.",
      });
    } finally {
      setIsSuggestingCategoryName(false);
    }
  }, [canUseAiFeatures, editingCategoryRecord]);

  const handleDeleteCategoryByName = useCallback(
    async (categoryName: string) => {
      if (!canManageCategories || categoryName === "All") {
        return;
      }

      const categoryRecord =
        categoryRecordByLowerName.get(categoryName.toLowerCase()) ?? null;
      if (!categoryRecord) {
        toast.error("Category not found", {
          description: `Could not find "${categoryName}".`,
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete category "${categoryRecord.name}"? Resources in this category will be reassigned.`,
      );
      if (!confirmed) {
        return;
      }

      setIsCategoryMutating(true);

      try {
        const response = await fetch(`/api/categories/${categoryRecord.id}`, {
          method: "DELETE",
        });
        const payload = await readJson<DeleteCategoryResponse>(response);

        if (
          !response.ok ||
          !payload?.deletedCategory ||
          !payload?.reassignedCategory
        ) {
          throw new Error(payload?.error ?? "Failed to delete category.");
        }

        if (payload.mode) {
          setDataMode(payload.mode);
        }

        setCategoryRecords((previous) => {
          const withoutDeleted = previous.filter(
            (category) => category.id !== payload.deletedCategory?.id,
          );
          const hasFallback = withoutDeleted.some(
            (category) => category.id === payload.reassignedCategory?.id,
          );

          if (hasFallback || !payload.reassignedCategory) {
            return withoutDeleted;
          }

          return [...withoutDeleted, payload.reassignedCategory];
        });

        const normalizedDeleted = payload.deletedCategory.name.toLowerCase();
        setResources((previous) =>
          previous.map((resource) =>
            resource.category.toLowerCase() === normalizedDeleted
              ? {
                  ...resource,
                  category:
                    payload.reassignedCategory?.name ?? resource.category,
                  ownerUserId: payload.reassignedCategory?.ownerUserId ?? null,
                }
              : resource,
          ),
        );

        setActiveCategory((previous) =>
          previous.toLowerCase() === normalizedDeleted ? "All" : previous,
        );
        void fetchCategories();
        toast.success("Category deleted", {
          description: `${payload.reassignedResources ?? 0} resource(s) reassigned to ${payload.reassignedCategory.name}.`,
        });
      } catch (error) {
        toast.error("Category deletion failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not delete category.",
        });
      } finally {
        setIsCategoryMutating(false);
      }
    },
    [canManageCategories, categoryRecordByLowerName, fetchCategories],
  );

  const handleUpdateActiveCategorySymbol = useCallback(() => {
    if (activeCategory === "All") {
      return;
    }

    handleOpenEditCategoryDialogByName(activeCategory);
  }, [activeCategory, handleOpenEditCategoryDialogByName]);

  const handleDeleteActiveCategory = useCallback(async () => {
    if (activeCategory === "All") {
      return;
    }

    await handleDeleteCategoryByName(activeCategory);
  }, [activeCategory, handleDeleteCategoryByName]);

  const handleSignOut = useCallback(async () => {
    await signOut({ redirect: false });
    toast.success("Signed out", {
      description: "Resource management actions are now locked.",
    });
  }, []);

  const handleGitHubSignIn = useCallback(() => {
    void signIn("github", { callbackUrl: "/" });
  }, []);

  const handleSave = useCallback(
    async (input: ResourceInput) => {
      const isEditing = editingResource !== null;
      if (!isEditing && !canManageResources) {
        toast.error("Insufficient permissions", {
          description: "You do not have access to create resource cards.",
        });
        return;
      }

      if (isEditing && !canManageResourceCard(editingResource)) {
        toast.error("Insufficient permissions", {
          description: "You can only edit cards that you own.",
        });
        return;
      }

      const targetWorkspaceId =
        input.workspaceId ?? editingResource?.workspaceId ?? activeWorkspaceId;
      if (!targetWorkspaceId) {
        toast.error("Workspace unavailable", {
          description: "Select a workspace before saving this resource.",
        });
        return;
      }

      setIsSaving(true);

      try {
        const payloadInput: ResourceInput = {
          ...input,
          workspaceId: targetWorkspaceId,
        };
        const duplicateInsight = detectLinkDuplicates({
          links: payloadInput.links.map((link) => ({
            url: link.url,
            label: link.label,
          })),
          resources,
          workspaceId: targetWorkspaceId,
          excludeResourceId: editingResource?.id ?? null,
        });

        if (
          typeof window !== "undefined" &&
          (duplicateInsight.exactMatches.length > 0 ||
            duplicateInsight.nearMatches.length > 0)
        ) {
          const duplicateMessage = [
            duplicateInsight.exactMatches.length > 0
              ? `Exact: ${summarizeDuplicateMatches(duplicateInsight.exactMatches)}`
              : "",
            duplicateInsight.nearMatches.length > 0
              ? `Similar: ${summarizeDuplicateMatches(duplicateInsight.nearMatches)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");

          const shouldContinue = window.confirm(
            `Potential duplicate links were detected.\n${duplicateMessage}\n\nPress OK to save anyway, or Cancel to review.`,
          );
          if (!shouldContinue) {
            return;
          }
        }

        const response = await fetch(
          isEditing ? `/api/resources/${editingResource.id}` : "/api/resources",
          {
            method: isEditing ? "PUT" : "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payloadInput),
          },
        );

        const payload = await readJson<ResourceResponse>(response);

        if (!response.ok || !payload?.resource) {
          throw new Error(payload?.error ?? "Failed to save resource.");
        }

        const savedResource = payload.resource;
        if (payload.mode) {
          setDataMode(payload.mode);
        }

        setResources((prev) => {
          if (!isEditing) {
            return [savedResource, ...prev];
          }

          return prev.map((resource) =>
            resource.id === savedResource.id ? savedResource : resource,
          );
        });
        if (!isEditing && savedResource.workspaceId) {
          setWorkspaceResourceCounts((previous) => ({
            ...previous,
            [savedResource.workspaceId]:
              (previous[savedResource.workspaceId] ?? 0) + 1,
          }));
        }

        setEditingResource(null);
        setModalOpen(false);
        void fetchCategories();

        toast.success(isEditing ? "Resource updated" : "Resource added", {
          description: `${savedResource.category} card saved to your library.`,
        });
      } catch (error) {
        toast.error("Save failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not save this resource.",
        });
      } finally {
        setIsSaving(false);
      }
    },
    [
      activeWorkspaceId,
      canManageResourceCard,
      canManageResources,
      editingResource,
      fetchCategories,
    ],
  );

  const handleDesktopSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !isDesktopSidebarEnabled()) {
        return;
      }

      event.preventDefault();
      const pointerId = event.pointerId;
      const handleElement = event.currentTarget;
      const startX = event.clientX;
      const startWidth = desktopSidebarWidth;
      setIsSidebarResizing(true);
      handleElement.setPointerCapture(pointerId);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = clampDesktopSidebarWidth(
          startWidth + moveEvent.clientX - startX,
          window.innerWidth,
        );
        queueSidebarWidthUpdate(nextWidth);
      };

      const stopResizing = () => {
        setIsSidebarResizing(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        if (handleElement.hasPointerCapture(pointerId)) {
          handleElement.releasePointerCapture(pointerId);
        }
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResizing);
        window.removeEventListener("pointercancel", stopResizing);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResizing);
      window.addEventListener("pointercancel", stopResizing);
    },
    [desktopSidebarWidth, isDesktopSidebarEnabled, queueSidebarWidthUpdate],
  );

  const handleDesktopSidebarResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!event.altKey || !isDesktopSidebarEnabled()) {
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      const delta =
        event.key === "ArrowRight"
          ? SIDEBAR_KEYBOARD_STEP
          : -SIDEBAR_KEYBOARD_STEP;
      setDesktopSidebarWidth((currentWidth) =>
        clampDesktopSidebarWidth(currentWidth + delta, window.innerWidth),
      );
    },
    [isDesktopSidebarEnabled],
  );

  const handleRestoreArchivedResource = useCallback(
    async (resourceId: string) => {
      const response = await fetch(
        `/api/admin/resources/${resourceId}/restore`,
        {
          method: "POST",
        },
      );
      const payload = await readJson<ResourceResponse>(response);

      if (!response.ok || !payload?.resource) {
        throw new Error(
          payload?.error ?? "Failed to restore archived resource.",
        );
      }

      if (payload.mode) {
        setDataMode(payload.mode);
      }

      const restoredResource = payload.resource;
      setResources((prev) => {
        const withoutRestored = prev.filter(
          (resource) => resource.id !== restoredResource.id,
        );
        return [restoredResource, ...withoutRestored];
      });
      setWorkspaceResourceCounts((previous) => ({
        ...previous,
        [restoredResource.workspaceId]:
          (previous[restoredResource.workspaceId] ?? 0) + 1,
      }));

      return restoredResource;
    },
    [],
  );

  const handleDelete = useCallback(
    async (resourceId: string) => {
      const archivedResource = resources.find(
        (resource) => resource.id === resourceId,
      );
      if (!archivedResource) {
        toast.error("Resource not found", {
          description: "The selected card no longer exists.",
        });
        return;
      }
      if (!canManageResourceCard(archivedResource)) {
        toast.error("Insufficient permissions", {
          description: "You can only archive cards that you own.",
        });
        return;
      }
      setDeletingResourceId(resourceId);

      try {
        const response = await fetch(`/api/resources/${resourceId}`, {
          method: "DELETE",
        });
        const payload = await readJson<ApiErrorResponse>(response);

        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to archive resource.");
        }

        if (payload?.mode) {
          setDataMode(payload.mode);
        }

        setResources((prev) =>
          prev.filter((resource) => resource.id !== resourceId),
        );
        setWorkspaceResourceCounts((previous) => ({
          ...previous,
          [archivedResource.workspaceId]: Math.max(
            0,
            (previous[archivedResource.workspaceId] ?? 1) - 1,
          ),
        }));
        toast("Resource archived", {
          description:
            "Hidden from library. Restore it now or from Admin Panel.",
          action: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                try {
                  const restored =
                    await handleRestoreArchivedResource(resourceId);
                  toast.success("Archive undone", {
                    description: `${restored.category} is visible again.`,
                  });
                } catch (error) {
                  toast.error("Undo failed", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "Could not restore this resource.",
                  });
                }
              })();
            },
          },
        });
      } catch (error) {
        toast.error("Archive failed", {
          description:
            error instanceof Error
              ? error.message
              : archivedResource
                ? `Could not archive ${archivedResource.category}.`
                : "Could not archive this resource.",
        });
      } finally {
        setDeletingResourceId(null);
      }
    },
    [canManageResourceCard, handleRestoreArchivedResource, resources],
  );

  const handleEdit = useCallback(
    (resource: ResourceCard) => {
      if (!canManageResourceCard(resource)) {
        toast.error("Insufficient permissions", {
          description: "You can only edit cards that you own.",
        });
        return;
      }

      setInitialLinkDraft(null);
      setInitialCategoryDraft(null);
      setInitialTagsDraft([]);
      setEditingResource(resource);
      setModalOpen(true);
    },
    [canManageResourceCard],
  );

  const handleMoveResourceItem = useCallback(
    async (moveInput: ResourceBoardMoveInput) => {
      let rollbackResources: ResourceCard[] | null = null;
      let requestPayload:
        | {
            itemId: string;
            sourceCategoryId: string;
            targetCategoryId: string;
            newOrder: number;
          }
        | null = null;

      setResources((previous) => {
        const moving = previous.find(
          (resource) => resource.id === moveInput.itemId,
        );
        if (!moving || !canManageResourceCard(moving)) {
          return previous;
        }

        const optimistic = applyOptimisticMove({
          resources: previous,
          itemId: moveInput.itemId,
          sourceCategoryId: moveInput.sourceCategoryId,
          targetCategoryId: moveInput.targetCategoryId,
          targetCategoryName: moveInput.targetCategoryName,
          sourceIndex: moveInput.sourceIndex,
          targetIndex: moveInput.targetIndex,
          resolveCategoryId: resolveResourceCategoryId,
        });

        if (!optimistic) {
          return previous;
        }

        rollbackResources = previous;
        requestPayload = {
          itemId: moveInput.itemId,
          sourceCategoryId: moveInput.sourceCategoryId,
          targetCategoryId: moveInput.targetCategoryId,
          newOrder: optimistic.newOrder,
        };

        return optimistic.resources;
      });

      if (!requestPayload) {
        return;
      }

      try {
        const response = await fetch("/api/items/move", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestPayload),
        });
        const payload = await readJson<MoveItemResponse>(response);
        if (!response.ok || !payload?.item) {
          throw new Error(payload?.error ?? "Failed to move resource.");
        }

        if (payload.mode) {
          setDataMode(payload.mode);
        }

        const movedItem = payload.item;
        const affectedMap = new Map(
          (payload.affectedItems ?? []).map((item) => [item.id, item]),
        );
        if (movedItem.categoryId) {
          affectedMap.set(movedItem.id, {
            id: movedItem.id,
            categoryId: movedItem.categoryId,
            category: movedItem.category,
            order: typeof movedItem.order === "number" ? movedItem.order : 0,
          });
        }

        setResources((previous) =>
          previous.map((resource) => {
            if (resource.id === movedItem.id) {
              return movedItem;
            }

            const patch = affectedMap.get(resource.id);
            if (!patch) {
              return resource;
            }

            return {
              ...resource,
              categoryId: patch.categoryId,
              category: patch.category,
              order: patch.order,
            };
          }),
        );
      } catch (error) {
        if (rollbackResources) {
          setResources(rollbackResources);
        }
        toast.error("Move failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not move this resource card.",
        });
      }
    },
    [canManageResourceCard, resolveResourceCategoryId],
  );
  const handleDropLinkItemToSidebarCategory = useCallback(
    (input: {
      itemId: string;
      linkId: string;
      sourceCategoryId: string;
      sourceCategoryName: string;
      sourceIndex: number;
      targetCategory: string;
    }) => {
      const targetCategoryRecord =
        categoryRecordByLowerName.get(input.targetCategory.toLowerCase()) ??
        null;
      if (!targetCategoryRecord) {
        toast.error("Move failed", {
          description: `Could not resolve category "${input.targetCategory}".`,
        });
        return;
      }

      void handleMoveResourceItem({
        itemId: input.itemId,
        sourceCategoryId: input.sourceCategoryId,
        sourceCategoryName: input.sourceCategoryName,
        sourceIndex: input.sourceIndex,
        targetCategoryId: targetCategoryRecord.id,
        targetCategoryName: targetCategoryRecord.name,
        targetIndex: Number.MAX_SAFE_INTEGER,
      });
    },
    [categoryRecordByLowerName, handleMoveResourceItem],
  );

  const handleOpenCreateResourceModal = useCallback(() => {
    if (!canManageResources) {
      toast.error("Insufficient permissions", {
        description: "You do not have access to create resource cards.",
      });
      return;
    }

    if (!activeWorkspaceId) {
      toast.error("Workspace unavailable", {
        description: "Select a workspace before creating a resource card.",
      });
      return;
    }

    setInitialLinkDraft(null);
    setInitialCategoryDraft(null);
    setInitialTagsDraft([]);
    setEditingResource(null);
    setModalOpen(true);
  }, [activeWorkspaceId, canManageResources]);

  const handleOpenCreateCategoryDialog = useCallback(() => {
    if (!canManageCategories) {
      toast.error("Insufficient permissions", {
        description: "You do not have access to create categories.",
      });
      return;
    }

    if (!activeWorkspaceId) {
      toast.error("Workspace unavailable", {
        description: "Select a workspace before creating a category.",
      });
      return;
    }

    setCreateCategoryDialogOpen(true);
  }, [activeWorkspaceId, canManageCategories]);

  const handleOpenCreateWorkspaceDialog = useCallback(() => {
    if (!isAuthenticated) {
      toast.error("Authentication required", {
        description: "Sign in to create personal workspaces.",
      });
      return;
    }

    if (!canCreateWorkspaces) {
      toast.error("Workspace limit reached", {
        description: "Each account can create only one personal workspace.",
      });
      return;
    }

    setCreateWorkspaceDialogOpen(true);
  }, [canCreateWorkspaces, isAuthenticated]);

  const handleOpenCreateOrganizationDialog = useCallback(() => {
    if (!canCreateOrganizations) {
      toast.error("Insufficient permissions", {
        description: "Only administrators can create organizations.",
      });
      return;
    }

    setCreateOrganizationDialogOpen(true);
  }, [canCreateOrganizations]);

  const handleOpenWorkspaceSettings = useCallback(() => {
    if (!activeWorkspace?.ownerUserId) {
      return;
    }

    setWorkspaceRenameInput(activeWorkspace.name);
    setConfirmDeleteWorkspace(false);
    setWorkspaceSettingsOpen(true);
  }, [activeWorkspace]);

  const handleRenameWorkspace = useCallback(async () => {
    if (!activeWorkspace || !session?.user?.id) {
      return;
    }

    const trimmed = workspaceRenameInput.trim();
    if (!trimmed || trimmed === activeWorkspace.name) {
      return;
    }

    setIsWorkspaceRenaming(true);
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      const data = await readJson<{ workspace: { id: string; name: string } }>(response);
      if (!response.ok) {
        toast.error("Failed to rename collection");
        return;
      }

      setWorkspaces((previous) =>
        previous.map((w) =>
          w.id === activeWorkspace.id ? { ...w, name: data?.workspace?.name ?? trimmed } : w,
        ),
      );
      toast.success("Collection renamed");
    } catch {
      toast.error("Failed to rename collection");
    } finally {
      setIsWorkspaceRenaming(false);
    }
  }, [activeWorkspace, session?.user?.id, workspaceRenameInput]);

  const handleDeleteWorkspace = useCallback(async () => {
    if (!activeWorkspace || !session?.user?.id) {
      return;
    }

    setIsWorkspaceDeleting(true);
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        toast.error("Failed to delete collection");
        return;
      }

      setWorkspaces((previous) => previous.filter((w) => w.id !== activeWorkspace.id));
      setResources((previous) => previous.filter((r) => r.workspaceId !== activeWorkspace.id));
      setResourcesNextOffset(null);
      setWorkspaceResourceCounts((previous) => {
        const next = { ...previous };
        delete next[activeWorkspace.id];
        return next;
      });
      setActiveWorkspaceId(null);
      setWorkspaceSettingsOpen(false);
      void fetchWorkspaceCounts();
      toast.success("Collection deleted");
    } catch {
      toast.error("Failed to delete collection");
    } finally {
      setIsWorkspaceDeleting(false);
    }
  }, [activeWorkspace, fetchWorkspaceCounts, session?.user?.id]);

  const handleRefreshLibrary = useCallback(() => {
    if (isRefreshingLibrary) {
      return;
    }

    setIsRefreshingLibrary(true);
    void (async () => {
      try {
        await loadLibrarySnapshot({
          organizationId: activeOrganizationId,
          workspaceId: activeWorkspaceId,
        });
      } finally {
        setIsRefreshingLibrary(false);
      }
    })();
  }, [
    activeOrganizationId,
    activeWorkspaceId,
    isRefreshingLibrary,
    loadLibrarySnapshot,
  ]);

  const handleLoadMoreResources = useCallback(async () => {
    if (
      !activeWorkspaceId ||
      resourcesNextOffset === null ||
      isLoadingMoreResources
    ) {
      return;
    }

    setIsLoadingMoreResources(true);
    try {
      const params = new URLSearchParams({
        workspaceId: activeWorkspaceId,
        limit: String(RESOURCE_PAGE_SIZE),
        offset: String(resourcesNextOffset),
      });
      const response = await fetch(`/api/resources?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await readJson<ListResourcesResponse>(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load more resources.");
      }

      setResources((previous) => {
        const nextById = new Map(previous.map((resource) => [resource.id, resource]));
        for (const resource of payload?.resources ?? []) {
          nextById.set(resource.id, resource);
        }
        return [...nextById.values()];
      });
      setResourcesNextOffset(
        typeof payload?.nextOffset === "number" ? payload.nextOffset : null,
      );
    } catch (error) {
      toast.error("Load more failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not load additional resources.",
      });
    } finally {
      setIsLoadingMoreResources(false);
    }
  }, [
    activeWorkspaceId,
    isLoadingMoreResources,
    resourcesNextOffset,
  ]);

  const handleModalOpenChange = useCallback((open: boolean) => {
    setModalOpen(open);
    if (!open) {
      setInitialLinkDraft(null);
      setInitialCategoryDraft(null);
      setInitialTagsDraft([]);
      setEditingResource(null);
    }
  }, []);

  const handleOpenAiInbox = useCallback(() => {
    if (!canManageResources) {
      toast.error("Insufficient permissions", {
        description: "You do not have access to create resource cards.",
      });
      return;
    }

    if (!activeWorkspaceId) {
      toast.error("Workspace unavailable", {
        description: "Select a workspace before opening AI Inbox.",
      });
      return;
    }

    setAiInboxUseAi(canUseAiFeatures);
    setAiInboxSummary(null);
    setAiInboxOpen(true);
  }, [activeWorkspaceId, canManageResources, canUseAiFeatures]);

  const handleOpenTobyImport = useCallback(() => {
    if (!canManageResources) {
      toast.error("Insufficient permissions", {
        description: "You do not have access to import resource cards.",
      });
      return;
    }

    if (!resolvedActiveWorkspaceId && !canCreateWorkspaces) {
      toast.error("Workspace unavailable", {
        description:
          "Select a current workspace before importing Toby JSON. If you just switched spaces, refresh once and try again.",
      });
      return;
    }

    setTobyImportCreateWorkspace(!resolvedActiveWorkspaceId && canCreateWorkspaces);
    setTobyImportWorkspaceName(suggestTobyWorkspaceName(tobyImportFileName));
    setTobyImportSkipExactDuplicates(true);
    setTobyImportPreview(null);
    setTobyImportOpen(true);
  }, [
    canCreateWorkspaces,
    canManageResources,
    resolvedActiveWorkspaceId,
    tobyImportFileName,
  ]);

  const handleSelectTobyJsonFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0] ?? null;
      input.value = "";

      if (!file) {
        return;
      }

      try {
        const content = await file.text();
        setTobyImportRawInput(content);
        setTobyImportFileName(file.name);
        setTobyImportWorkspaceName(suggestTobyWorkspaceName(file.name));
        setTobyImportPreview(null);
      } catch {
        toast.error("Could not read Toby file", {
          description: "The selected file could not be loaded.",
        });
      }
    },
    [],
  );

  const buildTobyImportPayload = useCallback(
    (previewOnly: boolean) => ({
      organizationId: resolvedActiveOrganizationId,
      workspaceId: tobyImportCreateWorkspace
        ? undefined
        : resolvedActiveWorkspaceId,
      createWorkspace: tobyImportCreateWorkspace,
      workspaceName: tobyImportCreateWorkspace
        ? tobyImportWorkspaceName.trim()
        : undefined,
      previewOnly,
      skipExactDuplicates: tobyImportSkipExactDuplicates,
      content: tobyImportRawInput,
    }),
    [
      resolvedActiveOrganizationId,
      resolvedActiveWorkspaceId,
      tobyImportCreateWorkspace,
      tobyImportRawInput,
      tobyImportSkipExactDuplicates,
      tobyImportWorkspaceName,
    ],
  );

  const handlePreviewTobyImport = useCallback(async () => {
    if (!canManageResources) {
      return;
    }

    if (!resolvedActiveWorkspaceId && !tobyImportCreateWorkspace) {
      toast.error("Workspace unavailable", {
        description:
          "The selected workspace is no longer available. Refresh the library and choose a current workspace.",
      });
      return;
    }

    if (tobyImportRawInput.trim().length === 0) {
      toast.error("No Toby JSON provided", {
        description: "Upload a Toby JSON export or paste its content first.",
      });
      return;
    }

    if (tobyImportCreateWorkspace && tobyImportWorkspaceName.trim().length === 0) {
      toast.error("Workspace name required", {
        description: "Enter a name for the new workspace before previewing the import.",
      });
      return;
    }

    setIsTobyImportPreviewing(true);
    try {
      const response = await fetch("/api/import/toby", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildTobyImportPayload(true)),
      });
      const payload = await readJson<TobyImportResponse>(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to preview Toby JSON import.");
      }

      setTobyImportPreview({
        importedLists: payload?.importedLists ?? 0,
        importedCards: payload?.importedCards ?? 0,
        exactDuplicateCount: payload?.exactDuplicateCount ?? 0,
        duplicateSamples: payload?.duplicateSamples ?? [],
      });
    } catch (error) {
      toast.error("Preview failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not analyze the Toby import.",
      });
    } finally {
      setIsTobyImportPreviewing(false);
    }
  }, [
    buildTobyImportPayload,
    canManageResources,
    resolvedActiveWorkspaceId,
    tobyImportCreateWorkspace,
    tobyImportRawInput,
    tobyImportWorkspaceName,
  ]);

  const handleImportTobyJson = useCallback(async () => {
    if (!canManageResources) {
      return;
    }

    if (!resolvedActiveWorkspaceId && !tobyImportCreateWorkspace) {
      toast.error("Workspace unavailable", {
        description:
          "The selected workspace is no longer available. Refresh the library and choose a current workspace.",
      });
      return;
    }

    if (tobyImportRawInput.trim().length === 0) {
      toast.error("No Toby JSON provided", {
        description: "Upload a Toby JSON export or paste its content first.",
      });
      return;
    }

    if (tobyImportCreateWorkspace && tobyImportWorkspaceName.trim().length === 0) {
      toast.error("Workspace name required", {
        description: "Enter a name for the new workspace before importing.",
      });
      return;
    }

    setIsTobyImporting(true);
    try {
      const response = await fetch("/api/import/toby", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildTobyImportPayload(false)),
      });
      const payload = await readJson<TobyImportResponse>(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to import Toby JSON.");
      }

      const snapshotOrganizationId =
        payload?.workspace?.organizationId ??
        payload?.organizationId ??
        resolvedActiveOrganizationId;
      const snapshotWorkspaceId =
        payload?.workspace?.id ??
        payload?.workspaceId ??
        resolvedActiveWorkspaceId;

      await loadLibrarySnapshot({
        organizationId: snapshotOrganizationId,
        workspaceId: snapshotWorkspaceId,
      });
      setTobyImportOpen(false);
      setTobyImportRawInput("");
      setTobyImportFileName(null);
      setTobyImportCreateWorkspace(false);
      setTobyImportWorkspaceName(DEFAULT_TOBY_WORKSPACE_NAME);
      setTobyImportSkipExactDuplicates(true);
      setTobyImportPreview(null);

      const importedResources = payload?.importedResources ?? 0;
      const importedCards = payload?.importedCards ?? importedResources;
      const importedLists = payload?.importedLists ?? 0;
      const failed = payload?.failed ?? 0;
      const skippedExactDuplicates = payload?.skippedExactDuplicates ?? 0;
      const importedWorkspaceName = payload?.workspace?.name;

      toast.success("Toby import complete", {
        description: `${importedResources} of ${importedCards} card(s) imported across ${importedLists} list(s)${importedWorkspaceName ? ` into ${importedWorkspaceName}` : ""}${skippedExactDuplicates > 0 ? `, ${skippedExactDuplicates} exact duplicate(s) skipped` : ""}${failed > 0 ? `, ${failed} failed.` : "."}`,
      });
    } catch (error) {
      toast.error("Toby import failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not import the provided Toby JSON.",
      });
    } finally {
      setIsTobyImporting(false);
    }
  }, [
    canCreateWorkspaces,
    canManageResources,
    buildTobyImportPayload,
    loadLibrarySnapshot,
    resolvedActiveOrganizationId,
    resolvedActiveWorkspaceId,
    tobyImportCreateWorkspace,
    tobyImportWorkspaceName,
  ]);

  const handleAnalyzeAiInbox = useCallback(async () => {
    if (!canManageResources) {
      return;
    }

    if (!activeWorkspaceId) {
      toast.error("Workspace unavailable", {
        description: "Select a workspace before analyzing links.",
      });
      return;
    }

    const extractedUrls = extractHttpUrlsFromText(aiInboxRawInput);
    if (extractedUrls.length === 0) {
      toast.error("No valid URLs found", {
        description: "Paste one or more http(s) links to analyze.",
      });
      return;
    }

    if (extractedUrls.length > AI_INBOX_MAX_URLS) {
      toast.error("Too many URLs", {
        description: `AI Inbox supports up to ${AI_INBOX_MAX_URLS} links at once.`,
      });
      return;
    }

    const categoryHints = categoryRecords
      .filter((category) => category.workspaceId === activeWorkspaceId)
      .map((category) => category.name)
      .filter((category) => category.trim().length > 0);

    setIsAiInboxAnalyzing(true);
    try {
      const response = await fetch("/api/links/suggest-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          urls: extractedUrls,
          categories: categoryHints,
          workspaceId: activeWorkspaceId,
          useAi: aiInboxUseAi && canUseAiFeatures,
        }),
      });
      const payload = await readJson<AiInboxBatchResponse>(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to analyze links.");
      }

      const nextItems: AiInboxItem[] = (payload?.items ?? []).map((item, index) => ({
        id: `${Date.now().toString(36)}-${index}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        selected: (item.exactMatches?.length ?? 0) === 0,
        url: item.url,
        label: item.label,
        note: item.note,
        category: item.category,
        tags: item.tags ?? [],
        model: item.model ?? null,
        usedAi: item.usedAi === true,
        error: item.error ?? null,
        exactMatches: item.exactMatches ?? [],
        nearMatches: item.nearMatches ?? [],
      }));

      setAiInboxItems(nextItems);
      setAiInboxSummary(null);
      const exactCount = nextItems.filter((item) => item.exactMatches.length > 0).length;
      toast.success("AI Inbox analyzed links", {
        description:
          exactCount > 0
            ? `${nextItems.length} processed, ${exactCount} pre-unchecked due to exact duplicates.`
            : `${nextItems.length} links ready for import.`,
      });
    } catch (error) {
      toast.error("AI Inbox analysis failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not analyze pasted links.",
      });
    } finally {
      setIsAiInboxAnalyzing(false);
    }
  }, [
    activeWorkspaceId,
    aiInboxRawInput,
    aiInboxUseAi,
    canManageResources,
    canUseAiFeatures,
    categoryRecords,
  ]);

  const updateAiInboxItem = useCallback(
    (itemId: string, updater: (previous: AiInboxItem) => AiInboxItem) => {
      setAiInboxItems((previous) =>
        previous.map((item) => (item.id === itemId ? updater(item) : item)),
      );
    },
    [],
  );

  const handleAiInboxAutoGroup = useCallback(() => {
    if (aiInboxItems.length === 0) {
      toast.error("No links to group", {
        description: "Analyze at least one URL first.",
      });
      return;
    }

    setAiInboxItems((previous) => {
      const canonicalCategoryByKey = new Map<string, string>();
      const normalized = previous.map((item) => {
        const nextCategory = normalizeAiInboxCategory(item.category, activeCategory);
        const key = normalizeAiInboxCategoryKey(nextCategory);
        if (!canonicalCategoryByKey.has(key)) {
          canonicalCategoryByKey.set(key, nextCategory);
        }
        return {
          ...item,
          category: canonicalCategoryByKey.get(key) ?? nextCategory,
        };
      });

      return [...normalized].sort((left, right) => {
        const categoryDiff = (left.category ?? "").localeCompare(
          right.category ?? "",
          undefined,
          { sensitivity: "base" },
        );
        if (categoryDiff !== 0) {
          return categoryDiff;
        }

        return left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
        });
      });
    });

    setAiInboxSummary(null);
    const groupedCount = new Set(
      aiInboxItems.map((item) =>
        normalizeAiInboxCategoryKey(
          normalizeAiInboxCategory(item.category, activeCategory),
        ),
      ),
    ).size;
    toast.success("Grouped by category", {
      description: `${groupedCount} grouped bucket(s) ready.`,
    });
  }, [activeCategory, aiInboxItems]);

  const handleAiInboxSuggestShortNames = useCallback(async () => {
    if (aiInboxItems.length === 0) {
      toast.error("No links available", {
        description: "Analyze at least one URL first.",
      });
      return;
    }

    const grouped = new Map<
      string,
      {
        currentName: string;
        links: Array<{
          url: string;
          label: string;
          note: string | null;
        }>;
      }
    >();

    for (const item of aiInboxItems) {
      const currentName = normalizeAiInboxCategory(item.category, activeCategory);
      const key = normalizeAiInboxCategoryKey(currentName);
      const bucket = grouped.get(key) ?? {
        currentName,
        links: [],
      };

      bucket.links.push({
        url: item.url,
        label: item.label,
        note: item.note || null,
      });
      grouped.set(key, bucket);
    }

    if (grouped.size === 0) {
      return;
    }

    const shouldUseAi = aiInboxUseAi && canUseAiFeatures;
    setIsAiInboxRenamingCategories(true);
    try {
      const renamePairs = await Promise.all(
        [...grouped.entries()].map(async ([key, value]) => {
          const fallbackName = toShortAiInboxCategoryName(value.currentName);
          if (!shouldUseAi) {
            return {
              key,
              nextName: fallbackName,
              usedAi: false,
              warning: null as string | null,
            };
          }

          try {
            const response = await fetch("/api/links/suggest-category-name", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                currentName: value.currentName,
                links: value.links,
                useAi: true,
              }),
            });
            const payload =
              await readJson<AiInboxCategoryNameSuggestionResponse>(response);
            if (!response.ok) {
              return {
                key,
                nextName: fallbackName,
                usedAi: false,
                warning:
                  payload?.error ?? "Could not generate a category name suggestion.",
              };
            }

            const nextName = toShortAiInboxCategoryName(
              payload?.suggestedName ?? fallbackName,
            );
            return {
              key,
              nextName,
              usedAi: payload?.usedAi === true,
              warning: payload?.warning ?? null,
            };
          } catch (error) {
            return {
              key,
              nextName: fallbackName,
              usedAi: false,
              warning:
                error instanceof Error
                  ? error.message
                  : "Category naming request failed.",
            };
          }
        }),
      );

      const renameMap = new Map<string, string>();
      let aiAppliedCount = 0;
      let warningCount = 0;
      for (const result of renamePairs) {
        renameMap.set(result.key, result.nextName);
        if (result.usedAi) {
          aiAppliedCount += 1;
        }
        if (result.warning) {
          warningCount += 1;
        }
      }

      setAiInboxItems((previous) =>
        previous.map((item) => {
          const key = normalizeAiInboxCategoryKey(
            normalizeAiInboxCategory(item.category, activeCategory),
          );
          const renamed = renameMap.get(key);
          if (!renamed) {
            return item;
          }

          return {
            ...item,
            category: renamed,
          };
        }),
      );
      setAiInboxSummary(null);

      toast.success("Category names updated", {
        description: `${renameMap.size} category name(s) adjusted${aiAppliedCount > 0 ? `, ${aiAppliedCount} AI-assisted` : ""}${warningCount > 0 ? `, ${warningCount} fallback` : ""}.`,
      });
    } finally {
      setIsAiInboxRenamingCategories(false);
    }
  }, [
    activeCategory,
    aiInboxItems,
    aiInboxUseAi,
    canUseAiFeatures,
  ]);

  const handleAiInboxSortByPriority = useCallback(() => {
    if (aiInboxItems.length === 0) {
      toast.error("No links to sort", {
        description: "Analyze at least one URL first.",
      });
      return;
    }

    setAiInboxItems((previous) =>
      [...previous].sort((left, right) => {
        const scoreDiff =
          scoreAiInboxItemPriority(right) - scoreAiInboxItemPriority(left);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        const categoryDiff = (left.category ?? "").localeCompare(
          right.category ?? "",
          undefined,
          { sensitivity: "base" },
        );
        if (categoryDiff !== 0) {
          return categoryDiff;
        }

        return left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
        });
      }),
    );
    setAiInboxSummary(null);
    toast.success("Sorted by priority", {
      description: "Most import-ready links are now listed first.",
    });
  }, [aiInboxItems]);

  const handleAiInboxDeduplicate = useCallback(() => {
    if (aiInboxItems.length === 0) {
      toast.error("No links to deduplicate", {
        description: "Analyze at least one URL first.",
      });
      return;
    }

    let removedInBatch = 0;
    let uncheckedExact = 0;
    setAiInboxItems((previous) => {
      const seenUrls = new Set<string>();
      const next: AiInboxItem[] = [];

      for (const item of previous) {
        const normalizedUrl =
          normalizeHttpUrl(item.url)?.toLowerCase() ??
          item.url.trim().toLowerCase();
        if (seenUrls.has(normalizedUrl)) {
          removedInBatch += 1;
          continue;
        }

        seenUrls.add(normalizedUrl);
        if (item.exactMatches.length > 0 && item.selected) {
          uncheckedExact += 1;
          next.push({
            ...item,
            selected: false,
          });
          continue;
        }

        next.push(item);
      }

      return next;
    });

    setAiInboxSummary(null);
    toast.success("Deduplication applied", {
      description: `${removedInBatch} in-batch duplicate(s) removed, ${uncheckedExact} exact-match item(s) unchecked.`,
    });
  }, [aiInboxItems]);

  const handleAiInboxSummarize = useCallback(async () => {
    if (aiInboxItems.length === 0) {
      toast.error("No links to summarize", {
        description: "Analyze at least one URL first.",
      });
      return;
    }

    setIsAiInboxSummarizing(true);
    try {
      const response = await fetch("/api/links/summarize-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          useAi: aiInboxUseAi && canUseAiFeatures,
          items: aiInboxItems.map((item) => ({
            url: item.url,
            label: item.label,
            note: item.note,
            category: item.category,
            tags: item.tags,
            exactMatchCount: item.exactMatches.length,
            nearMatchCount: item.nearMatches.length,
          })),
        }),
      });
      const payload = await readJson<AiInboxSummaryResponse>(response);
      if (!response.ok || !payload?.summary) {
        throw new Error(payload?.error ?? "Could not summarize AI inbox links.");
      }

      setAiInboxSummary({
        summary: payload.summary,
        actionItems: payload.actionItems ?? [],
        focusCategories: payload.focusCategories ?? [],
        usedAi: payload.usedAi === true,
        model: payload.model ?? null,
        generatedAt: new Date().toISOString(),
        analyzed: payload.analyzed ?? aiInboxItems.length,
      });

      toast.success("Summary ready", {
        description:
          payload.usedAi === true
            ? `Generated with AI${payload.model ? ` (${payload.model})` : ""}.`
            : "Generated with fallback heuristics.",
      });
      if (payload.warning) {
        toast.warning("Summary fallback", {
          description: payload.warning,
        });
      }
    } catch (error) {
      toast.error("Summary failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not summarize the current AI inbox.",
      });
    } finally {
      setIsAiInboxSummarizing(false);
    }
  }, [aiInboxItems, aiInboxUseAi, canUseAiFeatures]);

  const handleSmartMergeAiInbox = useCallback(async () => {
    if (!canManageResources || !activeWorkspaceId) {
      return;
    }

    const mergeCandidates = aiInboxItems.filter(
      (item) => item.selected && item.exactMatches.length > 0,
    );
    if (mergeCandidates.length === 0) {
      toast.error("No duplicate items selected", {
        description:
          "Select analyzed items with exact duplicate matches to smart merge.",
      });
      return;
    }

    setIsAiInboxMerging(true);
    try {
      const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
      const updatedById = new Map<string, ResourceCard>();
      const mergedItemIds = new Set<string>();
      let mergedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const item of mergeCandidates) {
        const targetMatch = item.exactMatches.find((match) => {
          const candidate =
            updatedById.get(match.resourceId) ?? resourceMap.get(match.resourceId);
          return Boolean(candidate) && canManageResourceCard(candidate);
        });

        if (!targetMatch) {
          skippedCount += 1;
          continue;
        }

        const targetResource =
          updatedById.get(targetMatch.resourceId) ??
          resourceMap.get(targetMatch.resourceId);
        if (!targetResource) {
          skippedCount += 1;
          continue;
        }

        const normalizedUrl = normalizeHttpUrl(item.url)?.toLowerCase() ?? null;
        const matchingLinkIndex = targetResource.links.findIndex((link) => {
          if (link.url === targetMatch.linkUrl) {
            return true;
          }

          if (!normalizedUrl) {
            return false;
          }

          const existingNormalized = normalizeHttpUrl(link.url)?.toLowerCase() ?? null;
          return existingNormalized === normalizedUrl;
        });

        const mergedTags = normalizeDraftTags([
          ...targetResource.tags,
          ...item.tags,
        ]);
        const mergedLinks =
          matchingLinkIndex >= 0
            ? targetResource.links.map((link, index) => {
                if (index !== matchingLinkIndex) {
                  return link;
                }

                const mergedNote = mergeLinkNotes(link.note ?? "", item.note);
                return {
                  ...link,
                  note: mergedNote || undefined,
                };
              })
            : [
                ...targetResource.links,
                {
                  id: `pending-${item.id}`,
                  url: item.url,
                  label: normalizeDraftLabel(item.label),
                  note: normalizeDraftNote(item.note) || undefined,
                },
              ];

        const payloadInput: ResourceInput = {
          workspaceId: targetResource.workspaceId,
          category: targetResource.category,
          tags: mergedTags,
          links: mergedLinks.map((link) => ({
            url: link.url,
            label: normalizeDraftLabel(link.label),
            note: normalizeDraftNote(link.note ?? "") || undefined,
          })),
        };

        try {
          const response = await fetch(`/api/resources/${targetResource.id}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payloadInput),
          });
          const payload = await readJson<ResourceResponse>(response);
          if (!response.ok || !payload?.resource) {
            failedCount += 1;
            continue;
          }

          updatedById.set(payload.resource.id, payload.resource);
          resourceMap.set(payload.resource.id, payload.resource);
          mergedItemIds.add(item.id);
          mergedCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      if (updatedById.size > 0) {
        setResources((previous) =>
          previous.map((resource) => updatedById.get(resource.id) ?? resource),
        );
        void fetchCategories();
      }

      if (mergedItemIds.size > 0) {
        setAiInboxItems((previous) =>
          previous.filter((item) => !mergedItemIds.has(item.id)),
        );
        setAiInboxSummary(null);
      }

      if (mergedCount > 0) {
        toast.success("Smart merge complete", {
          description: `${mergedCount} item(s) merged${skippedCount > 0 ? `, ${skippedCount} skipped.` : ""}${failedCount > 0 ? `, ${failedCount} failed.` : ""}`,
        });
      } else {
        toast.error("Smart merge failed", {
          description:
            failedCount > 0
              ? `All selected merges failed (${failedCount}).`
              : "No eligible duplicate targets were found.",
        });
      }
    } finally {
      setIsAiInboxMerging(false);
    }
  }, [
    activeWorkspaceId,
    aiInboxItems,
    canManageResourceCard,
    canManageResources,
    fetchCategories,
    resources,
  ]);

  const handleImportAiInbox = useCallback(async () => {
    if (!canManageResources || !activeWorkspaceId) {
      return;
    }

    const selectedItems = aiInboxItems.filter((item) => item.selected);
    if (selectedItems.length === 0) {
      toast.error("No links selected", {
        description: "Select at least one analyzed link to import.",
      });
      return;
    }

    const exactDuplicateCount = selectedItems.reduce(
      (count, item) => count + item.exactMatches.length,
      0,
    );
    if (exactDuplicateCount > 0 && typeof window !== "undefined") {
      const shouldContinue = window.confirm(
        `${exactDuplicateCount} exact duplicate match(es) are selected. Import anyway?`,
      );
      if (!shouldContinue) {
        return;
      }
    }

    setIsAiInboxImporting(true);
    try {
      const createdResources: ResourceCard[] = [];
      let failed = 0;

      for (const item of selectedItems) {
        const payloadInput: ResourceInput = {
          workspaceId: activeWorkspaceId,
          category: normalizeAiInboxCategory(item.category, activeCategory),
          tags: normalizeDraftTags(item.tags ?? []),
          links: [
            {
              url: item.url,
              label: normalizeDraftLabel(item.label),
              note: normalizeDraftNote(item.note) || undefined,
            },
          ],
        };

        try {
          const response = await fetch("/api/resources", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payloadInput),
          });
          const payload = await readJson<ResourceResponse>(response);
          if (!response.ok || !payload?.resource) {
            failed += 1;
            continue;
          }

          createdResources.push(payload.resource);
        } catch {
          failed += 1;
        }
      }

      if (createdResources.length > 0) {
        setResources((previous) => [...createdResources, ...previous]);
        setWorkspaceResourceCounts((previous) => ({
          ...previous,
          [activeWorkspaceId]:
            (previous[activeWorkspaceId] ?? 0) + createdResources.length,
        }));
        void fetchCategories();
      }

      const importedIds = new Set(createdResources.flatMap((resource) => resource.links.map((link) => link.url)));
      setAiInboxItems((previous) =>
        previous.filter((item) => !importedIds.has(item.url) || !item.selected),
      );
      if (createdResources.length > 0) {
        setAiInboxSummary(null);
      }

      if (createdResources.length > 0) {
        toast.success("AI Inbox import complete", {
          description: `${createdResources.length} link(s) imported${failed > 0 ? `, ${failed} failed.` : "."}`,
        });
      } else {
        toast.error("AI Inbox import failed", {
          description: "No links were imported.",
        });
      }
    } finally {
      setIsAiInboxImporting(false);
    }
  }, [
    activeCategory,
    activeWorkspaceId,
    aiInboxItems,
    canManageResources,
    fetchCategories,
  ]);

  const syncAskLibraryFromConversation = useCallback(
    (conversation: AskLibraryConversationTurn[]) => {
      const latestAssistantTurn = [...conversation]
        .reverse()
        .find((turn) => turn.role === "assistant");

      if (!latestAssistantTurn) {
        setAskLibraryAnswer(null);
        setAskLibraryCitations([]);
        setAskLibraryReasoning(null);
        setAskLibraryFollowUpSuggestions([]);
        setAskLibraryUsedAi(false);
        setAskLibraryModel(null);
        return;
      }

      setAskLibraryAnswer(latestAssistantTurn.content);
      setAskLibraryCitations(latestAssistantTurn.citations ?? []);
      setAskLibraryReasoning(latestAssistantTurn.reasoning ?? null);
      setAskLibraryFollowUpSuggestions(
        latestAssistantTurn.followUpSuggestions ?? [],
      );
      setAskLibraryUsedAi(latestAssistantTurn.usedAi === true);
      setAskLibraryModel(latestAssistantTurn.model ?? null);
    },
    [],
  );

  const fetchAskLibraryThreads = useCallback(async () => {
    if (!sessionUserId) {
      setAskLibraryThreads([]);
      setAskLibraryThreadsError(null);
      return;
    }

    setIsAskLibraryThreadsLoading(true);
    setAskLibraryThreadsError(null);
    try {
      const params = new URLSearchParams();
      if (activeWorkspaceId) {
        params.set("workspaceId", activeWorkspaceId);
      }
      params.set("limit", "12");

      const response = await fetch(`/api/library/threads?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await readJson<AskLibraryThreadsResponse>(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load Ask Library threads.");
      }

      const threads = payload?.threads ?? [];
      setAskLibraryThreads(threads);
      if (
        askLibraryThreadId &&
        !threads.some((thread) => thread.id === askLibraryThreadId)
      ) {
        setAskLibraryThreadId(null);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load Ask Library threads.";
      setAskLibraryThreadsError(message);
      setAskLibraryThreads([]);
      console.error(
        "Failed to fetch Ask Library threads:",
        message,
      );
    } finally {
      setIsAskLibraryThreadsLoading(false);
    }
  }, [activeWorkspaceId, askLibraryThreadId, sessionUserId]);

  const handleAskLibraryLoadThread = useCallback(
    async (threadId: string) => {
      if (!sessionUserId) {
        return;
      }

      setIsAskLibraryThreadLoading(true);
      try {
        const response = await fetch(`/api/library/threads/${threadId}`, {
          cache: "no-store",
        });
        const payload = await readJson<AskLibraryThreadResponse>(response);
        const thread = payload?.thread;
        if (!response.ok || !thread) {
          throw new Error(payload?.error ?? "Failed to load Ask Library thread.");
        }

        setAskLibraryThreadId(thread.id);
        setAskLibraryConversation(thread.conversation ?? []);
        syncAskLibraryFromConversation(thread.conversation ?? []);
        setAskLibraryQuery("");
      } catch (error) {
        toast.error("Thread load failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not load Ask Library thread.",
        });
      } finally {
        setIsAskLibraryThreadLoading(false);
      }
    },
    [sessionUserId, syncAskLibraryFromConversation],
  );

  const handleAskLibraryOpen = useCallback(() => {
    if (!askLibraryQuery.trim() && searchQuery.trim()) {
      setAskLibraryQuery(searchQuery.trim());
    }
    setAskScopeCategory(activeCategory !== "All");
    setAskLibraryOpen(true);
  }, [activeCategory, askLibraryQuery, searchQuery]);

  useEffect(() => {
    if (!askLibraryOpen || !sessionUserId) {
      return;
    }

    void fetchAskLibraryThreads();
  }, [askLibraryOpen, fetchAskLibraryThreads, sessionUserId]);

  const handleAskLibraryReset = useCallback(() => {
    setAskLibraryThreadId(null);
    setAskLibraryConversation([]);
    setAskLibraryAnswer(null);
    setAskLibraryCitations([]);
    setAskLibraryReasoning(null);
    setAskLibraryFollowUpSuggestions([]);
    setAskLibraryUsedAi(false);
    setAskLibraryModel(null);
    setAskLibraryQuery(searchQuery.trim());
    setAskScopeSelectedTags([]);
  }, [searchQuery]);

  const handleAskLibrarySubmit = useCallback(
    async (nextQuestion?: string) => {
      const question = (nextQuestion ?? askLibraryQuery).trim();
      if (question.length < 2) {
        toast.error("Question too short", {
          description: "Enter at least 2 characters.",
        });
        return;
      }

      const historyPayload = askLibraryConversation
        .slice(-ASK_LIBRARY_HISTORY_LIMIT)
        .map<AskLibraryConversationTurnPayload>((turn) => ({
          role: turn.role,
          content: turn.content,
        }));

      setIsAskingLibrary(true);
      try {
        const response = await fetch("/api/library/ask", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question,
            threadId: askLibraryThreadId,
            workspaceId: activeWorkspaceId,
            category: activeCategory === "All" ? null : activeCategory,
            tags: askScopeTags ? askScopeSelectedTags : [],
            scopeWorkspace: askScopeWorkspace,
            scopeCategory: askScopeCategory,
            scopeTags: askScopeTags,
            useAi: canUseAiFeatures,
            maxCitations: 5,
            history: historyPayload,
          }),
        });
        const payload = await readJson<AskLibraryResponse>(response);
        if (!response.ok || !payload?.answer) {
          throw new Error(payload?.error ?? "Could not generate an answer.");
        }

        setAskLibraryAnswer(payload.answer);
        setAskLibraryCitations(payload.citations ?? []);
        setAskLibraryReasoning(payload.reasoning ?? null);
        setAskLibraryFollowUpSuggestions(payload.followUpSuggestions ?? []);
        setAskLibraryUsedAi(payload.usedAi === true);
        setAskLibraryModel(payload.model ?? null);
        if (payload.threadId) {
          setAskLibraryThreadId(payload.threadId);
        }
        setAskLibraryConversation((previous) => {
          const next: AskLibraryConversationTurn[] = [
            ...previous,
            {
              id: createAskLibraryTurnId(),
              role: "user",
              content: question,
              createdAt: new Date().toISOString(),
            },
            {
              id: createAskLibraryTurnId(),
              role: "assistant",
              content: payload.answer ?? "",
              usedAi: payload.usedAi === true,
              model: payload.model ?? null,
              citations: payload.citations ?? [],
              reasoning: payload.reasoning ?? null,
              followUpSuggestions: payload.followUpSuggestions ?? [],
              createdAt: new Date().toISOString(),
            },
          ];

          return next.slice(-(ASK_LIBRARY_HISTORY_LIMIT * 2));
        });
        setAskLibraryQuery("");
        if (sessionUserId) {
          void fetchAskLibraryThreads();
        }
      } catch (error) {
        toast.error("Ask Library failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not answer from your saved library.",
        });
      } finally {
        setIsAskingLibrary(false);
      }
    },
    [
      activeCategory,
      activeWorkspaceId,
      askLibraryConversation,
      askLibraryQuery,
      askLibraryThreadId,
      askScopeCategory,
      askScopeSelectedTags,
      askScopeTags,
      askScopeWorkspace,
      canUseAiFeatures,
      fetchAskLibraryThreads,
      sessionUserId,
    ],
  );

  return (
    <div
      className={cn(
        "flex h-dvh flex-col overflow-hidden",
        isReallyCompactMode ? "compact-mode" : undefined,
      )}
      data-compact-mode={isReallyCompactMode ? "true" : "false"}
    >
      <header
        className={cn(
          "flex shrink-0 flex-wrap items-center border-b border-border bg-card",
          isReallyCompactMode
            ? "sticky top-0 z-40 gap-1 px-2 py-1 backdrop-blur supports-[backdrop-filter]:bg-card/90"
            : "gap-3 px-4 py-3 lg:px-6",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "text-muted-foreground md:hidden",
            isReallyCompactMode ? "h-8 w-8" : undefined,
          )}
          onClick={() => setSidebarOpen(true)}
          aria-label="Open organization, workspace, and category menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2.5">
          <img
            src="/bluesix-cloud-text-logo.png"
            alt="BlueSix"
            width={256}
            height={64}
            className={cn(
              "h-auto w-auto shrink-0 object-contain",
              isReallyCompactMode
                ? "max-h-7 max-w-[7.5rem]"
                : "max-h-8 max-w-[8.5rem] sm:max-w-[10rem]",
            )}
          />
          <div className="hidden items-center gap-2.5 sm:flex">
            {isAuthenticated &&
            session?.user?.email &&
            generalSettings.showAccountEmail ? (
              <span className="inline-flex max-w-56 flex-col rounded-xl border border-border bg-secondary px-2.5 py-1 leading-tight text-secondary-foreground">
                <span className="truncate text-[11px] font-medium">
                  {session.user.email}
                </span>
                {generalSettings.showAccountRole ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {roleLabel}
                  </span>
                ) : null}
              </span>
            ) : null}
            {dataMode === "mock" && generalSettings.showMockModeBadge ? (
              <span className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                mock mode
              </span>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            "relative min-w-48 flex-1",
            isReallyCompactMode ? "hidden" : undefined,
          )}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="search"
            placeholder="Search resources..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
            aria-label="Search resources"
          />
        </div>

        <div
          className={cn(
            "ml-auto flex items-center gap-2",
            isReallyCompactMode ? "hidden" : undefined,
          )}
        >
          <CompactModeToggle
            enabled={isReallyCompactMode}
            onToggle={() => setIsReallyCompactMode((previous) => !previous)}
          />

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Palette className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Palette</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[23rem] space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Workspace Settings
                </p>
                <p className="text-xs text-muted-foreground">
                  Tune section labels, layout density, and role-aware controls.
                </p>
              </div>

              <Tabs defaultValue="appearance" className="space-y-3">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="appearance">Appearance</TabsTrigger>
                  <TabsTrigger value="layout">Layout</TabsTrigger>
                  <TabsTrigger value="access">Access</TabsTrigger>
                </TabsList>

                <TabsContent value="appearance" className="m-0 space-y-3">
                  <div className="rounded-md border border-border/70 bg-card/50 p-3">
                    <PaletteDropdown align="end">
                      <button
                        type="button"
                        className="mb-2 flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-xs ring-offset-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <span className="truncate font-medium text-foreground">
                          {activeColorScheme?.name ?? "Default"}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </PaletteDropdown>
                    <p className="text-xs text-muted-foreground">
                      {activeColorScheme?.description}
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="layout" className="m-0 space-y-3">
                  <div className="rounded-md border border-border/70 bg-card/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-foreground">
                          Compact section titles
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Reduce title spacing for a denser, IDE-like layout.
                        </p>
                      </div>
                      <Switch
                        checked={sectionPreferences.compactTitles}
                        onCheckedChange={(checked) =>
                          updateSectionPreference("compactTitles", checked)
                        }
                        aria-label="Toggle compact section titles"
                      />
                    </div>
                  </div>

                  <div className="rounded-md border border-border/70 bg-card/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-foreground">
                          Context lines
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Show workspace and scope details under each section
                          title.
                        </p>
                      </div>
                      <Switch
                        checked={sectionPreferences.showContextLine}
                        onCheckedChange={(checked) =>
                          updateSectionPreference("showContextLine", checked)
                        }
                        aria-label="Toggle section context lines"
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="access" className="m-0 space-y-3">
                  <div className="rounded-md border border-border/70 bg-card/50 p-3">
                    <p className="text-xs font-semibold text-foreground">
                      {isAuthenticated
                        ? (session?.user?.email ?? "Signed in user")
                        : "Guest session"}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Role: {roleLabel}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {capabilityBadges.length > 0 ? (
                        capabilityBadges.map((badge) => (
                          <span key={badge} className="section-title-badge">
                            {badge}
                          </span>
                        ))
                      ) : (
                        <span className="section-title-badge">Read-only</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-border/70 bg-card/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-foreground">
                          Role hints in section headers
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Keep permissions visible while you browse and edit.
                        </p>
                      </div>
                      <Switch
                        checked={sectionPreferences.showRoleHints}
                        onCheckedChange={(checked) =>
                          updateSectionPreference("showRoleHints", checked)
                        }
                        aria-label="Toggle role hints in section headers"
                      />
                    </div>
                  </div>

                  {isAdmin ? (
                    <div className="rounded-md border border-border/70 bg-card/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-foreground">
                            Admin quick actions
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Expose moderation shortcuts directly inside panel
                            headers.
                          </p>
                        </div>
                        <Switch
                          checked={sectionPreferences.adminQuickActions}
                          onCheckedChange={(checked) =>
                            updateSectionPreference(
                              "adminQuickActions",
                              checked,
                            )
                          }
                          aria-label="Toggle admin quick actions"
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href="/admin">Open Admin Panel</Link>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Admin controls appear after your account is promoted.
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenAiInbox}
            disabled={
              isResourcesLoading ||
              isAiInboxBusy ||
              !canManageResources ||
              !activeWorkspaceId
            }
          >
            <WandSparkles className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">AI Inbox</span>
          </Button>

          {canManageResources ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenTobyImport}
              disabled={
                isResourcesLoading ||
                isTobyImporting ||
                (!resolvedActiveWorkspaceId && !canCreateWorkspaces)
              }
            >
              <Upload className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">Import Toby</span>
            </Button>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            onClick={handleAskLibraryOpen}
            disabled={isAskingLibrary || isResourcesLoading}
          >
            <MessageSquareText className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">Ask Library</span>
          </Button>

          {sessionStatus === "loading" ? (
            <span className="text-xs text-muted-foreground">
              Checking auth...
            </span>
          ) : isAuthenticated ? (
            <>
              {isAdmin ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin">
                    <Settings2 className="h-4 w-4" />
                    <span className="ml-2 hidden sm:inline">Admin Panel</span>
                  </Link>
                </Button>
              ) : null}
              {canCreateWorkspaces ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenCreateWorkspaceDialog}
                  disabled={isWorkspaceMutating}
                >
                  <Plus className="h-4 w-4" />
                  <span className="ml-2 hidden sm:inline">New Workspace</span>
                </Button>
              ) : null}
              {canManageCategories ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenCreateCategoryDialog}
                  disabled={isCategoryMutating || !activeWorkspaceId}
                >
                  <FolderPlus className="h-4 w-4" />
                  <span className="ml-2 hidden sm:inline">New Category</span>
                </Button>
              ) : null}
              {canManageCategories &&
              activeCategory !== "All" &&
              activeCategoryRecord ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUpdateActiveCategorySymbol}
                  disabled={isCategoryMutating}
                >
                  <span className="hidden sm:inline">Edit Category</span>
                  <span className="sm:hidden">Category</span>
                </Button>
              ) : null}
              {canManageCategories &&
              activeCategory !== "All" &&
              activeCategoryRecord ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDeleteActiveCategory()}
                  disabled={isCategoryMutating}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="ml-2 hidden sm:inline">Delete Category</span>
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSignOut()}
              >
                <LogOut className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Sign out</span>
              </Button>
              {canManageResources ? (
                <Button
                  onClick={handleOpenCreateResourceModal}
                  className="gap-2"
                  size="sm"
                  disabled={isResourceActionDisabled}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Add Resource</span>
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openAuthDialog("login")}
              >
                <LogIn className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Sign in</span>
              </Button>
              <Button size="sm" onClick={() => openAuthDialog("register")}>
                <UserPlus className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Register</span>
              </Button>
            </>
          )}
        </div>

        {isReallyCompactMode ? (
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={focusSearchInput}
              aria-label="Focus search input"
            >
              <Search className="h-4 w-4" />
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Open AI actions"
                >
                  <Zap className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 space-y-1 p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start gap-2 text-xs"
                  onClick={handleOpenAiInbox}
                  disabled={
                    isResourcesLoading ||
                    isAiInboxBusy ||
                    !canManageResources ||
                    !activeWorkspaceId
                  }
                >
                  <WandSparkles className="h-3.5 w-3.5" />
                  AI Inbox
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start gap-2 text-xs"
                  onClick={handleAskLibraryOpen}
                  disabled={isAskingLibrary || isResourcesLoading}
                >
                  <MessageSquareText className="h-3.5 w-3.5" />
                  Ask Library
                </Button>
              </PopoverContent>
            </Popover>

            {canManageResources ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={handleOpenCreateResourceModal}
                disabled={isResourceActionDisabled}
                aria-label="Add resource"
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : null}

            {!isAuthenticated ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => openAuthDialog("login")}
                aria-label="Sign in"
              >
                <LogIn className="h-4 w-4" />
              </Button>
            ) : null}

            {canManageResources ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={handleOpenTobyImport}
                disabled={
                  isTobyImporting ||
                  (!resolvedActiveWorkspaceId && !canCreateWorkspaces)
                }
                aria-label="Import Toby JSON"
              >
                <Upload className="h-4 w-4" />
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setGeneralSettingsOpen(true)}
              aria-label="Open settings"
            >
              <Settings2 className="h-4 w-4" />
            </Button>

            <CompactModeToggle
              enabled={isReallyCompactMode}
              onToggle={() =>
                setIsReallyCompactMode((previous) => !previous)
              }
            />
          </div>
        ) : null}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className={cn(
            "hidden shrink-0 border-r border-border bg-card md:block",
            isReallyCompactMode ? "w-12" : "w-14",
          )}
          aria-label="Organization navigation"
        >
          <OrganizationRail
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
            compactMode={isReallyCompactMode}
            isLoading={isOrganizationsLoading}
            onOrganizationChange={(organizationId) => {
              setActiveOrganizationId(organizationId);
              setActiveWorkspaceId(null);
              setActiveCategory("All");
            }}
            canCreateOrganization={canCreateOrganizations}
            onCreateOrganization={handleOpenCreateOrganizationDialog}
            showSettingsButton
            onOpenSettings={() => setGeneralSettingsOpen(true)}
          />
        </aside>

        <aside
          className={cn(
            "hidden shrink-0 border-r border-border bg-card md:block",
            isReallyCompactMode ? "w-9" : "w-56",
          )}
          aria-label="Workspace navigation"
        >
          <WorkspaceRail
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            compactMode={isReallyCompactMode}
            isLoading={isWorkspacesLoading}
            onWorkspaceChange={(workspaceId) => {
              setActiveWorkspaceId(workspaceId);
              setActiveCategory("All");
            }}
            canCreateWorkspace={canCreateWorkspaces}
            onCreateWorkspace={handleOpenCreateWorkspaceDialog}
            resourceCountsByWorkspace={workspaceResourceCounts}
          />
        </aside>

        {!isReallyCompactMode ? (
          <aside
            className={`group/sidebar relative hidden shrink-0 border-r border-border bg-card md:block ${
              isSidebarResizing
                ? ""
                : "transition-[width] duration-200 ease-in-out"
            }`}
            style={{ width: `${desktopSidebarWidth}px` }}
            aria-label="Category navigation"
          >
            <CategorySidebar
              categories={categories}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              isLoading={isCategoriesLoading || isWorkspacesLoading}
              resourceCounts={resourceCounts}
              categorySymbols={categorySymbols}
              canManageCategories={canManageCategories}
              onCreateCategory={handleOpenCreateCategoryDialog}
              canEditCategory={canEditCategoryByName}
              onEditCategory={handleOpenEditCategoryDialogByName}
              onDeleteCategory={(category) => {
                void handleDeleteCategoryByName(category);
              }}
              canPasteIntoCategory={canManageResources && !isPasteFlowInProgress}
              onPasteIntoCategory={(category) => {
                setActiveCategory(category);
                handlePasteIntoCategory(category);
              }}
              canDropLinkItems={canManageResources && !isSearchActive}
              onDropLinkItemToCategory={handleDropLinkItemToSidebarCategory}
              onOpenWorkspaceSettings={
                activeWorkspace?.ownerUserId ? handleOpenWorkspaceSettings : undefined
              }
              headingLabel={sidebarHeadingLabel}
              headingMeta={sidebarHeadingMeta}
              headingCount={categories.length}
              compactHeading={sectionPreferences.compactTitles}
              roleHint={
                sectionPreferences.showRoleHints ? sectionRoleHint : undefined
              }
            />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize categories panel"
              aria-valuemin={DESKTOP_SIDEBAR_MIN_WIDTH}
              aria-valuemax={desktopSidebarMaxWidth}
              aria-valuenow={desktopSidebarWidth}
              tabIndex={0}
              onPointerDown={handleDesktopSidebarResizeStart}
              onKeyDown={handleDesktopSidebarResizeKeyDown}
              className={`absolute inset-y-0 right-0 z-10 w-4 translate-x-1/2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 after:rounded-full after:transition-colors after:duration-200 after:ease-in-out ${
                isSidebarResizing
                  ? "after:bg-sidebar-ring"
                  : "after:bg-transparent group-hover/sidebar:after:bg-sidebar-border/50 hover:after:bg-sidebar-border focus-visible:after:bg-sidebar-ring"
              }`}
            />
          </aside>
        ) : null}

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent
            side="left"
            className={cn("p-0", isReallyCompactMode ? "w-full max-w-full" : "w-72")}
          >
            <div className="border-b border-border/70 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Organizations
              </p>
              <div className="mt-2">
                <OrganizationRail
                  organizations={organizations}
                  activeOrganizationId={activeOrganizationId}
                  orientation="horizontal"
                  compactMode={isReallyCompactMode}
                  isLoading={isOrganizationsLoading}
                  onOrganizationChange={(organizationId) => {
                    setActiveOrganizationId(organizationId);
                    setActiveWorkspaceId(null);
                    setActiveCategory("All");
                  }}
                  canCreateOrganization={canCreateOrganizations}
                  onCreateOrganization={handleOpenCreateOrganizationDialog}
                />
              </div>
            </div>
            <div className="border-b border-border/70 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Workspaces
              </p>
              <div className="mt-2">
                <WorkspaceRail
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  orientation="horizontal"
                  compactMode={isReallyCompactMode}
                  isLoading={isWorkspacesLoading}
                  onWorkspaceChange={(workspaceId) => {
                    setActiveWorkspaceId(workspaceId);
                    setActiveCategory("All");
                  }}
                  canCreateWorkspace={canCreateWorkspaces}
                  onCreateWorkspace={handleOpenCreateWorkspaceDialog}
                  resourceCountsByWorkspace={workspaceResourceCounts}
                />
              </div>
            </div>
            <SheetHeader className="px-4 pt-4">
              <SheetTitle
                className={cn(
                  "w-fit section-title-pill",
                  sectionPreferences.compactTitles
                    ? "gap-1.5 px-2.5 py-0.5 text-[0.62rem]"
                    : "",
                )}
              >
                {sidebarHeadingLabel}
              </SheetTitle>
              <SheetDescription
                className={
                  sectionPreferences.showContextLine
                    ? "text-xs text-muted-foreground"
                    : "sr-only"
                }
              >
                {sectionPreferences.showContextLine
                  ? `Filter categories in ${organizationDisplayName} / ${workspaceDisplayName}`
                  : "Filter resources by category"}
              </SheetDescription>
            </SheetHeader>
            <CategorySidebar
              categories={categories}
              activeCategory={activeCategory}
              isLoading={isCategoriesLoading || isWorkspacesLoading}
              onCategoryChange={(category) => {
                setActiveCategory(category);
                setSidebarOpen(false);
              }}
              resourceCounts={resourceCounts}
              categorySymbols={categorySymbols}
              canManageCategories={canManageCategories}
              onCreateCategory={handleOpenCreateCategoryDialog}
              canEditCategory={canEditCategoryByName}
              onEditCategory={handleOpenEditCategoryDialogByName}
              onDeleteCategory={(category) => {
                void handleDeleteCategoryByName(category);
              }}
              canPasteIntoCategory={canManageResources && !isPasteFlowInProgress}
              onPasteIntoCategory={(category) => {
                setActiveCategory(category);
                setSidebarOpen(false);
                handlePasteIntoCategory(category);
              }}
              canDropLinkItems={canManageResources && !isSearchActive}
              onDropLinkItemToCategory={(input) => {
                handleDropLinkItemToSidebarCategory(input);
                setSidebarOpen(false);
              }}
              showHeading={false}
            />
          </SheetContent>
        </Sheet>

        <ContextMenu onOpenChange={handleLibraryContextMenuOpenChange}>
          <ContextMenuTrigger asChild>
            <main
              ref={resourceScrollContainerRef}
              className={cn(
                "flex-1 overflow-x-hidden",
                isReallyCompactMode
                  ? "flex flex-col overflow-hidden p-1 sm:p-1.5"
                  : "overflow-y-auto p-4 lg:p-6",
              )}
              aria-label="Resource cards"
            >
              {isReallyCompactMode ? (
                <div className="mb-1 flex items-center gap-1 rounded-sm border border-border/60 bg-card/70 px-1 py-1">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    type="search"
                    placeholder="Search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                    aria-label="Search resources"
                  />
                  {isSearchActive ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear search"
                    >
                      <FilterX className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleRefreshLibrary}
                    disabled={isRefreshingLibrary}
                    aria-label="Refresh library"
                  >
                    <RefreshCw
                      className={cn(
                        "h-3.5 w-3.5",
                        isRefreshingLibrary ? "animate-spin" : "",
                      )}
                    />
                  </Button>
                </div>
              ) : (
                <div
                  className={cn(
                    "mb-5 flex flex-wrap justify-between gap-3 border-b border-border/60",
                    sectionPreferences.compactTitles
                      ? "items-start pb-3"
                      : "items-end pb-4",
                  )}
                >
                <div
                  className={cn(
                    "max-w-full",
                    sectionPreferences.compactTitles
                      ? "space-y-1.5"
                      : "space-y-2",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={cn(
                        "section-title-pill",
                        sectionPreferences.compactTitles
                          ? "gap-1.5 px-2.5 py-0.5 text-[0.62rem]"
                          : "",
                      )}
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-primary" />
                      {mainSectionPillLabel}
                    </p>
                    <span className="section-title-badge">
                      {activeCategoryCount} item
                      {activeCategoryCount === 1 ? "" : "s"}
                    </span>
                    {sectionPreferences.showRoleHints ? (
                      <span className="section-title-badge">{roleLabel}</span>
                    ) : null}
                  </div>

                  {mainSectionMetaLine ? (
                    <p className="section-title-meta">{mainSectionMetaLine}</p>
                  ) : null}

                  <h2
                    className={cn(
                      "section-title-heading text-xl sm:text-2xl",
                      sectionPreferences.compactTitles
                        ? "text-lg sm:text-xl"
                        : "",
                    )}
                  >
                    {activeCategorySymbol ? `${activeCategorySymbol} ` : ""}
                    {activeSectionTitle}
                  </h2>

                  {sectionPreferences.showRoleHints ? (
                    <p className="section-title-hint">{sectionRoleHint}</p>
                  ) : null}

                  {isAdmin && sectionPreferences.adminQuickActions ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button asChild variant="outline" size="sm">
                        <Link href="/admin">
                          <Settings2 className="h-3.5 w-3.5" />
                          <span className="ml-2">Review Queue</span>
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenCreateCategoryDialog}
                        disabled={isCategoryMutating || !activeWorkspaceId}
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                        <span className="ml-2">New Category</span>
                      </Button>
                    </div>
                  ) : null}
                </div>

                <p className="text-xs text-muted-foreground sm:text-sm">
                  {activeCategoryCount} resource
                  {activeCategoryCount === 1 ? "" : "s"}
                  {isSearchActive
                    ? ` total, ${filteredResources.length} shown`
                    : ""}
                </p>
                </div>
              )}
              {organizationLoadError ||
              workspaceLoadError ||
              categoryLoadError ||
              workspaceCountsError ||
              showOrganizationsEmptyState ||
              showWorkspacesEmptyState ||
              showCategoriesEmptyState ? (
                <div
                  className={cn(
                    "space-y-2",
                    isReallyCompactMode ? "mb-2" : "mb-4",
                  )}
                >
                  {organizationLoadError ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                      <p className="text-xs text-destructive">
                        Could not load organizations: {organizationLoadError}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void fetchOrganizations();
                        }}
                        disabled={isOrganizationsLoading}
                        className="h-7 px-2 text-xs"
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}

                  {workspaceLoadError ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                      <p className="text-xs text-destructive">
                        Could not load workspaces: {workspaceLoadError}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void fetchWorkspaces();
                        }}
                        disabled={isWorkspacesLoading}
                        className="h-7 px-2 text-xs"
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}

                  {categoryLoadError ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                      <p className="text-xs text-destructive">
                        Could not load categories: {categoryLoadError}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void fetchCategories();
                        }}
                        disabled={isCategoriesLoading}
                        className="h-7 px-2 text-xs"
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}

                  {workspaceCountsError ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                      <p className="text-xs text-amber-300">
                        Workspace counts may be stale: {workspaceCountsError}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void fetchWorkspaceCounts();
                        }}
                        className="h-7 px-2 text-xs"
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}

                  {showOrganizationsEmptyState && !organizationLoadError ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-card/70 px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        No organizations are available yet.
                      </p>
                      {canCreateOrganizations ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleOpenCreateOrganizationDialog}
                          className="h-7 px-2 text-xs"
                        >
                          Create organization
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {showWorkspacesEmptyState && !workspaceLoadError ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-card/70 px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        No workspaces found for this organization.
                      </p>
                      {canCreateWorkspaces ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleOpenCreateWorkspaceDialog}
                          className="h-7 px-2 text-xs"
                        >
                          Create workspace
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {showCategoriesEmptyState && !categoryLoadError ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-card/70 px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        No categories found in this workspace yet.
                      </p>
                      {canManageCategories ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleOpenCreateCategoryDialog}
                          disabled={isCategoryMutating || !activeWorkspaceId}
                          className="h-7 px-2 text-xs"
                        >
                          Create category
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {showResourceSkeleton ? (
                isReallyCompactMode ? (
                  <div className="space-y-1">
                    {Array.from({ length: 14 }, (_, index) => (
                      <div
                        key={`resource-skeleton-compact-${index}`}
                        className="flex h-8 items-center gap-1 rounded-sm border border-border/70 bg-card/65 px-1"
                      >
                        <Skeleton className="h-4 w-4 rounded-sm" />
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="ml-auto h-3 w-16" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {Array.from({ length: 8 }, (_, index) => (
                      <div
                        key={`resource-skeleton-${index}`}
                        className="space-y-4 rounded-xl border border-border/70 bg-card/70 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <Skeleton className="h-4 w-28" />
                          <Skeleton className="h-5 w-10 rounded-full" />
                        </div>
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-[78%]" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Skeleton className="h-6 w-20 rounded-full" />
                          <Skeleton className="h-6 w-16 rounded-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : showResourceLoadError ? (
                <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                  <h2 className="text-lg font-semibold text-foreground">
                    Unable to load resources
                  </h2>
                  <p className="max-w-xl text-sm text-muted-foreground">
                    {loadError}
                  </p>
                  <Button onClick={handleRefreshLibrary} size="sm">
                    Retry
                  </Button>
                </div>
              ) : filteredResources.length === 0 ? (
                isReallyCompactMode ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border/60 p-2 text-[11px] text-muted-foreground">
                    <p>
                      {searchQuery
                        ? `No matches for \"${searchQuery}\".`
                        : "No resources in this view."}
                    </p>
                    {hasMoreResources ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void handleLoadMoreResources();
                        }}
                        disabled={isLoadingMoreResources || !activeWorkspaceId}
                        className="h-7 px-2 text-[11px]"
                      >
                        {isLoadingMoreResources ? "Loading..." : "Load more"}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                      <FolderOpen className="h-8 w-8" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        {searchQuery ? "No results found" : "No resources yet"}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {searchQuery
                          ? `Nothing matches \"${searchQuery}\". Try a different search.`
                          : isAuthenticated && !hasActiveWorkspace
                            ? "Create your personal workspace to start organizing cards and categories."
                            : canManageResources
                              ? "Add your first resource to get started!"
                              : isAuthenticated
                                ? "You are signed in as read-only. Ask FirstAdmin for editor or admin access."
                                : "Sign in to manage categories and resources based on your role."}
                      </p>
                    </div>
                    {!searchQuery && isAuthenticated && !hasActiveWorkspace ? (
                      <Button
                        onClick={handleOpenCreateWorkspaceDialog}
                        className="gap-2"
                        disabled={!canCreateWorkspaces}
                      >
                        <Plus className="h-4 w-4" />
                        Create Workspace
                      </Button>
                    ) : null}
                    {!searchQuery && canManageResources && hasActiveWorkspace ? (
                      <Button
                        onClick={handleOpenCreateResourceModal}
                        className="gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        Add Resource
                      </Button>
                    ) : null}
                    {!searchQuery && !isAuthenticated ? (
                      <Button
                        onClick={() => openAuthDialog("login")}
                        className="gap-2"
                      >
                        <LogIn className="h-4 w-4" />
                        Sign in
                      </Button>
                    ) : null}
                    {hasMoreResources ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          void handleLoadMoreResources();
                        }}
                        disabled={isLoadingMoreResources || !activeWorkspaceId}
                        className="gap-2"
                      >
                        {isLoadingMoreResources ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        {isLoadingMoreResources
                          ? "Loading..."
                          : "Load more resources"}
                      </Button>
                    ) : null}
                  </div>
                )
              ) : (
                <>
                  <ResourceBoard
                    columns={boardColumns}
                    resources={filteredResources}
                    activeWorkspaceName={workspaceDisplayName}
                    compactMode={isReallyCompactMode}
                    dragEnabled={canManageResources && !isSearchActive}
                    canManageResource={canManageResourceCard}
                    canEditCategoryByName={canEditCategoryByName}
                    onEditCategory={handleOpenEditCategoryDialogByName}
                    onMoveItem={handleMoveResourceItem}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                    deletingResourceId={deletingResourceId}
                    openLinksInSameTab={generalSettings.openLinksInSameTab}
                  />
                  {hasMoreResources ? (
                    <div className="mt-4 flex flex-col items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          void handleLoadMoreResources();
                        }}
                        disabled={isLoadingMoreResources || !activeWorkspaceId}
                        className="min-w-44 gap-2"
                      >
                        {isLoadingMoreResources ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        {isLoadingMoreResources ? "Loading..." : "Load more resources"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Loaded {resources.length} of {activeWorkspaceResourceTotal}
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </main>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-64">
            <ContextMenuLabel>Library Actions</ContextMenuLabel>
            <ContextMenuSeparator />
            {canManageResources ? (
              <>
                <ContextMenuItem
                  disabled={isResourceActionDisabled}
                  onSelect={handleOpenCreateResourceModal}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add resource card
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!activeWorkspaceId || isPasteFlowInProgress}
                  onSelect={() => {
                    void handlePasteFromClipboard(
                      activeCategory === "All" ? null : activeCategory,
                    );
                  }}
                >
                  <ClipboardPaste className="mr-2 h-4 w-4" />
                  Paste URL from clipboard
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={
                    isTobyImporting ||
                    (!resolvedActiveWorkspaceId && !canCreateWorkspaces)
                  }
                  onSelect={handleOpenTobyImport}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Import Toby JSON
                </ContextMenuItem>
              </>
            ) : null}
            {canManageCategories ? (
              <ContextMenuItem
                disabled={!activeWorkspaceId}
                onSelect={handleOpenCreateCategoryDialog}
              >
                <FolderPlus className="mr-2 h-4 w-4" />
                Create category
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              disabled={
                !canManageResources ||
                isAiInboxBusy ||
                isResourcesLoading ||
                !activeWorkspaceId
              }
              onSelect={handleOpenAiInbox}
            >
              <WandSparkles className="mr-2 h-4 w-4" />
              AI inbox
            </ContextMenuItem>
            <ContextMenuItem
              disabled={isAskingLibrary || isResourcesLoading}
              onSelect={handleAskLibraryOpen}
            >
              <MessageSquareText className="mr-2 h-4 w-4" />
              Ask library
            </ContextMenuItem>
            {canManageResources || canManageCategories ? (
              <ContextMenuSeparator />
            ) : null}
            <ContextMenuItem
              disabled={searchQuery.trim().length === 0}
              onSelect={() => setSearchQuery("")}
            >
              <FilterX className="mr-2 h-4 w-4" />
              Clear search
            </ContextMenuItem>
            <ContextMenuItem
              disabled={activeCategory === "All"}
              onSelect={() => setActiveCategory("All")}
            >
              <FilterX className="mr-2 h-4 w-4" />
              Show all categories
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleRefreshLibrary}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh library
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      <Dialog
        open={tobyImportOpen}
        onOpenChange={(open) => {
          if (isTobyImporting) {
            return;
          }

          setTobyImportOpen(open);
          if (!open) {
            setTobyImportRawInput("");
            setTobyImportFileName(null);
            setTobyImportCreateWorkspace(false);
            setTobyImportWorkspaceName(DEFAULT_TOBY_WORKSPACE_NAME);
            setTobyImportSkipExactDuplicates(true);
            setTobyImportPreview(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Toby JSON</DialogTitle>
            <DialogDescription>
              Import a Toby JSON export into the current workspace, or create a
              new workspace for it first.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-3 rounded-md border border-border/70 bg-card/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Create a new workspace
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {resolvedActiveWorkspaceId
                      ? `Leave this off to import into ${workspaceDisplayName}.`
                      : "No current workspace is selected, so this import will create one first."}
                  </p>
                </div>
                <Switch
                  checked={tobyImportCreateWorkspace}
                  onCheckedChange={(checked) => {
                    setTobyImportCreateWorkspace(checked);
                    setTobyImportPreview(null);
                  }}
                  disabled={!canCreateWorkspaces || !resolvedActiveWorkspaceId}
                  aria-label="Create a new workspace for this import"
                />
              </div>

              {tobyImportCreateWorkspace ? (
                <div className="space-y-2">
                  <Label htmlFor="toby-workspace-name">Workspace name</Label>
                  <Input
                    id="toby-workspace-name"
                    value={tobyImportWorkspaceName}
                    onChange={(event) => {
                      setTobyImportWorkspaceName(event.target.value);
                      setTobyImportPreview(null);
                    }}
                    placeholder={DEFAULT_TOBY_WORKSPACE_NAME}
                    maxLength={80}
                    disabled={isTobyImporting}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Import target: <strong>{workspaceDisplayName}</strong>
                </p>
              )}

              {!canCreateWorkspaces ? (
                <p className="text-xs text-muted-foreground">
                  Your account cannot create another workspace right now.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="toby-json-file">JSON file</Label>
              <Input
                id="toby-json-file"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  void handleSelectTobyJsonFile(event);
                }}
                disabled={isTobyImporting}
              />
              <p className="text-xs text-muted-foreground">
                {tobyImportFileName
                  ? `Loaded file: ${tobyImportFileName}`
                  : "Upload a Toby export or paste the JSON below."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="toby-json-input">Toby JSON</Label>
              <Textarea
                id="toby-json-input"
                value={tobyImportRawInput}
                onChange={(event) => {
                  setTobyImportRawInput(event.target.value);
                  setTobyImportPreview(null);
                }}
                placeholder='{"version":3,"lists":[...]}'
                rows={14}
                disabled={isTobyImporting}
              />
              <p className="text-xs text-muted-foreground">
                Toby lists become categories. Toby cards become resource cards.
              </p>
            </div>

            <div className="space-y-3 rounded-md border border-border/70 bg-card/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Skip exact duplicates
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ignore links that already exist in the target workspace.
                  </p>
                </div>
                <Switch
                  checked={tobyImportSkipExactDuplicates}
                  onCheckedChange={setTobyImportSkipExactDuplicates}
                  disabled={isTobyImporting || tobyImportCreateWorkspace}
                  aria-label="Skip exact duplicate links during Toby import"
                />
              </div>

              {tobyImportPreview ? (
                <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{tobyImportPreview.importedLists} list(s)</span>
                    <span>{tobyImportPreview.importedCards} card(s)</span>
                    <span>
                      {tobyImportPreview.exactDuplicateCount} exact duplicate(s)
                    </span>
                  </div>

                  {tobyImportPreview.duplicateSamples.length > 0 ? (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {tobyImportPreview.duplicateSamples.map((sample) => (
                        <p key={`${sample.url}|${sample.label}`}>
                          <strong className="text-foreground">{sample.label}</strong>
                          {` in `}
                          {sample.matches
                            .map((match) => match.category)
                            .filter((category, index, values) =>
                              values.indexOf(category) === index,
                            )
                            .join(", ")}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No exact duplicates found for this import.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTobyImportOpen(false)}
                disabled={isTobyImporting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handlePreviewTobyImport()}
                disabled={
                  isTobyImporting ||
                  isTobyImportPreviewing ||
                  (!resolvedActiveWorkspaceId && !tobyImportCreateWorkspace) ||
                  (tobyImportCreateWorkspace &&
                    tobyImportWorkspaceName.trim().length === 0) ||
                  tobyImportRawInput.trim().length === 0
                }
              >
                {isTobyImportPreviewing ? "Previewing..." : "Preview"}
              </Button>
              <Button
                type="button"
                onClick={() => void handleImportTobyJson()}
                disabled={
                  isTobyImporting ||
                  (!resolvedActiveWorkspaceId && !tobyImportCreateWorkspace) ||
                  (tobyImportCreateWorkspace &&
                    tobyImportWorkspaceName.trim().length === 0) ||
                  tobyImportRawInput.trim().length === 0
                }
              >
                {isTobyImporting ? "Importing..." : "Import Toby JSON"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={aiPastePromptOpen}
        onOpenChange={(open) => {
          if (isAiPastePreferenceSaving) {
            return;
          }

          setAiPastePromptOpen(open);
          if (!open) {
            setPendingPasteUrl(null);
            setPendingPasteCategory(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Enable AI for Paste?</DialogTitle>
            <DialogDescription>
              AI can generate a cleaner label and short description for pasted
              URLs. This prompt appears only once.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isAiPastePreferenceSaving}
              onClick={() => {
                void handleAiPastePromptChoice("declined");
              }}
            >
              No
            </Button>
            <Button
              type="button"
              disabled={isAiPastePreferenceSaving}
              onClick={() => {
                void handleAiPastePromptChoice("accepted");
              }}
            >
              {isAiPastePreferenceSaving ? "Saving..." : "Yes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={aiInboxOpen}
        onOpenChange={(open) => {
          if (isAiInboxBusy) {
            return;
          }
          setAiInboxOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>AI Inbox</DialogTitle>
            <DialogDescription>
              Paste multiple URLs, review AI suggestions, and import selected
              links into your active workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-inbox-urls">URLs</Label>
              <Textarea
                id="ai-inbox-urls"
                value={aiInboxRawInput}
                onChange={(event) => setAiInboxRawInput(event.target.value)}
                placeholder="Paste one or more URLs (one per line or mixed text)..."
                rows={6}
                disabled={isAiInboxBusy}
              />
              <p className="text-xs text-muted-foreground">
                Up to {AI_INBOX_MAX_URLS} URLs per run.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-card/50 p-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">
                    Use AI suggestions
                  </span>
                  <Switch
                    checked={aiInboxUseAi && canUseAiFeatures}
                    onCheckedChange={(checked) => setAiInboxUseAi(checked)}
                    disabled={
                      !canUseAiFeatures ||
                      isAiInboxBusy
                    }
                    aria-label="Use AI for AI Inbox suggestions"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {canUseAiFeatures
                    ? "Enabled: labels, notes, categories, and tags will be AI-enriched."
                    : "AI features are disabled; inbox uses deterministic fallback metadata."}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleAnalyzeAiInbox()}
                  disabled={
                    isAiInboxBusy ||
                    aiInboxRawInput.trim().length === 0
                  }
                >
                  {isAiInboxAnalyzing ? "Analyzing..." : "Analyze"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAiInboxAutoGroup}
                  disabled={isAiInboxBusy || aiInboxItems.length === 0}
                >
                  Group
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleAiInboxSuggestShortNames()}
                  disabled={isAiInboxBusy || aiInboxItems.length === 0}
                >
                  {isAiInboxRenamingCategories ? "Renaming..." : "Short names"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAiInboxSortByPriority}
                  disabled={isAiInboxBusy || aiInboxItems.length === 0}
                >
                  Sort
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAiInboxDeduplicate}
                  disabled={isAiInboxBusy || aiInboxItems.length === 0}
                >
                  Dedupe
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleAiInboxSummarize()}
                  disabled={isAiInboxBusy || aiInboxItems.length === 0}
                >
                  {isAiInboxSummarizing ? "Summarizing..." : "Summary"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleSmartMergeAiInbox()}
                  disabled={
                    isAiInboxBusy ||
                    aiInboxMergeCandidateCount === 0
                  }
                >
                  {isAiInboxMerging
                    ? "Merging..."
                    : `Smart merge (${aiInboxMergeCandidateCount})`}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleImportAiInbox()}
                  disabled={
                    isAiInboxBusy ||
                    aiInboxSelectedCount === 0
                  }
                >
                  {isAiInboxImporting
                    ? "Importing..."
                    : `Import selected (${aiInboxSelectedCount})`}
                </Button>
              </div>
            </div>

            {aiInboxSummary ? (
              <div className="space-y-2 rounded-md border border-border/70 bg-card/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Batch summary
                  </p>
                  <span className="text-[11px] text-muted-foreground">
                    {aiInboxSummary.usedAi
                      ? `AI${aiInboxSummary.model ? ` (${aiInboxSummary.model})` : ""}`
                      : "Fallback"}
                    {` • ${aiInboxSummary.analyzed} link(s)`}
                  </span>
                </div>
                <p className="text-sm text-foreground">{aiInboxSummary.summary}</p>
                {aiInboxSummary.focusCategories.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Focus categories: {aiInboxSummary.focusCategories.join(", ")}
                  </p>
                ) : null}
                {aiInboxSummary.actionItems.length > 0 ? (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {aiInboxSummary.actionItems.map((action) => (
                      <li key={action}>• {action}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {aiInboxItems.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Analyzed links
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {aiInboxItems.length} total
                    {aiInboxExactMatchCount > 0
                      ? ` • ${aiInboxExactMatchCount} exact duplicate match(es)`
                      : ""}
                  </p>
                </div>

                <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                  {aiInboxItems.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "space-y-2 rounded-md border p-3",
                        item.exactMatches.length > 0
                          ? "border-amber-500/60 bg-amber-500/10"
                          : "border-border/70 bg-card/50",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <label className="flex min-w-0 items-start gap-2">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={(event) =>
                              updateAiInboxItem(item.id, (previous) => ({
                                ...previous,
                                selected: event.target.checked,
                              }))
                            }
                            disabled={isAiInboxBusy}
                            className="mt-0.5 h-4 w-4 rounded border-border bg-background"
                          />
                          <span className="break-all text-xs text-foreground">
                            {item.url}
                          </span>
                        </label>

                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          {item.usedAi ? (
                            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                              AI{item.model ? ` (${item.model})` : ""}
                            </span>
                          ) : (
                            <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-muted-foreground">
                              Fallback
                            </span>
                          )}
                          {item.exactMatches.length > 0 ? (
                            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-300">
                              {item.exactMatches.length} exact
                            </span>
                          ) : null}
                          {item.nearMatches.length > 0 ? (
                            <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-muted-foreground">
                              {item.nearMatches.length} similar
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input
                          value={item.label}
                          onChange={(event) =>
                            updateAiInboxItem(item.id, (previous) => ({
                              ...previous,
                              label: event.target.value,
                            }))
                          }
                          placeholder="Label"
                          disabled={isAiInboxBusy}
                        />
                        <Input
                          value={item.category ?? ""}
                          onChange={(event) =>
                            updateAiInboxItem(item.id, (previous) => ({
                              ...previous,
                              category: event.target.value,
                            }))
                          }
                          placeholder="Category"
                          disabled={isAiInboxBusy}
                        />
                        <Input
                          value={item.note}
                          onChange={(event) =>
                            updateAiInboxItem(item.id, (previous) => ({
                              ...previous,
                              note: event.target.value,
                            }))
                          }
                          placeholder="Note"
                          disabled={isAiInboxBusy}
                          className="sm:col-span-2"
                        />
                        <Input
                          value={item.tags.join(", ")}
                          onChange={(event) =>
                            updateAiInboxItem(item.id, (previous) => ({
                              ...previous,
                              tags: normalizeDraftTags(
                                event.target.value
                                  .split(",")
                                  .map((tag) => tag.trim())
                                  .filter(Boolean),
                              ),
                            }))
                          }
                          placeholder="Tags (comma separated)"
                          disabled={isAiInboxBusy}
                          className="sm:col-span-2"
                        />
                      </div>

                      {item.error ? (
                        <p className="text-[11px] text-amber-300">{item.error}</p>
                      ) : null}

                      {item.exactMatches.length > 0 ? (
                        <p className="text-[11px] text-amber-300">
                          Exact duplicate(s):{" "}
                          {summarizeDuplicateMatches(item.exactMatches)}
                        </p>
                      ) : null}
                      {item.nearMatches.length > 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          Similar links: {summarizeDuplicateMatches(item.nearMatches)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={askLibraryOpen}
        onOpenChange={(open) => {
          setAskLibraryOpen(open);
          if (!open) {
            setIsAskingLibrary(false);
            setIsAskLibraryThreadLoading(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ask Your Library</DialogTitle>
            <DialogDescription>
              Ask about saved resources, then continue with follow-up questions
              in the same thread.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {sessionUserId ? (
              <div className="space-y-2 rounded-md border border-border/70 bg-card/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recent threads
                  </p>
                  <span className="text-[11px] text-muted-foreground">
                    {isAskLibraryThreadsLoading ? "Loading..." : `${askLibraryThreads.length} shown`}
                  </span>
                </div>
                {askLibraryThreadsError ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                    <p className="text-xs text-destructive">
                      Could not load threads: {askLibraryThreadsError}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void fetchAskLibraryThreads();
                      }}
                      disabled={isAskLibraryThreadsLoading}
                      className="h-7 px-2 text-xs"
                    >
                      Retry
                    </Button>
                  </div>
                ) : askLibraryThreads.length > 0 ? (
                  <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                    {askLibraryThreads.map((thread) => (
                      <Button
                        key={thread.id}
                        type="button"
                        variant={askLibraryThreadId === thread.id ? "secondary" : "outline"}
                        size="sm"
                        className="h-auto max-w-full px-2 py-1 text-left text-xs"
                        onClick={() => {
                          void handleAskLibraryLoadThread(thread.id);
                        }}
                        disabled={isAskingLibrary || isAskLibraryThreadLoading}
                      >
                        <span className="truncate">{thread.title}</span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No saved threads yet in this workspace.
                  </p>
                )}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="ask-library-query">Question</Label>
              <Textarea
                id="ask-library-query"
                value={askLibraryQuery}
                onChange={(event) => setAskLibraryQuery(event.target.value)}
                placeholder="e.g. What are our best sources on NextAuth session handling?"
                rows={3}
                disabled={isAskingLibrary}
              />
              <p className="text-xs text-muted-foreground">
                {canUseAiFeatures
                  ? "AI-assisted answering is enabled."
                  : "AI-assisted answering is off. You will get a deterministic cited summary."}
              </p>
              <p className="text-xs text-muted-foreground">
                Follow-up prompts use the latest conversation context.
              </p>
            </div>

            <div className="space-y-2 rounded-md border border-border/70 bg-card/50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Limit scope
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
                  <span className="text-xs text-foreground">Workspace</span>
                  <Switch
                    checked={askScopeWorkspace}
                    onCheckedChange={setAskScopeWorkspace}
                    aria-label="Limit Ask Library to current workspace"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
                  <span className="text-xs text-foreground">Category</span>
                  <Switch
                    checked={askScopeCategory}
                    onCheckedChange={setAskScopeCategory}
                    disabled={activeCategory === "All"}
                    aria-label="Limit Ask Library to current category"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
                  <span className="text-xs text-foreground">Tags</span>
                  <Switch
                    checked={askScopeTags}
                    onCheckedChange={setAskScopeTags}
                    disabled={askScopeTagOptions.length === 0}
                    aria-label="Limit Ask Library to selected tags"
                  />
                </div>
              </div>
              {askScopeTags ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    Select tags to narrow search scope.
                  </p>
                  <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                    {askScopeTagOptions.length > 0 ? (
                      askScopeTagOptions.map((tag) => {
                        const isSelected = askScopeSelectedTags.some(
                          (selected) => selected.toLowerCase() === tag.toLowerCase(),
                        );

                        return (
                          <Button
                            key={`ask-scope-tag-${tag}`}
                            type="button"
                            variant={isSelected ? "secondary" : "outline"}
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => {
                              setAskScopeSelectedTags((previous) => {
                                const exists = previous.some(
                                  (selected) =>
                                    selected.toLowerCase() === tag.toLowerCase(),
                                );
                                if (exists) {
                                  return previous.filter(
                                    (selected) =>
                                      selected.toLowerCase() !== tag.toLowerCase(),
                                  );
                                }
                                return [...previous, tag];
                              });
                            }}
                          >
                            {tag}
                          </Button>
                        );
                      })
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        No tags available in current scope.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleAskLibraryReset}
                  disabled={isAskingLibrary || askLibraryConversation.length === 0}
                >
                  New thread
                </Button>
                {askLibraryThreadId ? (
                  <span className="max-w-48 truncate text-[11px] text-muted-foreground">
                    Thread:{" "}
                    {askLibraryThreads.find((thread) => thread.id === askLibraryThreadId)
                      ?.title ?? "Saved"}
                  </span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAskLibraryOpen(false)}
                  disabled={isAskingLibrary || isAskLibraryThreadLoading}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleAskLibrarySubmit();
                  }}
                  disabled={
                    isAskingLibrary ||
                    isAskLibraryThreadLoading ||
                    askLibraryQuery.trim().length < 2
                  }
                >
                  {isAskingLibrary
                    ? "Thinking..."
                    : askLibraryConversation.length > 0
                      ? "Send follow-up"
                      : "Ask"}
                </Button>
              </div>
            </div>

            {askLibraryConversation.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Conversation
                </p>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border/70 bg-card/60 p-3">
                  {askLibraryConversation.map((turn) => (
                    <div
                      key={turn.id}
                      className={cn(
                        "rounded-md border p-2",
                        turn.role === "assistant"
                          ? "border-border/70 bg-background/80"
                          : "border-primary/25 bg-primary/10",
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {turn.role === "assistant" ? "Library" : "You"}
                        </p>
                        {turn.role === "assistant" ? (
                          <span className="text-[11px] text-muted-foreground">
                            {turn.usedAi
                              ? `AI${turn.model ? ` (${turn.model})` : ""}`
                              : "Rule-based"}
                          </span>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {turn.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {askLibraryAnswer ? (
              <div className="space-y-3 rounded-md border border-border/70 bg-card/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">Answer</p>
                  <span className="text-xs text-muted-foreground">
                    {askLibraryUsedAi
                      ? `AI${askLibraryModel ? ` (${askLibraryModel})` : ""}`
                      : "Rule-based"}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {askLibraryAnswer}
                </p>

                {askLibraryFollowUpSuggestions.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Suggested follow-ups
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {askLibraryFollowUpSuggestions.map((suggestion) => (
                        <Button
                          key={`ask-follow-up-${suggestion}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-auto whitespace-normal text-left text-xs"
                          disabled={isAskingLibrary}
                          onClick={() => {
                            setAskLibraryQuery(suggestion);
                            void handleAskLibrarySubmit(suggestion);
                          }}
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {askLibraryReasoning ? (
                  <div className="space-y-2 rounded-md border border-border/70 bg-background/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Why this answer
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {askLibraryReasoning.summary}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-border/80 bg-card px-2 py-0.5 text-[11px] font-medium text-foreground">
                        {askLibraryReasoning.averageConfidence}%{" "}
                        {askLibraryReasoning.confidenceLabel} confidence
                      </span>
                      {askLibraryReasoning.primaryCategories.map((category) => (
                        <span
                          key={`ask-reasoning-category-${category}`}
                          className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {category}
                        </span>
                      ))}
                    </div>
                    {askLibraryReasoning.queryTokens.length > 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        Keywords: {askLibraryReasoning.queryTokens.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {askLibraryCitations.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Citations
                    </p>
                    <ul className="space-y-1.5">
                      {askLibraryCitations.map((citation) => (
                        <li
                          key={`${citation.resourceId}-${citation.index}`}
                          className="rounded-md border border-border/70 bg-background/70 p-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <a
                              href={citation.linkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-primary hover:underline"
                            >
                              [{citation.index}] {citation.linkLabel}
                            </a>
                            <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                              {citation.confidence ?? 0}% match
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {citation.category}
                            {citation.tags.length > 0
                              ? ` • ${citation.tags.join(", ")}`
                              : ""}
                          </p>
                          {citation.linkNote ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {citation.linkNote}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={generalSettingsOpen} onOpenChange={setGeneralSettingsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Preferences</DialogTitle>
            <DialogDescription className="sr-only">
              Account and interface preferences. Changes are saved automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Account */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Account
              </p>
              <div className="rounded-md border border-border/70 bg-card/50 p-3">
                {isAuthenticated ? (
                  <>
                    <p className="text-sm font-semibold text-foreground">
                      {session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "User"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {session?.user?.email}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      {roleLabel}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full text-xs"
                      onClick={() => void signOut()}
                      disabled={isDeletingAccount || isExportingAccountData}
                    >
                      <LogOut className="mr-2 h-3.5 w-3.5" />
                      Log out
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full border-destructive/40 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        resetDeleteAccountDialogState();
                        setDeleteAccountDialogOpen(true);
                      }}
                      disabled={isDeletingAccount || isExportingAccountData}
                    >
                      Delete account
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Guest session</p>
                )}
              </div>
            </div>

            {/* General Preferences */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                General Preferences
              </p>
              <div className="space-y-3 rounded-md border border-border/70 bg-card/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-foreground">Open links in same tab</p>
                  <Switch
                    checked={generalSettings.openLinksInSameTab}
                    onCheckedChange={(checked) =>
                      updateGeneralSetting("openLinksInSameTab", checked)
                    }
                    aria-label="Open links in same tab"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-foreground">Show account email</p>
                  <Switch
                    checked={generalSettings.showAccountEmail}
                    onCheckedChange={(checked) =>
                      updateGeneralSetting("showAccountEmail", checked)
                    }
                    aria-label="Show account email in header"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-foreground">Show role label</p>
                  <Switch
                    checked={generalSettings.showAccountRole}
                    onCheckedChange={(checked) =>
                      updateGeneralSetting("showAccountRole", checked)
                    }
                    aria-label="Show role label in header"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-foreground">Show mock mode badge</p>
                  <Switch
                    checked={generalSettings.showMockModeBadge}
                    onCheckedChange={(checked) =>
                      updateGeneralSetting("showMockModeBadge", checked)
                    }
                    aria-label="Show mock mode badge"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      Enable AI features
                    </p>
                    {!isAuthenticated ? (
                      <p className="text-[11px] text-muted-foreground">
                        Sign in to enable AI-assisted actions.
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    checked={
                      isAuthenticated ? generalSettings.aiFeaturesEnabled : false
                    }
                    onCheckedChange={(checked) =>
                      updateGeneralSetting("aiFeaturesEnabled", checked)
                    }
                    disabled={!isAuthenticated}
                    aria-label="Enable AI features"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-foreground">Compact titles</p>
                  <Switch
                    checked={sectionPreferences.compactTitles}
                    onCheckedChange={(checked) =>
                      updateSectionPreference("compactTitles", checked)
                    }
                    aria-label="Compact titles"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-foreground">Context lines</p>
                  <Switch
                    checked={sectionPreferences.showContextLine}
                    onCheckedChange={(checked) =>
                      updateSectionPreference("showContextLine", checked)
                    }
                    aria-label="Context lines"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-foreground">Role hints</p>
                  <Switch
                    checked={sectionPreferences.showRoleHints}
                    onCheckedChange={(checked) =>
                      updateSectionPreference("showRoleHints", checked)
                    }
                    aria-label="Role hints"
                  />
                </div>
              </div>
            </div>

            {/* Theme */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Theme
              </p>
              <div className="rounded-md border border-border/70 bg-card/50 p-3">
                <PaletteDropdown align="start">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-xs ring-offset-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="flex items-center gap-1.5 truncate font-medium text-foreground">
                      <Palette className="h-3.5 w-3.5 shrink-0 text-primary" />
                      {activeColorScheme?.name ?? "Default"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </PaletteDropdown>
                <p className="mt-2 text-xs text-muted-foreground">
                  {activeColorScheme?.description}
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteAccountDialogOpen}
        onOpenChange={(open) => {
          if (isDeletingAccount) {
            return;
          }

          setDeleteAccountDialogOpen(open);
          if (!open) {
            resetDeleteAccountDialogState();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              This permanently removes your login access. Owned content is
              disowned, and user-linked preferences/threads are removed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-border/70 bg-card/50 p-3">
              <p className="text-xs font-medium text-foreground">
                Step 1: Export your data
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Download your account export before deleting. This is required.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => void handleExportAccountData()}
                disabled={isExportingAccountData || isDeletingAccount}
              >
                {isExportingAccountData ? "Exporting..." : "Export account data"}
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Status: {hasExportedAccountData ? "Export complete" : "Not exported"}
              </p>
            </div>

            <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-medium text-foreground">
                Step 2: Confirm deletion
              </p>
              <p className="text-[11px] text-muted-foreground">
                Enter your account email and type{" "}
                <span className="font-semibold text-foreground">
                  DELETE MY ACCOUNT
                </span>{" "}
                to continue.
              </p>
              <Input
                value={deleteAccountEmailConfirm}
                onChange={(event) => setDeleteAccountEmailConfirm(event.target.value)}
                placeholder={session?.user?.email ?? "you@example.com"}
                disabled={isDeletingAccount}
                aria-label="Confirm account email for deletion"
              />
              <Input
                value={deleteAccountPhraseConfirm}
                onChange={(event) =>
                  setDeleteAccountPhraseConfirm(event.target.value)
                }
                placeholder="DELETE MY ACCOUNT"
                disabled={isDeletingAccount}
                aria-label="Confirm delete phrase"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteAccountDialogOpen(false)}
                disabled={isDeletingAccount}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDeleteAccount()}
                disabled={!canSubmitDeleteAccount}
              >
                {isDeletingAccount ? "Deleting..." : "Delete account"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Workspace / Collection Settings */}
      <Dialog
        open={workspaceSettingsOpen}
        onOpenChange={(open) => {
          setWorkspaceSettingsOpen(open);
          if (!open) {
            setConfirmDeleteWorkspace(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Collection Settings</DialogTitle>
            <DialogDescription className="sr-only">
              Rename or delete this collection.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Collection Name */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Collection Name
              </p>
              <div className="flex gap-2">
                <Input
                  value={workspaceRenameInput}
                  onChange={(e) => setWorkspaceRenameInput(e.target.value)}
                  placeholder="Collection name"
                  maxLength={80}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleRenameWorkspace();
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={
                    isWorkspaceRenaming ||
                    !workspaceRenameInput.trim() ||
                    workspaceRenameInput.trim() === activeWorkspace?.name
                  }
                  onClick={() => void handleRenameWorkspace()}
                >
                  {isWorkspaceRenaming ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>

            {/* Delete */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Delete Collection
              </p>
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs text-muted-foreground">
                  Permanently deletes this collection and all its resources. There is no going back.
                </p>
                {confirmDeleteWorkspace ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1"
                      disabled={isWorkspaceDeleting}
                      onClick={() => void handleDeleteWorkspace()}
                    >
                      {isWorkspaceDeleting ? "Deleting…" : "Confirm delete"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDeleteWorkspace(false)}
                      disabled={isWorkspaceDeleting}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirmDeleteWorkspace(true)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete Collection
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOrganizationDialogOpen}
        onOpenChange={(open) => {
          setCreateOrganizationDialogOpen(open);
          if (!open) {
            setNewOrganizationName("");
            setIsOrganizationMutating(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Organizations sit above workspaces and control the top-level rail.
              Only administrators can create them.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-organization-name">Name</Label>
            <Input
              id="new-organization-name"
              value={newOrganizationName}
              onChange={(event) => setNewOrganizationName(event.target.value)}
              placeholder="e.g. Client Portfolio"
              disabled={isOrganizationMutating}
            />
          </div>

          <Button
            type="button"
            onClick={() => void handleCreateOrganization()}
            disabled={!canSubmitOrganization}
          >
            {isOrganizationMutating ? "Creating..." : "Create Organization"}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createWorkspaceDialogOpen}
        onOpenChange={(open) => {
          setCreateWorkspaceDialogOpen(open);
          if (!open) {
            setNewWorkspaceName("");
            setIsWorkspaceMutating(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
            <DialogDescription>
              Create this workspace inside{" "}
              <strong>{organizationDisplayName}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-workspace-name">Name</Label>
            <Input
              id="new-workspace-name"
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              placeholder="e.g. Client Work"
              disabled={isWorkspaceMutating}
            />
          </div>

          <Button
            type="button"
            onClick={() => void handleCreateWorkspace()}
            disabled={!canSubmitWorkspace}
          >
            {isWorkspaceMutating ? "Creating..." : "Create Workspace"}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createCategoryDialogOpen}
        onOpenChange={(open) => {
          setCreateCategoryDialogOpen(open);
          if (!open) {
            setNewCategoryName("");
            setNewCategorySymbol("");
            setIsCategoryMutating(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Category</DialogTitle>
            <DialogDescription>
              Category will be created in{" "}
              <strong>{workspaceDisplayName}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-category-name">Name</Label>
            <Input
              id="new-category-name"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="e.g. Web Security"
              disabled={isCategoryMutating}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-category-symbol">Symbol (optional)</Label>
            <Input
              id="new-category-symbol"
              value={newCategorySymbol}
              onChange={(event) => setNewCategorySymbol(event.target.value)}
              placeholder="e.g. 🦀"
              maxLength={16}
              disabled={isCategoryMutating}
            />
          </div>

          <Button
            type="button"
            onClick={() => void handleCreateCategory()}
            disabled={!canSubmitCategory}
          >
            {isCategoryMutating ? "Creating..." : "Create Category"}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editCategoryDialogOpen}
        onOpenChange={(open) => {
          setEditCategoryDialogOpen(open);
          if (!open) {
            setEditingCategoryRecord(null);
            setEditingCategoryName("");
            setEditingCategorySymbol("");
            setIsSuggestingCategoryName(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>
              Customize this category for <strong>{workspaceDisplayName}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="edit-category-name">Name</Label>
              {canUseAiFeatures ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSuggestCategoryNameWithAi()}
                  disabled={
                    isSuggestingCategoryName ||
                    isCategoryMutating ||
                    !editingCategoryRecord
                  }
                >
                  <WandSparkles className="mr-2 h-3.5 w-3.5" />
                  {isSuggestingCategoryName ? "Analyzing..." : "Suggest with AI"}
                </Button>
              ) : null}
            </div>
            <Input
              id="edit-category-name"
              value={editingCategoryName}
              onChange={(event) => setEditingCategoryName(event.target.value)}
              placeholder="e.g. Dev Tooling"
              maxLength={80}
              disabled={isCategoryMutating || !editingCategoryRecord}
            />
            {isAuthenticated && !generalSettings.aiFeaturesEnabled ? (
              <p className="text-[11px] text-muted-foreground">
                Enable AI features in Preferences to suggest a short category
                name from links.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-category-symbol">Symbol (optional)</Label>
            <Input
              id="edit-category-symbol"
              value={editingCategorySymbol}
              onChange={(event) => setEditingCategorySymbol(event.target.value)}
              placeholder="e.g. 🦀"
              maxLength={16}
              disabled={isCategoryMutating || !editingCategoryRecord}
            />
          </div>

          <Button
            type="button"
            onClick={() => void handleSaveCategoryCustomization()}
            disabled={!canSubmitCategoryCustomization || isSuggestingCategoryName}
          >
            {isCategoryMutating ? "Saving..." : "Save Category"}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={authDialogOpen} onOpenChange={handleAuthDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {authMode === "register" ? "Create account" : "Sign in"}
            </DialogTitle>
            <DialogDescription>
              {authMode === "register"
                ? "Create credentials, then confirm your email before first sign-in."
                : "Sign in to unlock add, edit, and delete actions."}
            </DialogDescription>
          </DialogHeader>

          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={handleGitHubSignIn}
            disabled={isAuthSubmitting}
          >
            <Github className="h-4 w-4" />
            Continue with GitHub
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            or continue with email and password
          </p>
          <p className="text-center text-[11px] text-muted-foreground">
            By continuing, you agree to the{" "}
            <Link href="/terms" className="underline underline-offset-2">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </p>

          <Tabs
            value={authMode}
            onValueChange={(value) => setAuthMode(value as AuthMode)}
            className="space-y-3"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
            <TabsContent
              value="login"
              className="m-0 text-xs text-muted-foreground"
            >
              Use your existing credentials.
            </TabsContent>
            <TabsContent
              value="register"
              className="m-0 text-xs text-muted-foreground"
            >
              Create credentials for protected actions.
            </TabsContent>
          </Tabs>

          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAuthSubmit();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-email">
                {authMode === "register" ? "Email" : "Email or username"}
              </Label>
              <Input
                id="auth-email"
                type={authMode === "register" ? "email" : "text"}
                autoComplete={authMode === "register" ? "email" : "username"}
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                disabled={isAuthSubmitting}
                placeholder={
                  authMode === "register"
                    ? "you@example.com"
                    : "you@example.com or soulwax"
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete={
                  authMode === "register" ? "new-password" : "current-password"
                }
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                disabled={isAuthSubmitting}
                placeholder="At least 8 characters"
              />
            </div>

            <Button type="submit" disabled={!canSubmitAuth || isAuthSubmitting}>
              {isAuthSubmitting
                ? "Please wait..."
                : authMode === "register"
                  ? "Create account"
                  : "Sign in"}
            </Button>

            {authMode === "login" ? (
              <div className="flex flex-col items-start gap-1">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto justify-start px-0 text-xs"
                  onClick={() => void handleResendVerification()}
                  disabled={isResendingVerification || isAuthSubmitting}
                >
                  {isResendingVerification
                    ? "Resending verification..."
                    : "Resend verification email"}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto justify-start px-0 text-xs"
                  onClick={() => void handleRequestPasswordReset()}
                  disabled={isRequestingPasswordReset || isAuthSubmitting}
                >
                  {isRequestingPasswordReset
                    ? "Preparing reset link..."
                    : "Forgot password?"}
                </Button>
              </div>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>

      <AddResourceModal
        open={modalOpen}
        onOpenChange={handleModalOpenChange}
        onSave={handleSave}
        editingResource={editingResource}
        initialLink={initialLinkDraft}
        initialCategory={initialCategoryDraft}
        initialTags={initialTagsDraft}
        isSaving={isSaving}
        categorySuggestions={categories}
      />

      {globalActivityMessage ? (
        <div className="pointer-events-none fixed right-4 top-20 z-[80]">
          <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            className="flex items-center gap-2 rounded-full border border-border/80 bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>{globalActivityMessage}</span>
          </div>
        </div>
      ) : null}

      <Toaster position="bottom-right" theme="dark" />
    </div>
  );
}
