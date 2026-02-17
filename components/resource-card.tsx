"use client"

import { useCallback, useMemo, useState } from "react"

import type { ResourceCard } from "@/lib/resources"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getTagToneClasses } from "@/lib/tag-styles"
import {
  ClipboardCopy,
  ClipboardPaste,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

function ResourceLinkCompactItem({
  linkId,
  label,
  note,
  url,
  faviconUrl,
}: {
  linkId: string
  label: string
  note?: string | null
  url: string
  faviconUrl?: string | null
}) {
  const hostname = useMemo(() => hostnameFromUrl(url), [url])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-resource-link-id={linkId}
          className="group/link flex items-start gap-2 rounded-md border border-border/70 bg-secondary/20 p-2 transition-colors hover:border-primary/30 hover:bg-secondary/40"
        >
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-background">
            {faviconUrl ? (
              <img
                src={faviconUrl}
                alt=""
                className="h-4 w-4"
                loading="lazy"
              />
            ) : (
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover/link:text-primary" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <span className="truncate font-mono text-sm text-foreground transition-colors group-hover/link:text-primary">
                {label}
              </span>
              {hostname ? (
                <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
                  {hostname}
                </span>
              ) : null}
            </div>
            {note ? (
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {note}
              </p>
            ) : null}
          </div>
        </a>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="break-all font-mono text-xs">{url}</p>
        {note ? (
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

interface ResourceCardProps {
  resource: ResourceCard
  categorySymbol?: string | null
  onDelete: (id: string) => void
  onEdit: (resource: ResourceCard) => void
  onPasteLinkIntoCard?: (resource: ResourceCard) => void
  onHoverChange?: (resource: ResourceCard | null) => void
  isDeleting?: boolean
  canManage?: boolean
}

export function ResourceCardItem({
  resource,
  categorySymbol,
  onDelete,
  onEdit,
  onPasteLinkIntoCard,
  onHoverChange,
  isDeleting = false,
  canManage = false,
}: ResourceCardProps) {
  const [contextLinkId, setContextLinkId] = useState<string | null>(null)

  const selectedContextLink = useMemo(
    () =>
      contextLinkId
        ? resource.links.find((link) => link.id === contextLinkId) ?? null
        : null,
    [contextLinkId, resource.links],
  )

  const copyText = useCallback(async (value: string, message: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard unavailable")
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      toast.success(message)
    } catch {
      toast.error("Could not copy text to clipboard.")
    }
  }, [])

  const openInNewTab = useCallback((url: string) => {
    if (typeof window === "undefined") {
      return
    }

    window.open(url, "_blank", "noopener,noreferrer")
  }, [])

  const handleContextMenuCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target
      if (!(target instanceof Element)) {
        setContextLinkId(null)
        return
      }

      const linkElement = target.closest<HTMLElement>("[data-resource-link-id]")
      setContextLinkId(linkElement?.dataset.resourceLinkId ?? null)
    },
    [],
  )

  const firstLink = resource.links[0]
  const allLinksText = resource.links.map((link) => link.url).join("\n")

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group flex flex-col rounded-lg border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md hover:shadow-primary/5"
          onMouseEnter={() => onHoverChange?.(resource)}
          onMouseLeave={() => onHoverChange?.(null)}
          onContextMenuCapture={handleContextMenuCapture}
        >
          <div className="mb-3 flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="cursor-default font-medium">
                  {categorySymbol ? `${categorySymbol} ` : ""}
                  {resource.category}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span>Category: {resource.category}</span>
              </TooltipContent>
            </Tooltip>
            {canManage ? (
              <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => onEdit(resource)}
                      aria-label={`Edit ${resource.category} resource card`}
                      disabled={isDeleting}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Edit resource card</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(resource.id)}
                      aria-label={`Delete ${resource.category} resource card`}
                      disabled={isDeleting}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Archive card (restorable from Admin Panel)
                  </TooltipContent>
                </Tooltip>
              </div>
            ) : null}
          </div>

          {resource.tags.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {resource.tags.map((tag) => (
                <Tooltip key={`${resource.id}-${tag}`}>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={`cursor-default ${getTagToneClasses(tag)}`}
                    >
                      {tag}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <span>Tag: {tag}</span>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ) : null}

          <ul className="flex flex-col gap-2.5" role="list">
            {resource.links.map((link) => (
              <li key={link.id}>
                <ResourceLinkCompactItem
                  linkId={link.id}
                  label={link.label}
                  note={link.note}
                  url={link.url}
                  faviconUrl={link.faviconUrl}
                />
              </li>
            ))}
          </ul>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-64">
        <ContextMenuLabel>
          {selectedContextLink ? "Link Actions" : "Card Actions"}
        </ContextMenuLabel>
        <ContextMenuSeparator />

        {selectedContextLink ? (
          <>
            <ContextMenuItem onSelect={() => openInNewTab(selectedContextLink.url)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open link in new tab
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                void copyText(selectedContextLink.url, "Link URL copied")
              }
            >
              <ClipboardCopy className="mr-2 h-4 w-4" />
              Copy link URL
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                void copyText(
                  `[${selectedContextLink.label}](${selectedContextLink.url})`,
                  "Markdown link copied",
                )
              }
            >
              <ClipboardCopy className="mr-2 h-4 w-4" />
              Copy markdown link
            </ContextMenuItem>
            {canManage ? <ContextMenuSeparator /> : null}
          </>
        ) : (
          <>
            <ContextMenuItem
              disabled={!firstLink}
              onSelect={() => {
                if (!firstLink) {
                  return
                }
                openInNewTab(firstLink.url)
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open first link
            </ContextMenuItem>
            <ContextMenuItem
              disabled={resource.links.length === 0}
              onSelect={() => void copyText(allLinksText, "All link URLs copied")}
            >
              <ClipboardCopy className="mr-2 h-4 w-4" />
              Copy all link URLs
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                void copyText(resource.category, "Category name copied")
              }
            >
              <ClipboardCopy className="mr-2 h-4 w-4" />
              Copy category name
            </ContextMenuItem>
            {canManage ? <ContextMenuSeparator /> : null}
          </>
        )}

        {canManage ? (
          <>
            <ContextMenuItem
              disabled={isDeleting}
              onSelect={() => onEdit(resource)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit resource card
            </ContextMenuItem>
            <ContextMenuItem
              disabled={isDeleting}
              onSelect={() => onPasteLinkIntoCard?.(resource)}
            >
              <ClipboardPaste className="mr-2 h-4 w-4" />
              Paste URL into this card
            </ContextMenuItem>
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              disabled={isDeleting}
              onSelect={() => onDelete(resource.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Archive resource card
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
