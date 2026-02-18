"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  normalizeDraftCategory,
  normalizeDraftLabel,
  normalizeDraftNote,
  normalizeDraftTags,
  normalizeHttpUrl,
  type PastedLinkDraft,
} from "@/lib/link-paste";
import { cn } from "@/lib/utils";
import type {
  ResourceCard,
  ResourceCategory,
  ResourceInput,
  ResourceWorkspace,
} from "@/lib/resources";
import { AddResourceModal } from "@/components/add-resource-modal";
import { CategorySidebar } from "@/components/category-sidebar";
import { useColorScheme } from "@/components/color-scheme-provider";
import { ResourceCardItem } from "@/components/resource-card";
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
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
  UserPlus,
  WandSparkles,
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

interface ListResourcesResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  resources?: ResourceCard[];
}

interface ListCategoriesResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  categories?: ResourceCategory[];
}

interface ListWorkspacesResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  workspaces?: ResourceWorkspace[];
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
}

interface AskLibraryResponse extends ApiErrorResponse {
  question?: string;
  answer?: string;
  citations?: AskLibraryCitation[];
  reasoning?: AskLibraryReasoning;
  usedAi?: boolean;
  model?: string | null;
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

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar-width";
const ACTIVE_WORKSPACE_STORAGE_KEY = "active-workspace-id";
const MOBILE_STACK_BREAKPOINT = 768;
const SIDEBAR_SNAP_GRID = 8;
const DESKTOP_SIDEBAR_DEFAULT_WIDTH = 304;
const DESKTOP_SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_KEYBOARD_STEP = SIDEBAR_SNAP_GRID;
const FALLBACK_VIEWPORT_WIDTH = 1440;
const SECTION_PREFERENCES_STORAGE_KEY = "section-preferences";
const GENERAL_SETTINGS_STORAGE_KEY = "general-settings-preferences";
const ASK_LIBRARY_HISTORY_LIMIT = 8;
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

function createAskLibraryTurnId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
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

export default function Page() {
  const { data: session, status: sessionStatus } = useSession();
  const [resources, setResources] = useState<ResourceCard[]>([]);
  const [workspaces, setWorkspaces] = useState<ResourceWorkspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null,
  );
  const [categoryRecords, setCategoryRecords] = useState<ResourceCategory[]>(
    [],
  );
  const [activeCategory, setActiveCategory] = useState<string | "All">("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [askLibraryOpen, setAskLibraryOpen] = useState(false);
  const [askLibraryQuery, setAskLibraryQuery] = useState("");
  const [askLibraryAnswer, setAskLibraryAnswer] = useState<string | null>(null);
  const [askLibraryCitations, setAskLibraryCitations] = useState<
    AskLibraryCitation[]
  >([]);
  const [askLibraryReasoning, setAskLibraryReasoning] =
    useState<AskLibraryReasoning | null>(null);
  const [askLibraryConversation, setAskLibraryConversation] = useState<
    AskLibraryConversationTurn[]
  >([]);
  const [askLibraryUsedAi, setAskLibraryUsedAi] = useState(false);
  const [askLibraryModel, setAskLibraryModel] = useState<string | null>(null);
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
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const hasLoadedSidebarWidthRef = useRef(false);
  const resizeRafIdRef = useRef<number | null>(null);
  const pendingSidebarWidthRef = useRef<number | null>(null);
  const [editingResource, setEditingResource] = useState<ResourceCard | null>(
    null,
  );
  const [isResourcesLoading, setIsResourcesLoading] = useState(true);
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(true);
  const [isWorkspacesLoading, setIsWorkspacesLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingResourceId, setDeletingResourceId] = useState<string | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<"database" | "mock">("mock");
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
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
  const {
    schemes: colorSchemes,
    currentSchemeIndex,
    isLoading: isLoadingColorScheme,
    isSaving: isSavingColorScheme,
    setColorSchemeByIndex,
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
  const canCreateWorkspaces = isAuthenticated && ownedWorkspaceCount < 1;
  const canManageResources = isAuthenticated && canCreateResources(userRole);
  const canManageCategories = hasAdminAccess(userRole);
  const canSubmitAuth = authEmail.trim().length > 0 && authPassword.length > 0;
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
  const globalActivityMessage = useMemo(() => {
    if (isPasteFlowInProgress) {
      return "Processing pasted URL...";
    }
    if (isRefreshingLibrary) {
      return "Refreshing library...";
    }
    if (isAskingLibrary) {
      return "Analyzing your library...";
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
    isAiPastePreferenceSaving,
    isAskingLibrary,
    isAuthSubmitting,
    isCategoryMutating,
    isPasteFlowInProgress,
    isRefreshingLibrary,
    isResendingVerification,
    isSaving,
    isSavingColorScheme,
    isSuggestingCategoryName,
    isWorkspaceDeleting,
    isWorkspaceMutating,
    isWorkspaceRenaming,
  ]);
  const desktopSidebarMaxWidth = getDesktopSidebarMaxWidth(getViewportWidth());
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
    [buildLinkDraftForPaste],
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

  const activeWorkspace = useMemo(() => {
    if (!activeWorkspaceId) {
      return null;
    }

    return (
      workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    );
  }, [activeWorkspaceId, workspaces]);
  const hasActiveWorkspace = Boolean(activeWorkspaceId);

  const workspaceResourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const resource of resources) {
      counts[resource.workspaceId] = (counts[resource.workspaceId] ?? 0) + 1;
    }
    return counts;
  }, [resources]);

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
  const isWorkspaceSelectionPending =
    isWorkspacesLoading && !activeWorkspaceId && workspaces.length === 0;
  const showResourceSkeleton =
    !loadError &&
    filteredResources.length === 0 &&
    (isResourcesLoading || isWorkspaceSelectionPending);
  const showResourceLoadError =
    Boolean(loadError) && !isResourcesLoading && resources.length === 0;
  const isResourceActionDisabled = isResourcesLoading || !activeWorkspaceId;

