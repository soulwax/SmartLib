"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { signIn, signOut, useSession } from "next-auth/react"

import type { ResourceCard, ResourceInput } from "@/lib/resources"
import { AddResourceModal } from "@/components/add-resource-modal"
import { CategorySidebar } from "@/components/category-sidebar"
import { ResourceCardItem } from "@/components/resource-card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  BookOpen,
  FolderOpen,
  Github,
  LogIn,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldPlus,
  UserPlus,
} from "lucide-react"
import { Toaster, toast } from "sonner"

interface ApiErrorResponse {
  error?: string
  mode?: "database" | "mock"
}

interface AuthRegisterResponse extends ApiErrorResponse {
  requiresEmailVerification?: boolean
  verificationEmailMode?: "resend" | "mock"
  verificationPreviewUrl?: string | null
  user?: {
    id: string
    email: string
  }
}

interface ResendVerificationResponse extends ApiErrorResponse {
  alreadyVerified?: boolean
  verificationEmailMode?: "resend" | "mock"
  verificationPreviewUrl?: string | null
  ok?: boolean
}

interface ListResourcesResponse extends ApiErrorResponse {
  mode?: "database" | "mock"
  resources?: ResourceCard[]
}

interface ResourceResponse extends ApiErrorResponse {
  mode?: "database" | "mock"
  resource?: ResourceCard
}

interface PromoteAdminResponse extends ApiErrorResponse {
  user?: {
    id: string
    email: string
    isAdmin: boolean
    isFirstAdmin: boolean
  }
}

type AuthMode = "login" | "register"

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

