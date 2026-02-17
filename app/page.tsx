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
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  ClipboardPaste,
  FilterX,
  FolderOpen,
  FolderPlus,
  Github,
  LogIn,
  LogOut,
  Menu,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldPlus,
  Trash2,
  UserPlus,
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

interface PromoteAdminResponse extends ApiErrorResponse {
  user?: {
    id: string;
    email: string;
    isAdmin: boolean;
    isFirstAdmin: boolean;
  };
}

interface LinkMetadataResponse extends ApiErrorResponse {
  url?: string;
  label?: string;
  briefDescription?: string | null;
  tags?: string[];
  suggestedCategory?: string | null;
  source?: "perplexity" | "fallback";
}

type AuthMode = "login" | "register";
type PasteHoverTarget =
  | {
      type: "card";
      resourceId: string;
      category: string;
      workspaceId: string;
    }
  | { type: "category"; category: string | "All"; workspaceId: string };

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\}\]]+/i);
  return match?.[0] ?? null;
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [contenteditable='']",
    ),
  );
}

function mergeTags(existingTags: string[], nextTags: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const rawTag of [...existingTags, ...nextTags]) {
    const normalized = normalizeWhitespace(rawTag).slice(0, 40);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(normalized);

    if (merged.length >= 24) {
      break;
    }
  }

  return merged;
}

const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar-width";
const ACTIVE_WORKSPACE_STORAGE_KEY = "active-workspace-id";
const MOBILE_STACK_BREAKPOINT = 768;
const SIDEBAR_SNAP_GRID = 8;
const DESKTOP_SIDEBAR_DEFAULT_WIDTH = 304;
const DESKTOP_SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_KEYBOARD_STEP = SIDEBAR_SNAP_GRID;
const FALLBACK_VIEWPORT_WIDTH = 1440;

function snapSidebarWidth(width: number): number {
  return Math.round(width / SIDEBAR_SNAP_GRID) * SIDEBAR_SNAP_GRID;
}

