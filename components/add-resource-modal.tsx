"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { normalizeDraftTags, type PastedLinkDraft } from "@/lib/link-paste"
import { DEFAULT_CATEGORY_SUGGESTIONS } from "@/lib/resources"
import type { ResourceCard, ResourceInput } from "@/lib/resources"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Plus, Sparkles, Tag, X } from "lucide-react"

interface LinkInput {
  url: string
  label: string
  note: string
}

interface LinkSuggestionResponse {
  url?: string
  label?: string
  note?: string
  category?: string
  tags?: string[]
  model?: string
  error?: string
}

interface AddResourceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (resource: ResourceInput) => Promise<void>
  editingResource?: ResourceCard | null
  initialLink?: PastedLinkDraft | null
  initialCategory?: string | null
  initialTags?: string[] | null
  isSaving?: boolean
  categorySuggestions?: string[]
}

export function AddResourceModal({
  open,
  onOpenChange,
  onSave,
  editingResource,
  initialLink,
  initialCategory,
  initialTags,
  isSaving = false,
  categorySuggestions = [],
}: AddResourceModalProps) {
  const [categoryInput, setCategoryInput] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState("")
  const [links, setLinks] = useState<LinkInput[]>([
    { url: "", label: "", note: "" },
  ])
  const [aiLoadingForLink, setAiLoadingForLink] = useState<number | null>(null)
  const hasInitializedForCurrentOpenRef = useRef(false)

  const categoryOptions = useMemo(() => {
    const unique = new Set<string>()

    for (const category of [...categorySuggestions, ...DEFAULT_CATEGORY_SUGGESTIONS]) {
      const normalized = category.trim()
      if (normalized.length > 0) {
        unique.add(normalized)
      }
    }

    return [...unique]
  }, [categorySuggestions])

  const resetForm = useCallback(() => {
    setCategoryInput("")
    setTags([])
    setTagDraft("")
    setLinks([{ url: "", label: "", note: "" }])
    setAiLoadingForLink(null)
  }, [])

  const initFromEditing = useCallback(() => {
    if (!editingResource) {
      resetForm()
      const preparedCategory = initialCategory?.trim() ?? ""
      if (preparedCategory) {
        setCategoryInput(preparedCategory)
      }
      setTags(normalizeDraftTags(initialTags ?? []))
      if (initialLink?.url.trim()) {
        setLinks([
          {
            url: initialLink.url.trim(),
            label: initialLink.label.trim(),
            note: initialLink.note.trim(),
          },
        ])
      }
      return
    }

    setCategoryInput(editingResource.category)

    setLinks(
      editingResource.links.map((link) => ({
        url: link.url,
        label: link.label,
        note: link.note ?? "",
      }))
    )
    setTags([...(editingResource.tags ?? [])])
    setTagDraft("")
  }, [editingResource, initialCategory, initialLink, initialTags, resetForm])

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
  }

  useEffect(() => {
    if (open) {
      if (!hasInitializedForCurrentOpenRef.current) {
        initFromEditing()
        hasInitializedForCurrentOpenRef.current = true
      }
      return
    }

    hasInitializedForCurrentOpenRef.current = false
  }, [initFromEditing, open])

  const addLink = () => {
    setLinks((prev) => [...prev, { url: "", label: "", note: "" }])
  }

  const removeLink = (index: number) => {
    setLinks((prev) => prev.filter((_, i) => i !== index))
  }

  const updateLink = (index: number, field: keyof LinkInput, value: string) => {
    setLinks((prev) =>
      prev.map((link, i) => (i === index ? { ...link, [field]: value } : link))
    )
  }

  const normalizeTag = (value: string) => value.replace(/\s+/g, " ").trim()

  const addTag = () => {
    const normalizedTag = normalizeTag(tagDraft)
    if (!normalizedTag) {
      return
    }

    setTags((previous) => {
      const exists = previous.some(
        (existing) => existing.toLowerCase() === normalizedTag.toLowerCase()
      )
      if (exists) {
        return previous
      }

      return [...previous, normalizedTag]
    })
    setTagDraft("")
  }

  const removeTag = (tag: string) => {
    setTags((previous) =>
      previous.filter((existing) => existing.toLowerCase() !== tag.toLowerCase())
    )
  }

  const handleAiSuggestion = async (index: number) => {
    const link = links[index]
    const url = link.url.trim()

    if (!url) {
      return
    }

    setAiLoadingForLink(index)

    try {
      const response = await fetch("/api/links/suggest-from-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          categories: categoryOptions,
        }),
      })

      const data: LinkSuggestionResponse = await response.json()

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to fetch AI suggestions.")
      }

      // Update the link with AI suggestions
      setLinks((prev) =>
        prev.map((l, i) =>
          i === index
            ? {
                ...l,
                label: data.label?.trim() || l.label,
                note: data.note?.trim() || l.note,
              }
            : l
        )
      )

      // Update category if not already set and AI provided one
      if (data.category?.trim() && !categoryInput.trim()) {
        setCategoryInput(data.category.trim())
      }

      // Add new tags from AI (avoid duplicates)
      if (data.tags && data.tags.length > 0) {
        setTags((prev) => {
          const newTags = [...prev]
          for (const tag of data.tags ?? []) {
            const normalized = normalizeTag(tag)
            const exists = newTags.some(
              (existing) => existing.toLowerCase() === normalized.toLowerCase()
            )
            if (!exists && normalized) {
              newTags.push(normalized)
            }
          }
          return newTags
        })
      }
    } catch (error) {
      console.error("AI suggestion error:", error)
      // Silently fail - user can still fill manually
    } finally {
      setAiLoadingForLink(null)
    }
  }

  const resolvedCategory = categoryInput.trim()

  const validLinks = useMemo(
    () => links.filter((link) => link.url.trim() && link.label.trim()),
    [links]
  )

  const canSave = resolvedCategory.trim().length > 0 && validLinks.length > 0

  const handleSave = async () => {
    if (!canSave || isSaving) {
      return
    }

    const resource: ResourceInput = {
      category: resolvedCategory.trim(),
      tags,
      links: validLinks.map((link) => ({
        url: link.url.trim(),
        label: link.label.trim(),
        note: link.note.trim() || undefined,
      })),
    }

    await onSave(resource)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editingResource ? "Edit Resource" : "Add Resource"}
          </DialogTitle>
          <DialogDescription>
            {editingResource
              ? "Update the category and links for this resource card."
              : "Add a new resource card with links to your library."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="category-input">Category</Label>
            <Input
              id="category-input"
              list="resource-category-suggestions"
              placeholder="Type or paste a category..."
              value={categoryInput}
              onChange={(event) => setCategoryInput(event.target.value)}
              autoFocus={!editingResource}
              disabled={isSaving}
            />
            <datalist id="resource-category-suggestions">
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="resource-tag-input">Tags (optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="resource-tag-input"
                  placeholder="e.g. TypeScript"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      addTag()
                    }
                  }}
                  disabled={isSaving}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTag}
                  disabled={isSaving}
                >
                  <Tag className="mr-1 h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-destructive"
                        aria-label={`Remove tag ${tag}`}
                        disabled={isSaving}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between">
              <Label>Links</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addLink}
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                disabled={isSaving}
              >
                <Plus className="h-3 w-3" />
                Add link
              </Button>
            </div>

            {links.map((link, index) => (
              <div
                key={index}
                className="relative flex flex-col gap-2 rounded-lg border border-border bg-secondary/30 p-3"
              >
                {links.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLink(index)}
                    className="absolute right-2 top-2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove link ${index + 1}`}
                    disabled={isSaving}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor={`link-label-${index}`}
                      className="text-xs text-muted-foreground"
                    >
                      Label
                    </Label>
                    <Input
                      id={`link-label-${index}`}
                      placeholder="e.g. cppreference"
                      value={link.label}
                      onChange={(event) =>
                        updateLink(index, "label", event.target.value)
                      }
                      disabled={isSaving}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor={`link-url-${index}`}
                      className="text-xs text-muted-foreground"
                    >
                      URL
                    </Label>
                    <div className="flex gap-1">
                      <Input
                        id={`link-url-${index}`}
                        type="url"
                        placeholder="https://..."
                        value={link.url}
                        onChange={(event) =>
                          updateLink(index, "url", event.target.value)
                        }
                        disabled={isSaving}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleAiSuggestion(index)}
                        disabled={
                          isSaving ||
                          !link.url.trim() ||
                          aiLoadingForLink === index
                        }
                        className="h-9 w-9 p-0 shrink-0"
                        title="Fill with AI suggestions"
                      >
                        {aiLoadingForLink === index ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <Label
                    htmlFor={`link-note-${index}`}
                    className="text-xs text-muted-foreground"
                  >
                    Note (optional)
                  </Label>
                  <Input
                    id={`link-note-${index}`}
                    placeholder="Short description..."
                    value={link.note}
                    onChange={(event) =>
                      updateLink(index, "note", event.target.value)
                    }
                    disabled={isSaving}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving
              ? editingResource
                ? "Updating..."
                : "Saving..."
              : editingResource
                ? "Update"
                : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
