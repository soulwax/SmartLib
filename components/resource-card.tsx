"use client"

import type { ResourceCard } from "@/lib/resources"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink, Pencil, Trash2 } from "lucide-react"

interface ResourceCardProps {
  resource: ResourceCard
  onDelete: (id: string) => void
  onEdit: (resource: ResourceCard) => void
  isDeleting?: boolean
  canManage?: boolean
}

export function ResourceCardItem({
  resource,
  onDelete,
  onEdit,
  isDeleting = false,
  canManage = false,
}: ResourceCardProps) {
  return (
    <div className="group flex flex-col rounded-lg border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md hover:shadow-primary/5">
      <div className="mb-3 flex items-center justify-between">
        <Badge variant="secondary" className="font-medium">
          {resource.category}
        </Badge>
        {canManage ? (
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
          </div>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2.5" role="list">
        {resource.links.map((link) => (
          <li key={link.id}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/link -mx-1.5 flex items-start gap-2 rounded-md p-1.5 transition-colors hover:bg-secondary"
            >
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/link:text-primary" />
              <div className="min-w-0 flex-1">
                <span className="font-mono text-sm text-foreground transition-colors group-hover/link:text-primary">
                  {link.label}
                </span>
                {link.note && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {link.note}
                  </p>
                )}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