function getDesktopSidebarMaxWidth(viewportWidth: number): number {
  return Math.max(
    DESKTOP_SIDEBAR_MIN_WIDTH,
    Math.floor(viewportWidth * 0.5 / SIDEBAR_SNAP_GRID) * SIDEBAR_SNAP_GRID,
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
  const [isLoading, setIsLoading] = useState(true);
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
  const [createWorkspaceDialogOpen, setCreateWorkspaceDialogOpen] =
    useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isWorkspaceMutating, setIsWorkspaceMutating] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategorySymbol, setNewCategorySymbol] = useState("");
  const [isCategoryMutating, setIsCategoryMutating] = useState(false);
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [promoteIdentifier, setPromoteIdentifier] = useState("");
  const [isPromotingAdmin, setIsPromotingAdmin] = useState(false);
  const [isAiPasteRunning, setIsAiPasteRunning] = useState(false);
  const [pasteHoverTarget, setPasteHoverTarget] =
    useState<PasteHoverTarget | null>(null);
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
  const canCreateWorkspaces = isAuthenticated;
  const canManageResources = isAuthenticated && canCreateResources(userRole);
  const canManageCategories = hasAdminAccess(userRole);
  const canSubmitAuth = authEmail.trim().length > 0 && authPassword.length > 0;
  const canSubmitPromote =
    promoteIdentifier.trim().length > 0 && !isPromotingAdmin;
  const canSubmitWorkspace =
    canCreateWorkspaces &&
    newWorkspaceName.trim().length > 0 &&
    !isWorkspaceMutating;
  const canSubmitCategory =
    newCategoryName.trim().length > 0 &&
    !isCategoryMutating &&
    canManageCategories &&
    Boolean(activeWorkspaceId);
  const desktopSidebarMaxWidth = getDesktopSidebarMaxWidth(getViewportWidth());
  const sessionUserId = session?.user?.id ?? null;

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

    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  }, [activeWorkspaceId, workspaces]);

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

    return resources.filter((resource) => resource.workspaceId === activeWorkspaceId);
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

  const activeCategoryCount =
    activeCategory === "All"
      ? resourcesInActiveWorkspace.length
      : (resourceCounts[activeCategory] ?? 0);
  const activeCategorySymbol =
    activeCategory === "All" ? null : (categorySymbols[activeCategory] ?? null);
  const activeSectionTitle =
    activeCategory === "All" ? "All Resources" : activeCategory;
  const isSearchActive = searchQuery.trim().length > 0;

  const totalLinks = useMemo(
    () =>
      resourcesInActiveWorkspace.reduce(
        (acc, resource) => acc + resource.links.length,
        0,
      ),
    [resourcesInActiveWorkspace],
  );
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
  const activeColorScheme =
    colorSchemes[currentSchemeIndex] ?? colorSchemes[0] ?? null;

  const fetchResources = useCallback(async () => {
    setIsLoading(true);
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
      setIsLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
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
    }
  }, []);

  const fetchWorkspaces = useCallback(async () => {
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
      if (previous && workspaces.some((workspace) => workspace.id === previous)) {
        return previous;
      }

      return workspaces[0]?.id ?? null;
    });
  }, [workspaces]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeWorkspaceId) {
      return;
    }

    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspaceId);
  }, [activeWorkspaceId]);

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
          error instanceof Error ? error.message : "Could not create workspace.",
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

  const handleUpdateCategorySymbolByName = useCallback(
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

      const nextSymbol = window.prompt(
        `Set symbol for "${categoryRecord.name}" (leave empty to clear):`,
        categoryRecord.symbol ?? "",
      );
      if (nextSymbol === null) {
        return;
      }

      setIsCategoryMutating(true);
      try {
        const response = await fetch(`/api/categories/${categoryRecord.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            symbol: nextSymbol.trim() || null,
          }),
        });
        const payload = await readJson<CategoryResponse>(response);
        if (!response.ok || !payload?.category) {
          throw new Error(payload?.error ?? "Failed to update category symbol.");
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
        toast.success("Category symbol updated", {
          description: `${updatedCategory.name} now uses ${updatedCategory.symbol || "no symbol"}.`,
        });
      } catch (error) {
        toast.error("Category symbol update failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not update category symbol.",
        });
      } finally {
        setIsCategoryMutating(false);
      }
    },
    [canManageCategories, categoryRecordByLowerName],
  );

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

  const handleUpdateActiveCategorySymbol = useCallback(async () => {
    if (activeCategory === "All") {
      return;
    }

    await handleUpdateCategorySymbolByName(activeCategory);
  }, [activeCategory, handleUpdateCategorySymbolByName]);

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

  const handlePromoteAdmin = useCallback(async () => {
    if (!isFirstAdmin || !canSubmitPromote) {
      return;
    }

    setIsPromotingAdmin(true);

    try {
      const response = await fetch("/api/auth/admins", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier: promoteIdentifier.trim(),
        }),
      });
      const payload = await readJson<PromoteAdminResponse>(response);

      if (!response.ok || !payload?.user) {
        throw new Error(payload?.error ?? "Failed to promote admin.");
      }

      setPromoteIdentifier("");
      setPromoteDialogOpen(false);
      toast.success("Admin promoted", {
        description: `${payload.user.email} can now manage resources.`,
      });
    } catch (error) {
      toast.error("Promotion failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not promote this user.",
      });
    } finally {
      setIsPromotingAdmin(false);
    }
  }, [canSubmitPromote, isFirstAdmin, promoteIdentifier]);

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

  const handleCardHoverChange = useCallback((resource: ResourceCard | null) => {
    if (!resource) {
      setPasteHoverTarget((previous) =>
        previous?.type === "card" ? null : previous,
      );
      return;
    }

    setPasteHoverTarget({
      type: "card",
      resourceId: resource.id,
      category: resource.category,
      workspaceId: resource.workspaceId,
    });
  }, []);

  const handleCategoryHoverChange = useCallback(
    (category: string | "All" | null) => {
      if (!category) {
        setPasteHoverTarget((previous) =>
          previous?.type === "category" ? null : previous,
        );
        return;
      }

      if (!activeWorkspaceId) {
        return;
      }

      setPasteHoverTarget({
        type: "category",
        category,
        workspaceId: activeWorkspaceId,
      });
    },
    [activeWorkspaceId],
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
        event.key === "ArrowRight" ? SIDEBAR_KEYBOARD_STEP : -SIDEBAR_KEYBOARD_STEP;
      setDesktopSidebarWidth((currentWidth) =>
        clampDesktopSidebarWidth(currentWidth + delta, window.innerWidth),
      );
    },
    [isDesktopSidebarEnabled],
  );

  const handlePasteIntoHoverTarget = useCallback(
    async (rawUrl: string, target: PasteHoverTarget) => {
      if (target.type === "category" && !canManageResources) {
        toast.error("Insufficient permissions", {
          description:
            "You do not have access to create resources in categories.",
        });
        return;
      }

      const currentCardTarget =
        target.type === "card"
          ? resources.find((resource) => resource.id === target.resourceId)
          : null;
      if (target.type === "card" && !currentCardTarget) {
        toast.error("Card not found", {
          description: "The hovered card no longer exists.",
        });
        return;
      }
      if (target.type === "card" && !canManageResourceCard(currentCardTarget)) {
        toast.error("Insufficient permissions", {
          description: "You can only paste links into cards that you own.",
        });
        return;
      }

      if (isSaving || isAiPasteRunning) {
        return;
      }

      setIsAiPasteRunning(true);

      try {
        const metadataResponse = await fetch("/api/ai/link-metadata", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: rawUrl,
            contextCategory: target.category,
          }),
        });
        const metadataPayload =
          await readJson<LinkMetadataResponse>(metadataResponse);

        if (!metadataResponse.ok || !metadataPayload?.url) {
          throw new Error(
            metadataPayload?.error ?? "Failed to generate link metadata.",
          );
        }

        const url = metadataPayload.url;
        const label = normalizeWhitespace(metadataPayload.label ?? "").slice(
          0,
          120,
        );
        const briefDescription = normalizeWhitespace(
          metadataPayload.briefDescription ?? "",
        ).slice(0, 280);
        const aiTags = mergeTags([], metadataPayload.tags ?? []);
        const linkInput = {
          url,
          label: label || url,
          note: briefDescription || undefined,
        };

        if (target.type === "card" && currentCardTarget) {
          const currentResource = currentCardTarget;

          const alreadyHasLink = currentResource.links.some(
            (link) => link.url.toLowerCase() === url.toLowerCase(),
          );
          if (alreadyHasLink) {
            toast.message("Link already exists in this card.");
            return;
          }

          const nextInput: ResourceInput = {
            workspaceId: currentResource.workspaceId,
            category: currentResource.category,
            tags: mergeTags(currentResource.tags ?? [], aiTags),
            links: [...currentResource.links, linkInput].map((link) => ({
              url: link.url,
              label: link.label,
              note: link.note ?? undefined,
            })),
          };

          const saveResponse = await fetch(
            `/api/resources/${currentResource.id}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(nextInput),
            },
          );
          const savePayload = await readJson<ResourceResponse>(saveResponse);

          if (!saveResponse.ok || !savePayload?.resource) {
            throw new Error(savePayload?.error ?? "Failed to update card.");
          }

          const savedResource = savePayload.resource;
          if (savePayload.mode) {
            setDataMode(savePayload.mode);
          }

          setResources((previous) =>
            previous.map((resource) =>
              resource.id === savedResource.id ? savedResource : resource,
            ),
          );

          toast.success("Link pasted into card", {
            description: `${linkInput.label} added to ${currentResource.category}.`,
          });
        } else {
          const targetCategory =
            target.category !== "All"
              ? target.category
              : normalizeWhitespace(
                  metadataPayload.suggestedCategory ||
                    activeCategory ||
                    "General",
                );

          const createInput: ResourceInput = {
            workspaceId: target.workspaceId,
            category: targetCategory,
            tags: aiTags,
            links: [linkInput],
          };

          const saveResponse = await fetch("/api/resources", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(createInput),
          });
          const savePayload = await readJson<ResourceResponse>(saveResponse);

          if (!saveResponse.ok || !savePayload?.resource) {
            throw new Error(savePayload?.error ?? "Failed to create resource.");
          }

          const savedResource = savePayload.resource;
          if (savePayload.mode) {
            setDataMode(savePayload.mode);
          }

          setResources((previous) => [savedResource, ...previous]);

          toast.success("Link pasted into category", {
            description: `${linkInput.label} added under ${targetCategory}.`,
          });
        }

        if (metadataPayload.source === "fallback") {
          toast.message("AI fallback used", {
            description:
              "Perplexity response was unavailable, so basic metadata was used.",
          });
        }

        void fetchCategories();
      } catch (error) {
        toast.error("Paste failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not paste this URL.",
        });
      } finally {
        setIsAiPasteRunning(false);
      }
    },
    [
      activeCategory,
      canManageResourceCard,
      canManageResources,
      fetchCategories,
      isAiPasteRunning,
      isSaving,
      resources,
    ],
  );

  const readFirstUrlFromClipboard = useCallback(async (): Promise<string> => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      throw new Error("Clipboard access is unavailable in this browser.");
    }

    const text = await navigator.clipboard.readText();
    const url = extractFirstUrl(text);
    if (!url) {
      throw new Error("Clipboard does not contain a valid URL.");
    }

    return url;
  }, []);

  const handlePasteFromClipboardToTarget = useCallback(
    async (target: PasteHoverTarget) => {
      if (target.type === "category" && !canManageResources) {
        toast.error("Insufficient permissions", {
          description:
            "You do not have access to create resources in categories.",
        });
        return;
      }

      if (target.type === "card") {
        const currentResource = resources.find(
          (resource) => resource.id === target.resourceId,
        );
        if (!currentResource || !canManageResourceCard(currentResource)) {
          toast.error("Insufficient permissions", {
            description: "You can only paste links into cards that you own.",
          });
          return;
        }
      }

      try {
        const url = await readFirstUrlFromClipboard();
        await handlePasteIntoHoverTarget(url, target);
      } catch (error) {
        toast.error("Clipboard paste failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not read a URL from your clipboard.",
        });
      }
    },
    [
      canManageResourceCard,
      canManageResources,
      handlePasteIntoHoverTarget,
      readFirstUrlFromClipboard,
      resources,
    ],
  );

  const handlePasteIntoCardFromClipboard = useCallback(
    (resource: ResourceCard) => {
      void handlePasteFromClipboardToTarget({
        type: "card",
        resourceId: resource.id,
        category: resource.category,
        workspaceId: resource.workspaceId,
      });
    },
    [handlePasteFromClipboardToTarget],
  );

  const handlePasteIntoCategoryFromClipboard = useCallback(
    (category: string | "All") => {
      if (!activeWorkspaceId) {
        toast.error("Workspace unavailable", {
          description: "Select a workspace first.",
        });
        return;
      }

      void handlePasteFromClipboardToTarget({
        type: "category",
        category,
        workspaceId: activeWorkspaceId,
      });
    },
    [activeWorkspaceId, handlePasteFromClipboardToTarget],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleWindowPaste = (event: ClipboardEvent) => {
      if (!pasteHoverTarget || isEditablePasteTarget(event.target)) {
        return;
      }

      const text = event.clipboardData?.getData("text/plain") ?? "";
      const pastedUrl = extractFirstUrl(text);
      if (!pastedUrl) {
        return;
      }

      event.preventDefault();
      void handlePasteIntoHoverTarget(pastedUrl, pasteHoverTarget);
    };

    window.addEventListener("paste", handleWindowPaste);
    return () => {
      window.removeEventListener("paste", handleWindowPaste);
    };
  }, [handlePasteIntoHoverTarget, pasteHoverTarget]);

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
    if (!canCreateWorkspaces) {
      toast.error("Authentication required", {
        description: "Sign in to create personal workspaces.",
      });
      return;
    }

    setCreateWorkspaceDialogOpen(true);
  }, [canCreateWorkspaces]);

  const handleRefreshLibrary = useCallback(() => {
    void Promise.all([fetchResources(), fetchCategories(), fetchWorkspaces()]);
  }, [fetchCategories, fetchResources, fetchWorkspaces]);

  const handleModalOpenChange = useCallback((open: boolean) => {
    setModalOpen(open);
    if (!open) {
      setEditingResource(null);
    }
  }, []);

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
            {isAuthenticated && session?.user?.email ? (
              <span className="inline-flex max-w-56 flex-col rounded-xl border border-border bg-secondary px-2.5 py-1 leading-tight text-secondary-foreground">
                <span className="truncate text-[11px] font-medium">
                  {session.user.email}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {roleLabel}
                </span>
              </span>
            ) : null}
            <div className="inline-flex flex-col rounded-xl border border-border bg-secondary/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <span>{resourcesInActiveWorkspace.length} cards</span>
              <span>{totalLinks} links</span>
              <span className="max-w-40 truncate">
                {activeWorkspace?.name ?? "Main Workspace"}
              </span>
              {dataMode === "mock" ? (
                <span className="text-[10px] uppercase tracking-wide text-amber-600">
                  mock mode
                </span>
              ) : null}
            </div>
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
          {canManageResources ? (
            <div className="hidden max-w-64 items-center truncate rounded-full border border-border bg-secondary/40 px-3 py-1 text-[11px] text-muted-foreground xl:flex">
              {isAiPasteRunning
                ? "Pasting link with AI..."
                : pasteHoverTarget?.type === "card"
                  ? "Ctrl+V into hovered card"
                  : pasteHoverTarget?.type === "category"
                    ? `Ctrl+V into category: ${pasteHoverTarget.category}`
                    : "Hover a card/category, then press Ctrl+V"}
            </div>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Palette className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Palette</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Color Scheme
                </p>
                <p className="text-xs text-muted-foreground">
                  Popular palettes used in major dev tools. Saved for{" "}
                  {isAuthenticated ? "your account" : "this visitor"}.
                </p>
              </div>

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
            </PopoverContent>
          </Popover>

          {sessionStatus === "loading" ? (
            <span className="text-xs text-muted-foreground">
              Checking auth...
            </span>
          ) : isAuthenticated ? (
            <>
              {isFirstAdmin ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPromoteDialogOpen(true)}
                >
                  <ShieldPlus className="h-4 w-4" />
                  <span className="ml-2 hidden sm:inline">Promote Admin</span>
                </Button>
              ) : null}
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
                  onClick={() => void handleUpdateActiveCategorySymbol()}
                  disabled={isCategoryMutating}
                >
                  <span className="hidden sm:inline">
                    {activeCategoryRecord.symbol ? "Edit Symbol" : "Set Symbol"}
                  </span>
                  <span className="sm:hidden">Symbol</span>
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
                  disabled={isLoading || Boolean(loadError) || !activeWorkspaceId}
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
          className="hidden w-20 shrink-0 border-r border-border bg-card md:block"
          aria-label="Workspace navigation"
        >
          <WorkspaceRail
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onWorkspaceChange={(workspaceId) => {
              setActiveWorkspaceId(workspaceId);
              setActiveCategory("All");
            }}
            canCreateWorkspace={canCreateWorkspaces}
            onCreateWorkspace={handleOpenCreateWorkspaceDialog}
            resourceCountsByWorkspace={workspaceResourceCounts}
          />
        </aside>

        <aside
          className={`group/sidebar relative hidden shrink-0 border-r border-border bg-card md:block ${
            isSidebarResizing ? "" : "transition-[width] duration-200 ease-in-out"
          }`}
          style={{ width: `${desktopSidebarWidth}px` }}
          aria-label="Category navigation"
        >
          <CategorySidebar
            categories={categories}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            onHoverCategoryChange={handleCategoryHoverChange}
            resourceCounts={resourceCounts}
            categorySymbols={categorySymbols}
            canManageCategories={canManageCategories}
            canPasteIntoCategory={canManageResources && Boolean(activeWorkspaceId)}
            onCreateCategory={handleOpenCreateCategoryDialog}
            onEditCategorySymbol={(category) => {
              void handleUpdateCategorySymbolByName(category);
            }}
            onDeleteCategory={(category) => {
              void handleDeleteCategoryByName(category);
            }}
            onPasteIntoCategory={handlePasteIntoCategoryFromClipboard}
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
              <SheetTitle className="w-fit section-title-pill">
                Categories
              </SheetTitle>
              <SheetDescription className="sr-only">
                Filter resources by category
              </SheetDescription>
            </SheetHeader>
            <CategorySidebar
              categories={categories}
              activeCategory={activeCategory}
              onCategoryChange={(category) => {
                setActiveCategory(category);
                setSidebarOpen(false);
              }}
              onHoverCategoryChange={handleCategoryHoverChange}
              resourceCounts={resourceCounts}
              categorySymbols={categorySymbols}
              canManageCategories={canManageCategories}
              canPasteIntoCategory={
                canManageResources && Boolean(activeWorkspaceId)
              }
              onCreateCategory={handleOpenCreateCategoryDialog}
              onEditCategorySymbol={(category) => {
                void handleUpdateCategorySymbolByName(category);
              }}
              onDeleteCategory={(category) => {
                void handleDeleteCategoryByName(category);
              }}
              onPasteIntoCategory={handlePasteIntoCategoryFromClipboard}
            />
          </SheetContent>
        </Sheet>

        <ContextMenu>
          <ContextMenuTrigger asChild>
            <main
              className="flex-1 overflow-y-auto p-4 lg:p-6"
              aria-label="Resource cards"
            >
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-4">
                <div className="space-y-2">
                  <p className="section-title-pill">
                    <FolderOpen className="h-3.5 w-3.5 text-primary" />
                    {activeCategory === "All" ? "Library" : "Category"}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">
                    Workspace: {activeWorkspace?.name ?? "Main Workspace"}
                  </p>
                  <h2 className="section-title-heading text-xl sm:text-2xl">
                    {activeCategorySymbol ? `${activeCategorySymbol} ` : ""}
                    {activeSectionTitle}
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  {activeCategoryCount} resource
                  {activeCategoryCount === 1 ? "" : "s"}
                  {isSearchActive
                    ? ` total, ${filteredResources.length} shown`
                    : ""}
                </p>
              </div>
              {isLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <p className="text-sm text-muted-foreground">
                    Loading resources...
                  </p>
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                  <h2 className="text-lg font-semibold text-foreground">
                    Unable to load resources
                  </h2>
                  <p className="max-w-xl text-sm text-muted-foreground">
                    {loadError}
                  </p>
                  <Button onClick={() => void fetchResources()} size="sm">
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
                        : canManageResources
                          ? "Add your first resource to get started!"
                          : isAuthenticated
                            ? "You are signed in as read-only. Ask FirstAdmin for editor or admin access."
                            : "Sign in to manage categories and resources based on your role."}
                    </p>
                  </div>
                  {!searchQuery && canManageResources ? (
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
                      onPasteLinkIntoCard={handlePasteIntoCardFromClipboard}
                      onHoverChange={handleCardHoverChange}
                      isDeleting={deletingResourceId === resource.id}
                      canManage={canManageResourceCard(resource)}
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
                  disabled={isLoading || Boolean(loadError) || !activeWorkspaceId}
                  onSelect={handleOpenCreateResourceModal}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add resource card
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() =>
                    handlePasteIntoCategoryFromClipboard(activeCategory)
                  }
                >
                  <ClipboardPaste className="mr-2 h-4 w-4" />
                  Paste URL into{" "}
                  {activeCategory === "All"
                    ? "a suggested category"
                    : activeCategory}
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
              Workspaces are personal spaces for organizing categories and cards.
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
              <strong>{activeWorkspace?.name ?? "Main Workspace"}</strong>.
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

      <Dialog
        open={promoteDialogOpen}
        onOpenChange={(open) => {
          setPromoteDialogOpen(open);
          if (!open) {
            setPromoteIdentifier("");
            setIsPromotingAdmin(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Promote Admin</DialogTitle>
            <DialogDescription>
              FirstAdmin can grant admin access to existing users.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="promote-identifier">Email or username</Label>
            <Input
              id="promote-identifier"
              value={promoteIdentifier}
              onChange={(event) => setPromoteIdentifier(event.target.value)}
              placeholder="user@example.com"
              disabled={isPromotingAdmin}
            />
            <p className="text-xs text-muted-foreground">
              User must have signed in at least once.
            </p>
          </div>

          <Button
            type="button"
            onClick={() => void handlePromoteAdmin()}
            disabled={!canSubmitPromote || !isFirstAdmin}
          >
            {isPromotingAdmin ? "Promoting..." : "Promote to Admin"}
          </Button>
        </DialogContent>
      </Dialog>

      <AddResourceModal
        open={modalOpen}
        onOpenChange={handleModalOpenChange}
        onSave={handleSave}
        editingResource={editingResource}
        isSaving={isSaving}
        categorySuggestions={categories}
      />

      <Toaster position="bottom-right" theme="dark" />
    </div>
  );
}