  const activeCategoryCount =
    activeCategory === "All"
      ? resourcesInActiveWorkspace.length
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
  const workspaceDisplayName = activeWorkspace?.name
    ? activeWorkspace.name
    : isAuthenticated
      ? "No Workspace"
      : "Main Workspace";
  const sidebarHeadingLabel = sectionPreferences.compactTitles
    ? "Explorer"
    : "Category Explorer";
  const sidebarHeadingMeta = sectionPreferences.showContextLine
    ? `${workspaceDisplayName} / ${categories.length} categories`
    : undefined;
  const mainSectionPillLabel = isSearchActive
    ? "Search Results"
    : activeCategory === "All"
      ? "Resource Library"
      : "Category Focus";
  const mainSectionMetaLine = sectionPreferences.showContextLine
    ? `Workspace: ${workspaceDisplayName}`
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

  const activeColorScheme =
    colorSchemes[currentSchemeIndex] ?? colorSchemes[0] ?? null;

  const fetchResources = useCallback(async () => {
    setIsResourcesLoading(true);
    setLoadError(null);

    try {
      const response = await fetch("/api/resources", {
        cache: "no-store",
      });
      const payload = await readJson<ListResourcesResponse>(response);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load resources.");
      }

      setResources(payload?.resources ?? []);
      setDataMode(payload?.mode === "database" ? "database" : "mock");
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to load resources. Check the database setup and retry.",
      );
    } finally {
      setIsResourcesLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    setIsCategoriesLoading(true);
    try {
      const response = await fetch("/api/categories", {
        cache: "no-store",
      });
      const payload = await readJson<ListCategoriesResponse>(response);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load categories.");
      }

      setCategoryRecords(payload?.categories ?? []);
      if (payload?.mode) {
        setDataMode(payload.mode);
      }
    } catch (error) {
      console.error(
        "Failed to fetch categories:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      setIsCategoriesLoading(false);
    }
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    setIsWorkspacesLoading(true);
    try {
      const response = await fetch("/api/workspaces", {
        cache: "no-store",
      });
      const payload = await readJson<ListWorkspacesResponse>(response);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load workspaces.");
      }

      setWorkspaces(payload?.workspaces ?? []);
      if (payload?.mode) {
        setDataMode(payload.mode);
      }
    } catch (error) {
      console.error(
        "Failed to fetch workspaces:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      setIsWorkspacesLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([fetchResources(), fetchCategories(), fetchWorkspaces()]);
  }, [fetchCategories, fetchResources, fetchWorkspaces, sessionUserId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedWorkspaceId = window.localStorage.getItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
    );
    if (savedWorkspaceId) {
      setActiveWorkspaceId(savedWorkspaceId);
    }
  }, []);

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
    if (typeof window === "undefined" || !activeWorkspaceId) {
      return;
    }

    window.localStorage.setItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
      activeWorkspaceId,
    );
  }, [activeWorkspaceId]);

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
    if (activeCategory !== "All" && !categories.includes(activeCategory)) {
      setActiveCategory("All");
    }
  }, [activeCategory, categories]);

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

  const handleColorSchemePreview = useCallback(
    (value: number[]) => {
      const index = value[0];
      if (typeof index !== "number") {
        return;
      }

      void setColorSchemeByIndex(index, { persist: false });
    },
    [setColorSchemeByIndex],
  );

  const handleColorSchemeCommit = useCallback(
    (value: number[]) => {
      const index = value[0];
      if (typeof index !== "number") {
        return;
      }

      void (async () => {
        const saved = await setColorSchemeByIndex(index, { persist: true });
        if (!saved) {
          toast.error("Color scheme not saved", {
            description:
              "Preview applied locally, but we could not persist your preference.",
          });
        }
      })();
    },
    [setColorSchemeByIndex],
  );

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
      setNewWorkspaceName("");
      setCreateWorkspaceDialogOpen(false);
      void fetchWorkspaces();

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
  }, [canSubmitWorkspace, fetchWorkspaces, newWorkspaceName]);

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
      setActiveWorkspaceId(null);
      setWorkspaceSettingsOpen(false);
      toast.success("Collection deleted");
    } catch {
      toast.error("Failed to delete collection");
    } finally {
      setIsWorkspaceDeleting(false);
    }
  }, [activeWorkspace, session?.user?.id]);

  const handleRefreshLibrary = useCallback(() => {
    if (isRefreshingLibrary) {
      return;
    }

    setIsRefreshingLibrary(true);
    void (async () => {
      try {
        await Promise.all([fetchResources(), fetchCategories(), fetchWorkspaces()]);
      } finally {
        setIsRefreshingLibrary(false);
      }
    })();
  }, [
    fetchCategories,
    fetchResources,
    fetchWorkspaces,
    isRefreshingLibrary,
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

  const handleAskLibraryOpen = useCallback(() => {
    if (!askLibraryQuery.trim() && searchQuery.trim()) {
      setAskLibraryQuery(searchQuery.trim());
    }
    setAskLibraryOpen(true);
  }, [askLibraryQuery, searchQuery]);

  const handleAskLibraryReset = useCallback(() => {
    setAskLibraryConversation([]);
    setAskLibraryAnswer(null);
    setAskLibraryCitations([]);
    setAskLibraryReasoning(null);
    setAskLibraryUsedAi(false);
    setAskLibraryModel(null);
    setAskLibraryQuery(searchQuery.trim());
  }, [searchQuery]);

  const handleAskLibrarySubmit = useCallback(async () => {
    const question = askLibraryQuery.trim();
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
          workspaceId: activeWorkspaceId,
          category: activeCategory === "All" ? null : activeCategory,
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
      setAskLibraryUsedAi(payload.usedAi === true);
      setAskLibraryModel(payload.model ?? null);
      setAskLibraryConversation((previous) => {
        const next: AskLibraryConversationTurn[] = [
          ...previous,
          {
            id: createAskLibraryTurnId(),
            role: "user",
            content: question,
          },
          {
            id: createAskLibraryTurnId(),
            role: "assistant",
            content: payload.answer ?? "",
            usedAi: payload.usedAi === true,
            model: payload.model ?? null,
            citations: payload.citations ?? [],
            reasoning: payload.reasoning ?? null,
          },
        ];

        return next.slice(-(ASK_LIBRARY_HISTORY_LIMIT * 2));
      });
      setAskLibraryQuery("");
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
  }, [
    activeCategory,
    activeWorkspaceId,
    askLibraryConversation,
    askLibraryQuery,
    canUseAiFeatures,
  ]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3 lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open workspace and category menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="hidden items-center gap-2.5 sm:flex">
            <h1 className="text-base font-semibold leading-tight text-foreground">
              BlueSix
            </h1>
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

        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search resources..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
            aria-label="Search resources"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
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
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-medium text-foreground">
                        {activeColorScheme?.name ?? "Default"}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {currentSchemeIndex + 1}/{colorSchemes.length}
                      </span>
                    </div>

                    <Slider
                      value={[currentSchemeIndex]}
                      min={0}
                      max={Math.max(0, colorSchemes.length - 1)}
                      step={1}
                      onValueChange={handleColorSchemePreview}
                      onValueCommit={handleColorSchemeCommit}
                      aria-label="Color scheme selector"
                    />

                    <p className="mt-2 text-xs text-muted-foreground">
                      {activeColorScheme?.description}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {isSavingColorScheme
                        ? "Saving preference..."
                        : isLoadingColorScheme
                          ? "Loading preference..."
                          : "Preference synced with database."}
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
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className="hidden w-14 shrink-0 border-r border-border bg-card md:block"
          aria-label="Workspace navigation"
        >
          <WorkspaceRail
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            isLoading={isWorkspacesLoading}
            onWorkspaceChange={(workspaceId) => {
              setActiveWorkspaceId(workspaceId);
              setActiveCategory("All");
            }}
            canCreateWorkspace={canCreateWorkspaces}
            onCreateWorkspace={handleOpenCreateWorkspaceDialog}
            showSettingsButton
            onOpenSettings={() => setGeneralSettingsOpen(true)}
            resourceCountsByWorkspace={workspaceResourceCounts}
          />
        </aside>

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

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <div className="border-b border-border/70 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Workspaces
              </p>
              <div className="mt-2">
                <WorkspaceRail
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  orientation="horizontal"
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
                  ? `Filter categories in ${workspaceDisplayName}`
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
              showHeading={false}
            />
          </SheetContent>
        </Sheet>

        <ContextMenu onOpenChange={handleLibraryContextMenuOpenChange}>
          <ContextMenuTrigger asChild>
            <main
              className="flex-1 overflow-y-auto p-4 lg:p-6"
              aria-label="Resource cards"
            >
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
              {showResourceSkeleton ? (
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
                        ? `Nothing matches "${searchQuery}". Try a different search.`
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
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {filteredResources.map((resource) => (
                    <ResourceCardItem
                      key={resource.id}
                      resource={resource}
                      categorySymbol={categorySymbols[resource.category]}
                      onDelete={handleDelete}
                      onEdit={handleEdit}
                      canEditCategory={canEditCategoryByName(resource.category)}
                      onEditCategory={handleOpenEditCategoryDialogByName}
                      isDeleting={deletingResourceId === resource.id}
                      canManage={canManageResourceCard(resource)}
                      openLinksInSameTab={generalSettings.openLinksInSameTab}
                    />
                  ))}
                </div>
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
        open={askLibraryOpen}
        onOpenChange={(open) => {
          setAskLibraryOpen(open);
          if (!open) {
            setIsAskingLibrary(false);
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

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleAskLibraryReset}
                disabled={isAskingLibrary || askLibraryConversation.length === 0}
              >
                New thread
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAskLibraryOpen(false)}
                  disabled={isAskingLibrary}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleAskLibrarySubmit();
                  }}
                  disabled={isAskingLibrary || askLibraryQuery.trim().length < 2}
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
                    >
                      <LogOut className="mr-2 h-3.5 w-3.5" />
                      Log out
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
                <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <Palette className="h-3.5 w-3.5 text-primary" />
                    {activeColorScheme?.name ?? "Default"}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {currentSchemeIndex + 1}/{colorSchemes.length}
                  </span>
                </div>
                <Slider
                  value={[currentSchemeIndex]}
                  min={0}
                  max={Math.max(0, colorSchemes.length - 1)}
                  step={1}
                  onValueChange={handleColorSchemePreview}
                  onValueCommit={handleColorSchemeCommit}
                  aria-label="Color scheme selector"
                />
              </div>
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
              Each account gets one personal workspace for organizing cards and
              categories.
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
