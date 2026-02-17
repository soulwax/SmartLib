"use client"

import { useMemo } from "react"

import type { ResourceCard } from "@/lib/resources"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getTagToneClasses } from "@/lib/tag-styles"
import { ExternalLink, Pencil, Trash2 } from "lucide-react"

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

function ResourceLinkCompactItem({
  label,
  note,
  url,
  faviconUrl,
}: {
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
  onHoverChange?: (resource: ResourceCard | null) => void
  isDeleting?: boolean
  canManage?: boolean
}

export function ResourceCardItem({
  resource,
  categorySymbol,
  onDelete,
  onEdit,
  onHoverChange,
  isDeleting = false,
  canManage = false,
}: ResourceCardProps) {
  return (
    <div
      className="group flex flex-col rounded-lg border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md hover:shadow-primary/5"
      onMouseEnter={() => onHoverChange?.(resource)}
      onMouseLeave={() => onHoverChange?.(null)}
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
              label={link.label}
              note={link.note}
              url={link.url}
              faviconUrl={link.faviconUrl}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
