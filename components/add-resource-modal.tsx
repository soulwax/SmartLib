"use client"

import { useCallback, useMemo, useState } from "react"

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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, X } from "lucide-react"

interface LinkInput {
  url: string
  label: string
  note: string
}

interface AddResourceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (resource: ResourceInput) => Promise<void>
  editingResource?: ResourceCard | null
  isSaving?: boolean
  categorySuggestions?: string[]
}

export function AddResourceModal({
  open,
  onOpenChange,
  onSave,
  editingResource,
  isSaving = false,
  categorySuggestions = [],
}: AddResourceModalProps) {
  const [category, setCategory] = useState("")
  const [customCategory, setCustomCategory] = useState("")
  const [links, setLinks] = useState<LinkInput[]>([
    { url: "", label: "", note: "" },
  ])

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
    setCategory("")
    setCustomCategory("")
    setLinks([{ url: "", label: "", note: "" }])
  }, [])

  const initFromEditing = useCallback(() => {
    if (!editingResource) {
      resetForm()
      return
    }

    if (categoryOptions.includes(editingResource.category)) {
      setCategory(editingResource.category)
      setCustomCategory("")
    } else {
      setCategory("__custom__")
      setCustomCategory(editingResource.category)
    }

    setLinks(
      editingResource.links.map((link) => ({
        url: link.url,
        label: link.label,
        note: link.note ?? "",
      }))
    )
  }, [categoryOptions, editingResource, resetForm])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      initFromEditing()
    }

    onOpenChange(nextOpen)
  }

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

  const resolvedCategory =
    category === "__custom__" ? customCategory.trim() : category

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
            <Label htmlFor="category-select">Category</Label>
            <select
              id="category-select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">Select a category...</option>
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
              <option value="__custom__">+ Custom category</option>
            </select>

            {category === "__custom__" && (
              <Input
                placeholder="Enter custom category name..."
                value={customCategory}
                onChange={(event) => setCustomCategory(event.target.value)}
                autoFocus
              />
            )}
          </div>

          <div className="flex flex-col gap-3">
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
                    <Input
                      id={`link-url-${index}`}
                      type="url"
                      placeholder="https://..."
                      value={link.url}
                      onChange={(event) =>
                        updateLink(index, "url", event.target.value)
                      }
                      disabled={isSaving}
                    />
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