export default function Page() {
  const { data: session, status: sessionStatus } = useSession()
  const [resources, setResources] = useState<ResourceCard[]>([])
  const [activeCategory, setActiveCategory] = useState<string | "All">("All")
  const [searchQuery, setSearchQuery] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [editingResource, setEditingResource] = useState<ResourceCard | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingResourceId, setDeletingResourceId] = useState<string | null>(
    null
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dataMode, setDataMode] = useState<"database" | "mock">("mock")
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>("login")
  const [authEmail, setAuthEmail] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false)
  const [isResendingVerification, setIsResendingVerification] = useState(false)
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false)
  const [promoteIdentifier, setPromoteIdentifier] = useState("")
  const [isPromotingAdmin, setIsPromotingAdmin] = useState(false)

  const isAuthenticated = Boolean(session?.user?.id)
  const isAdmin = Boolean(session?.user?.isAdmin)
  const isFirstAdmin = Boolean(session?.user?.isFirstAdmin)
  const canManageResources = isAdmin
  const canSubmitAuth = authEmail.trim().length > 0 && authPassword.length > 0
  const canSubmitPromote = promoteIdentifier.trim().length > 0 && !isPromotingAdmin

  const resourceCounts = useMemo(() => {
    const counts: Record<string, number> = {}

    for (const resource of resources) {
      counts[resource.category] = (counts[resource.category] ?? 0) + 1
    }

    return counts
  }, [resources])

  const categories = useMemo(() => {
    const unique = new Set<string>()
    for (const resource of resources) {
      const category = resource.category.trim()
      if (category.length > 0) {
        unique.add(category)
      }
    }

    return [...unique]
  }, [resources])

  const filteredResources = useMemo(() => {
    let result = resources

    if (activeCategory !== "All") {
      result = result.filter((resource) => resource.category === activeCategory)
    }

    if (searchQuery.trim()) {
      const normalizedSearchQuery = searchQuery.toLowerCase()
      result = result.filter(
        (resource) =>
          resource.category.toLowerCase().includes(normalizedSearchQuery) ||
          resource.links.some(
            (link) =>
              link.label.toLowerCase().includes(normalizedSearchQuery) ||
              link.url.toLowerCase().includes(normalizedSearchQuery) ||
              link.note?.toLowerCase().includes(normalizedSearchQuery)
          )
      )
    }

    return result
  }, [resources, activeCategory, searchQuery])

  const totalLinks = useMemo(
    () => resources.reduce((acc, resource) => acc + resource.links.length, 0),
    [resources]
  )

  const fetchResources = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch("/api/resources", {
        cache: "no-store",
      })
      const payload = await readJson<ListResourcesResponse>(response)

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load resources.")
      }

      setResources(payload?.resources ?? [])
      setDataMode(payload?.mode === "database" ? "database" : "mock")
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to load resources. Check the database setup and retry."
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchResources()
  }, [fetchResources])

  useEffect(() => {
    if (activeCategory !== "All" && !resourceCounts[activeCategory]) {
      setActiveCategory("All")
    }
  }, [activeCategory, resourceCounts])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const currentUrl = new URL(window.location.href)
    const verificationStatus = currentUrl.searchParams.get("emailVerification")
    if (!verificationStatus) {
      return
    }

    if (verificationStatus === "success") {
      toast.success("Email verified", {
        description: "You can now sign in with your credentials.",
      })
    } else {
      toast.error("Verification link invalid", {
        description: "Request a new verification email and try again.",
      })
    }

    currentUrl.searchParams.delete("emailVerification")
    const nextPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
    window.history.replaceState({}, "", nextPath || "/")
  }, [])

  const resetAuthForm = useCallback(() => {
    setAuthEmail("")
    setAuthPassword("")
    setIsAuthSubmitting(false)
    setIsResendingVerification(false)
  }, [])

  const handleAuthDialogOpenChange = useCallback(
    (open: boolean) => {
      setAuthDialogOpen(open)
      if (!open) {
        resetAuthForm()
      }
    },
    [resetAuthForm]
  )

  const openAuthDialog = useCallback((mode: AuthMode) => {
    setAuthMode(mode)
    setAuthDialogOpen(true)
  }, [])

  const handleAuthSubmit = useCallback(async () => {
    if (isAuthSubmitting) {
      return
    }

    setIsAuthSubmitting(true)

    try {
      const email = authEmail.trim().toLowerCase()
      const password = authPassword

      if (!email || !password) {
        throw new Error("Username/email and password are required.")
      }

      if (authMode === "register") {
        const registerResponse = await fetch("/api/auth/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        })
        const registerPayload = await readJson<AuthRegisterResponse>(
          registerResponse
        )

        if (!registerResponse.ok) {
          throw new Error(registerPayload?.error ?? "Registration failed.")
        }

        handleAuthDialogOpenChange(false)
        setAuthMode("login")
        setAuthEmail(email)
        setAuthPassword("")

        if (registerPayload?.verificationEmailMode === "mock") {
          toast.success("Registration complete", {
            description: registerPayload.verificationPreviewUrl
              ? `Open the verification link: ${registerPayload.verificationPreviewUrl}`
              : "Verification link available in server logs.",
          })
        } else {
          toast.success("Registration complete", {
            description: "Check your inbox and confirm your email before sign in.",
          })
        }

        return
      }

      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (signInResult?.error) {
        if (signInResult.error === "EMAIL_NOT_VERIFIED") {
          throw new Error(
            "Email not verified yet. Check your inbox or resend verification."
          )
        }

        throw new Error("Invalid username/email or password.")
      }

      handleAuthDialogOpenChange(false)

      toast.success("Signed in", {
        description: "Authenticated actions are now unlocked.",
      })
    } catch (error) {
      toast.error(authMode === "register" ? "Registration failed" : "Sign-in failed", {
        description:
          error instanceof Error ? error.message : "Could not authenticate user.",
      })
    } finally {
      setIsAuthSubmitting(false)
    }
  }, [authEmail, authMode, authPassword, handleAuthDialogOpenChange, isAuthSubmitting])

  const handleResendVerification = useCallback(async () => {
    if (isResendingVerification) {
      return
    }

    const email = authEmail.trim().toLowerCase()
    if (!email) {
      toast.error("Email required", {
        description: "Enter your email first, then resend verification.",
      })
      return
    }

    setIsResendingVerification(true)

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      })
      const payload = await readJson<ResendVerificationResponse>(response)

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to resend verification email.")
      }

      if (payload?.alreadyVerified) {
        toast.success("Email already verified", {
          description: "You can sign in now.",
        })
        return
      }

      if (payload?.verificationEmailMode === "mock") {
        toast.success("Verification link regenerated", {
          description: payload.verificationPreviewUrl
            ? `Open this link: ${payload.verificationPreviewUrl}`
            : "Verification link available in server logs.",
        })
        return
      }

      toast.success("Verification email sent", {
        description: "Check your inbox for a new verification link.",
      })
    } catch (error) {
      toast.error("Resend failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not resend verification email.",
      })
    } finally {
      setIsResendingVerification(false)
    }
  }, [authEmail, isResendingVerification])

  const handleSignOut = useCallback(async () => {
    await signOut({ redirect: false })
    toast.success("Signed out", {
      description: "Resource management actions are now locked.",
    })
  }, [])

  const handleGitHubSignIn = useCallback(() => {
    void signIn("github", { callbackUrl: "/" })
  }, [])

  const handlePromoteAdmin = useCallback(async () => {
    if (!isFirstAdmin || !canSubmitPromote) {
      return
    }

    setIsPromotingAdmin(true)

    try {
      const response = await fetch("/api/auth/admins", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier: promoteIdentifier.trim(),
        }),
      })
      const payload = await readJson<PromoteAdminResponse>(response)

      if (!response.ok || !payload?.user) {
        throw new Error(payload?.error ?? "Failed to promote admin.")
      }

      setPromoteIdentifier("")
      setPromoteDialogOpen(false)
      toast.success("Admin promoted", {
        description: `${payload.user.email} can now manage resources.`,
      })
    } catch (error) {
      toast.error("Promotion failed", {
        description:
          error instanceof Error ? error.message : "Could not promote this user.",
      })
    } finally {
      setIsPromotingAdmin(false)
    }
  }, [canSubmitPromote, isFirstAdmin, promoteIdentifier])

  const handleSave = useCallback(
    async (input: ResourceInput) => {
      if (!canManageResources) {
        toast.error("Admin access required", {
          description: "Only admins can add or edit resource cards.",
        })
        return
      }

      const isEditing = editingResource !== null
      setIsSaving(true)

      try {
        const response = await fetch(
          isEditing ? `/api/resources/${editingResource.id}` : "/api/resources",
          {
            method: isEditing ? "PUT" : "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
          }
        )

        const payload = await readJson<ResourceResponse>(response)

        if (!response.ok || !payload?.resource) {
          throw new Error(payload?.error ?? "Failed to save resource.")
        }

        const savedResource = payload.resource
        if (payload.mode) {
          setDataMode(payload.mode)
        }

        setResources((prev) => {
          if (!isEditing) {
            return [savedResource, ...prev]
          }

          return prev.map((resource) =>
            resource.id === savedResource.id ? savedResource : resource
          )
        })

        setEditingResource(null)
        setModalOpen(false)

        toast.success(isEditing ? "Resource updated" : "Resource added", {
          description: `${savedResource.category} card saved to your library.`,
        })
      } catch (error) {
        toast.error("Save failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not save this resource.",
        })
      } finally {
        setIsSaving(false)
      }
    },
    [canManageResources, editingResource]
  )

  const handleRestoreArchivedResource = useCallback(async (resourceId: string) => {
    const response = await fetch(`/api/admin/resources/${resourceId}/restore`, {
      method: "POST",
    })
    const payload = await readJson<ResourceResponse>(response)

    if (!response.ok || !payload?.resource) {
      throw new Error(payload?.error ?? "Failed to restore archived resource.")
    }

    if (payload.mode) {
      setDataMode(payload.mode)
    }

    const restoredResource = payload.resource
    setResources((prev) => {
      const withoutRestored = prev.filter(
        (resource) => resource.id !== restoredResource.id
      )
      return [restoredResource, ...withoutRestored]
    })

    return restoredResource
  }, [])

  const handleDelete = useCallback(
    async (resourceId: string) => {
      if (!canManageResources) {
        toast.error("Admin access required", {
          description: "Only admins can archive resource cards.",
        })
        return
      }

      const archivedResource = resources.find((resource) => resource.id === resourceId)
      setDeletingResourceId(resourceId)

      try {
        const response = await fetch(`/api/resources/${resourceId}`, {
          method: "DELETE",
        })
        const payload = await readJson<ApiErrorResponse>(response)

        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to archive resource.")
        }

        if (payload?.mode) {
          setDataMode(payload.mode)
        }

        setResources((prev) => prev.filter((resource) => resource.id !== resourceId))
        toast("Resource archived", {
          description: "Hidden from library. Restore it now or from Admin Panel.",
          action: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                try {
                  const restored = await handleRestoreArchivedResource(resourceId)
                  toast.success("Archive undone", {
                    description: `${restored.category} is visible again.`,
                  })
                } catch (error) {
                  toast.error("Undo failed", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "Could not restore this resource.",
                  })
                }
              })()
            },
          },
        })
      } catch (error) {
        toast.error("Archive failed", {
          description:
            error instanceof Error
              ? error.message
              : archivedResource
                ? `Could not archive ${archivedResource.category}.`
                : "Could not archive this resource.",
        })
      } finally {
        setDeletingResourceId(null)
      }
    },
    [canManageResources, handleRestoreArchivedResource, resources]
  )

  const handleEdit = useCallback((resource: ResourceCard) => {
    setEditingResource(resource)
    setModalOpen(true)
  }, [])

  const handleModalOpenChange = useCallback((open: boolean) => {
    setModalOpen(open)
    if (!open) {
      setEditingResource(null)
    }
  }, [])

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
          <div className="hidden sm:block">
            <h1 className="text-base font-semibold leading-tight text-foreground">
              DevVault
            </h1>
            <p className="text-xs text-muted-foreground">
              {resources.length} cards &middot; {totalLinks} links
              {dataMode === "mock" ? " · mock mode" : ""}
            </p>
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
          {sessionStatus === "loading" ? (
            <span className="text-xs text-muted-foreground">Checking auth...</span>
          ) : isAuthenticated ? (
            <>
              <span className="hidden max-w-48 truncate text-xs text-muted-foreground md:inline">
                {session?.user?.email}
              </span>
              <span className="hidden rounded-md bg-secondary px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground sm:inline">
                {isFirstAdmin ? "FirstAdmin" : isAdmin ? "Admin" : "Viewer"}
              </span>
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
              <Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
                <LogOut className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Sign out</span>
              </Button>
              {canManageResources ? (
                <Button
                  onClick={() => {
                    setEditingResource(null)
                    setModalOpen(true)
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
              <Button variant="outline" size="sm" onClick={() => openAuthDialog("login")}>
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
          className="hidden w-60 shrink-0 border-r border-border bg-card lg:block"
          aria-label="Category navigation"
        >
          <CategorySidebar
            categories={categories}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            resourceCounts={resourceCounts}
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
                setActiveCategory(category)
                setSidebarOpen(false)
              }}
              resourceCounts={resourceCounts}
            />
          </SheetContent>
        </Sheet>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6" aria-label="Resource cards">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Loading resources...</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <h2 className="text-lg font-semibold text-foreground">
                Unable to load resources
              </h2>
              <p className="max-w-xl text-sm text-muted-foreground">{loadError}</p>
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
                    setEditingResource(null)
                    setModalOpen(true)
                  }}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Resource
                </Button>
              ) : null}
              {!searchQuery && !isAuthenticated ? (
                <Button onClick={() => openAuthDialog("login")} className="gap-2">
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
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  isDeleting={deletingResourceId === resource.id}
                  canManage={canManageResources}
                />
              ))}
            </div>
          )}
        </main>
      </div>

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
            <TabsContent value="login" className="m-0 text-xs text-muted-foreground">
              Use your existing credentials.
            </TabsContent>
            <TabsContent value="register" className="m-0 text-xs text-muted-foreground">
              Create credentials for protected actions.
            </TabsContent>
          </Tabs>

          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleAuthSubmit()
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
                autoComplete={authMode === "register" ? "new-password" : "current-password"}
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
          setPromoteDialogOpen(open)
          if (!open) {
            setPromoteIdentifier("")
            setIsPromotingAdmin(false)
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
  )
}
