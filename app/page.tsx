"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

import type {
  ResourceCard,
  ResourceCategory,
  ResourceInput,
} from "@/lib/resources";
import { AddResourceModal } from "@/components/add-resource-modal";
import { CategorySidebar } from "@/components/category-sidebar";
import { useColorScheme } from "@/components/color-scheme-provider";
import { ResourceCardItem } from "@/components/resource-card";
import { Button } from "@/components/ui/button";
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
  FolderOpen,
  FolderPlus,
  Github,
  LogIn,
  LogOut,
  Menu,
  Palette,
  Plus,
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

interface CategoryResponse extends ApiErrorResponse {
  mode?: "database" | "mock";
  category?: ResourceCategory;
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
  | { type: "card"; resourceId: string; category: string }
  | { type: "category"; category: string | "All" };

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

const DESKTOP_SIDEBAR_DEFAULT_WIDTH = 240;
const DESKTOP_SIDEBAR_MIN_WIDTH = 196;
const DESKTOP_SIDEBAR_MAX_WIDTH = 420;

function clampDesktopSidebarWidth(width: number): number {
  return Math.min(
    DESKTOP_SIDEBAR_MAX_WIDTH,
    Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, width),
  );
}

export default function Page() {
  const { data: session, status: sessionStatus } = useSession();
  const [resources, setResources] = useState<ResourceCard[]>([]);
  const [categoryRecords, setCategoryRecords] = useState<ResourceCategory[]>(
    [],
  );
  const [activeCategory, setActiveCategory] = useState<string | "All">("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarWidth, setDesktopSidebarWidth] = useState<number>(
    DESKTOP_SIDEBAR_DEFAULT_WIDTH,
  );
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
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
  const roleLabel = isFirstAdmin ? "FirstAdmin" : isAdmin ? "Admin" : "Viewer";
  const canManageResources = isAdmin;
  const canSubmitAuth = authEmail.trim().length > 0 && authPassword.length > 0;
  const canSubmitPromote =
    promoteIdentifier.trim().length > 0 && !isPromotingAdmin;
  const canSubmitCategory =
    newCategoryName.trim().length > 0 &&
    !isCategoryMutating &&
    canManageResources;

  const resourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const resource of resources) {
      counts[resource.category] = (counts[resource.category] ?? 0) + 1;
    }

    return counts;
  }, [resources]);

  const categories = useMemo(() => {
    const uniqueByKey = new Map<string, string>();

    for (const categoryRecord of categoryRecords) {
      const normalized = categoryRecord.name.trim();
      if (!normalized) {
        continue;
      }

      uniqueByKey.set(normalized.toLowerCase(), normalized);
    }

    for (const resource of resources) {
      const normalized = resource.category.trim();
      if (!normalized) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (!uniqueByKey.has(key)) {
        uniqueByKey.set(key, normalized);
      }
      uniqueByKey.set(normalized.toLowerCase(), normalized);
    }

    return [...uniqueByKey.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [categoryRecords, resources]);

  const categorySymbols = useMemo(() => {
    const next: Record<string, string | undefined> = {};
    for (const category of categoryRecords) {
      const normalized = category.name.trim();
      if (!normalized) {
        continue;
      }

      const symbol = category.symbol?.trim();
      next[normalized] = symbol || undefined;
    }
    return next;
  }, [categoryRecords]);

  const filteredResources = useMemo(() => {
    let result = resources;

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
  }, [resources, activeCategory, searchQuery]);

  const totalLinks = useMemo(
    () => resources.reduce((acc, resource) => acc + resource.links.length, 0),
    [resources],
  );
  const activeCategoryRecord = useMemo(() => {
    if (activeCategory === "All") {
      return null;
    }

    return (
      categoryRecords.find((category) => category.name === activeCategory) ??
      null
    );
  }, [activeCategory, categoryRecords]);
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

  useEffect(() => {
    void Promise.all([fetchResources(), fetchCategories()]);
  }, [fetchCategories, fetchResources]);

  useEffect(() => {
    if (activeCategory !== "All" && !categories.includes(activeCategory)) {
      setActiveCategory("All");
    }
  }, [activeCategory, categories]);

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

  const handleCreateCategory = useCallback(async () => {
    if (!canSubmitCategory) {
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
  }, [canSubmitCategory, fetchCategories, newCategoryName, newCategorySymbol]);

  const handleUpdateActiveCategorySymbol = useCallback(async () => {
    if (
      !canManageResources ||
      !activeCategoryRecord ||
      activeCategory === "All"
    ) {
      return;
    }

    const nextSymbol = window.prompt(
      `Set symbol for "${activeCategoryRecord.name}" (leave empty to clear):`,
      activeCategoryRecord.symbol ?? "",
    );
    if (nextSymbol === null) {
      return;
    }

    setIsCategoryMutating(true);
    try {
      const response = await fetch(
        `/api/categories/${activeCategoryRecord.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            symbol: nextSymbol.trim() || null,
          }),
        },
      );
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
  }, [activeCategory, activeCategoryRecord, canManageResources]);

  const handleDeleteActiveCategory = useCallback(async () => {
    if (
      !canManageResources ||
      !activeCategoryRecord ||
      activeCategory === "All"
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Delete category "${activeCategoryRecord.name}"? Resources in this category will be reassigned.`,
    );
    if (!confirmed) {
      return;
    }

    setIsCategoryMutating(true);

    try {
      const response = await fetch(
        `/api/categories/${activeCategoryRecord.id}`,
        {
          method: "DELETE",
        },
      );
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
                category: payload.reassignedCategory?.name ?? resource.category,
              }
            : resource,
        ),
      );

      setActiveCategory("All");
      void fetchCategories();
      toast.success("Category deleted", {
        description: `${payload.reassignedResources ?? 0} resource(s) reassigned to ${payload.reassignedCategory.name}.`,
      });
    } catch (error) {
      toast.error("Category deletion failed", {
        description:
          error instanceof Error ? error.message : "Could not delete category.",
      });
    } finally {
      setIsCategoryMutating(false);
    }
  }, [
    activeCategory,
    activeCategoryRecord,
    canManageResources,
    fetchCategories,
  ]);

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
      if (!canManageResources) {
        toast.error("Admin access required", {
          description: "Only admins can add or edit resource cards.",
        });
        return;
      }

      const isEditing = editingResource !== null;
      setIsSaving(true);

      try {
        const response = await fetch(
          isEditing ? `/api/resources/${editingResource.id}` : "/api/resources",
          {
            method: isEditing ? "PUT" : "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
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
    [canManageResources, editingResource, fetchCategories],
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

      setPasteHoverTarget({
        type: "category",
        category,
      });
    },
    [],
  );

  const handleDesktopSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startWidth = desktopSidebarWidth;
      setIsSidebarResizing(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = clampDesktopSidebarWidth(
          startWidth + moveEvent.clientX - startX,
        );
        setDesktopSidebarWidth(nextWidth);
      };

      const stopResizing = () => {
        setIsSidebarResizing(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResizing);
        window.removeEventListener("pointercancel", stopResizing);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResizing);
      window.addEventListener("pointercancel", stopResizing);
    },
    [desktopSidebarWidth],
  );

  const handlePasteIntoHoverTarget = useCallback(
    async (rawUrl: string, target: PasteHoverTarget) => {
      if (!canManageResources) {
        toast.error("Admin access required", {
          description:
            "Only admins can paste links directly into cards or categories.",
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

        if (target.type === "card") {
          const currentResource = resources.find(
            (resource) => resource.id === target.resourceId,
          );
          if (!currentResource) {
            throw new Error("Hovered card no longer exists.");
          }

          const alreadyHasLink = currentResource.links.some(
            (link) => link.url.toLowerCase() === url.toLowerCase(),
          );
          if (alreadyHasLink) {
            toast.message("Link already exists in this card.");
            return;
          }

          const nextInput: ResourceInput = {
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
      canManageResources,
      fetchCategories,
      isAiPasteRunning,
      isSaving,
      resources,
    ],
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
      if (!canManageResources) {
        toast.error("Admin access required", {
          description: "Only admins can archive resource cards.",
        });
        return;
      }

      const archivedResource = resources.find(
        (resource) => resource.id === resourceId,
      );
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
    [canManageResources, handleRestoreArchivedResource, resources],
  );

  const handleEdit = useCallback((resource: ResourceCard) => {
    setEditingResource(resource);
    setModalOpen(true);
  }, []);

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
          className="text-muted-foreground lg:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open category menu"
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
              <span>{resources.length} cards</span>
              <span>{totalLinks} links</span>
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
              {canManageResources ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateCategoryDialogOpen(true)}
                  disabled={isCategoryMutating}
                >
                  <FolderPlus className="h-4 w-4" />
                  <span className="ml-2 hidden sm:inline">New Category</span>
                </Button>
              ) : null}
              {canManageResources &&
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
              {canManageResources &&
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
                  onClick={() => {
                    setEditingResource(null);
                    setModalOpen(true);
                  }}
                  className="gap-2"
                  size="sm"
                  disabled={isLoading || Boolean(loadError)}
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
          className="relative hidden shrink-0 border-r border-border bg-card lg:block"
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
          />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize categories panel"
            onPointerDown={handleDesktopSidebarResizeStart}
            className={`absolute inset-y-0 right-0 z-10 w-3 translate-x-1/2 cursor-col-resize touch-none ${
              isSidebarResizing ? "bg-primary/20" : ""
            }`}
          />
        </aside>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="px-4 pt-4">
              <SheetTitle>Categories</SheetTitle>
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
            />
          </SheetContent>
        </Sheet>

        <main
          className="flex-1 overflow-y-auto p-4 lg:p-6"
          aria-label="Resource cards"
        >
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
                        ? "You are signed in as read-only. Ask FirstAdmin for admin access."
                        : "Sign in to request admin access and manage resources."}
                </p>
              </div>
              {!searchQuery && canManageResources ? (
                <Button
                  onClick={() => {
                    setEditingResource(null);
                    setModalOpen(true);
                  }}
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
                  onHoverChange={handleCardHoverChange}
                  isDeleting={deletingResourceId === resource.id}
                  canManage={canManageResources}
                />
              ))}
            </div>
          )}
        </main>
      </div>

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
              Categories are persistent and available in all future sessions.
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
