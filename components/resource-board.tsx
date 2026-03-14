"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FixedSizeList, type ListOnScrollProps } from "react-window"

import {
  LINK_ITEM_DRAG_MIME,
  type LinkItemDragPayload,
  parseLinkItemDragPayload,
  serializeLinkItemDragPayload,
} from "@/lib/link-item-drag"
import type { ResourceCard } from "@/lib/resources"
import { cn } from "@/lib/utils"
import { ResourceCardItem } from "@/components/resource-card"
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
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  ClipboardPaste,
  Copy,
  ExternalLink,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

const MAX_ORDER = Number.MAX_SAFE_INTEGER

function compareResourcesByOrder(left: ResourceCard, right: ResourceCard): number {
  const leftOrder = typeof left.order === "number" ? left.order : MAX_ORDER
  const rightOrder = typeof right.order === "number" ? right.order : MAX_ORDER
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder
  }

  const leftCreated = Date.parse(left.createdAt ?? "")
  const rightCreated = Date.parse(right.createdAt ?? "")
  if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated)) {
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated
    }
  }

  return left.id.localeCompare(right.id)
}

function truncateCompactLabel(value: string, maxLength = 20): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return "Untitled"
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`
}

export interface ResourceBoardColumn {
  id: string | null
  name: string
  symbol?: string | null
}

export interface ResourceBoardMoveInput {
  itemId: string
  sourceCategoryId: string
  sourceCategoryName: string
  sourceIndex: number
  targetCategoryId: string
  targetCategoryName: string
  targetIndex: number
}

interface ResourceBoardProps {
  columns: ResourceBoardColumn[]
  resources: ResourceCard[]
  activeWorkspaceName?: string | null
  compactMode?: boolean
  dragEnabled: boolean
  canManageResource: (resource: ResourceCard) => boolean
  canEditCategoryByName: (category: string) => boolean
  onSelectCategory?: (category: string) => void
  onEditCategory: (category: string) => void
  onCreateResourceInCategory?: (category: string) => void
  onPasteIntoCategory?: (category: string) => void
  onDeleteCategory?: (category: string) => void
  onRefresh?: () => void
  onMoveItem: (input: ResourceBoardMoveInput) => void | Promise<void>
  onDelete: (id: string) => void
  onEdit: (resource: ResourceCard) => void
  deletingResourceId: string | null
  openLinksInSameTab: boolean
}

interface DragState {
  itemId: string
  sourceCategoryId: string
  sourceCategoryName: string
  sourceIndex: number
}

interface DropTarget {
  categoryId: string
  categoryName: string
  index: number
}

function setLinkItemDragData(
  event: React.DragEvent<HTMLElement>,
  payload: LinkItemDragPayload,
  textPayload: string,
) {
  event.dataTransfer.effectAllowed = "move"
  event.dataTransfer.setData("text/plain", textPayload)
  event.dataTransfer.setData(
    LINK_ITEM_DRAG_MIME,
    serializeLinkItemDragPayload(payload),
  )
}

function resolveDragStateFromDataTransfer(
  dataTransfer: DataTransfer | null,
): DragState | null {
  if (!dataTransfer) {
    return null
  }

  const payload = parseLinkItemDragPayload(dataTransfer.getData(LINK_ITEM_DRAG_MIME))
  if (!payload) {
    return null
  }

  return {
    itemId: payload.itemId,
    sourceCategoryId: payload.sourceCategoryId,
    sourceCategoryName: payload.sourceCategoryName,
    sourceIndex: payload.sourceIndex,
  }
}

function DropSlot({
  enabled,
  active,
  onDragOver,
  onDrop,
}: {
  enabled: boolean
  active: boolean
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      data-resource-drop-slot="true"
      aria-hidden="true"
      onDragOver={enabled ? onDragOver : undefined}
      onDrop={enabled ? onDrop : undefined}
      className={cn(
        "h-1.5 rounded-full transition-colors",
        enabled
          ? active
            ? "bg-primary/40"
            : "bg-transparent hover:bg-primary/15"
          : "bg-transparent",
      )}
    />
  )
}

export function ResourceBoard({
  columns,
  resources,
  activeWorkspaceName = null,
  compactMode = false,
  dragEnabled,
  canManageResource,
  canEditCategoryByName,
  onSelectCategory,
  onEditCategory,
  onCreateResourceInCategory,
  onPasteIntoCategory,
  onDeleteCategory,
  onRefresh,
  onMoveItem,
  onDelete,
  onEdit,
  deletingResourceId,
  openLinksInSameTab,
}: ResourceBoardProps) {
  const resourcesByCategory = useMemo(() => {
    const map = new Map<string, ResourceCard[]>()
    for (const column of columns) {
      map.set(column.name, [])
    }

    for (const resource of resources) {
      const bucket = map.get(resource.category)
      if (!bucket) {
        continue
      }
      bucket.push(resource)
    }

    for (const bucket of map.values()) {
      bucket.sort(compareResourcesByOrder)
    }

    return map
  }, [columns, resources])

  const compactRows = useMemo(() => {
    return columns.map((column) => {
      const items = resourcesByCategory.get(column.name) ?? []
      const links = items.flatMap((resource) =>
        resource.links.map((link) => ({
          id: link.id,
          resourceId: resource.id,
          category: resource.category,
          label: link.label,
          url: link.url,
          note: link.note ?? null,
          faviconUrl: link.faviconUrl ?? null,
        })),
      )

      return {
        key: column.id ?? `column:${column.name}`,
        column,
        resourceCount: items.length,
        linkCount: links.length,
        links,
      }
    })
  }, [columns, resourcesByCategory])

  const compactViewportRef = useRef<HTMLDivElement | null>(null)
  const [compactViewportHeight, setCompactViewportHeight] = useState(360)
  const [expandedCompactCategories, setExpandedCompactCategories] = useState<
    Set<string>
  >(new Set())
  const [visibleCompactRowCount, setVisibleCompactRowCount] = useState(50)

  useEffect(() => {
    if (!compactMode) {
      return
    }

    const viewportElement = compactViewportRef.current
    if (!viewportElement) {
      return
    }

    const updateViewportHeight = () => {
      setCompactViewportHeight(Math.max(220, viewportElement.clientHeight))
    }

    updateViewportHeight()

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(() => {
      updateViewportHeight()
    })
    observer.observe(viewportElement)

    return () => {
      observer.disconnect()
    }
  }, [compactMode])

  useEffect(() => {
    const initialCount = compactRows.length > 50 ? 50 : compactRows.length
    setVisibleCompactRowCount(initialCount)
  }, [compactRows.length])

  useEffect(() => {
    const available = new Set(compactRows.map((row) => row.column.name))
    setExpandedCompactCategories((previous) => {
      const next = new Set<string>()
      for (const categoryName of previous) {
        if (available.has(categoryName)) {
          next.add(categoryName)
        }
      }

      if (next.size === previous.size) {
        return previous
      }

      return next
    })
  }, [compactRows])

  const toggleCompactCategory = useCallback((categoryName: string) => {
    setExpandedCompactCategories((previous) => {
      const next = new Set(previous)
      if (next.has(categoryName)) {
        next.delete(categoryName)
      } else {
        next.add(categoryName)
      }
      return next
    })
  }, [])

  const openCompactLink = useCallback(
    (url: string) => {
      if (typeof window === "undefined") {
        return
      }

      if (openLinksInSameTab) {
        window.location.assign(url)
        return
      }

      window.open(url, "_blank", "noopener,noreferrer")
    },
    [openLinksInSameTab],
  )

  const copyCompactValue = useCallback(async (value: string, message: string) => {
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

  const compactRowsToRender = useMemo(
    () => compactRows.slice(0, Math.max(0, visibleCompactRowCount)),
    [compactRows, visibleCompactRowCount],
  )

  const handleCompactListScroll = useCallback(
    ({ scrollOffset }: ListOnScrollProps) => {
      if (visibleCompactRowCount >= compactRows.length) {
        return
      }

      const totalHeight = compactRowsToRender.length * 32
      const threshold = totalHeight - compactViewportHeight - 32 * 6
      if (scrollOffset >= threshold) {
        setVisibleCompactRowCount((previous) =>
          Math.min(compactRows.length, previous + 50),
        )
      }
    },
    [
      compactRows.length,
      compactRowsToRender.length,
      compactViewportHeight,
      visibleCompactRowCount,
    ],
  )

  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const handleDragEnd = () => {
    setDragState(null)
    setDropTarget(null)
  }

  const renderColumnContextMenu = useCallback(
    (column: ResourceBoardColumn, content: React.ReactNode) => {
      const canCustomizeCategory = canEditCategoryByName(column.name)

      return (
        <ContextMenu key={column.id ?? column.name}>
          <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            <ContextMenuLabel>
              {column.symbol ? `${column.symbol} ` : ""}
              {column.name}
            </ContextMenuLabel>
            <ContextMenuSeparator />
            {onSelectCategory ? (
              <ContextMenuItem onSelect={() => onSelectCategory(column.name)}>
                View category
              </ContextMenuItem>
            ) : null}
            {onCreateResourceInCategory ? (
              <ContextMenuItem
                onSelect={() => onCreateResourceInCategory(column.name)}
              >
                <FolderPlus className="mr-2 h-4 w-4" />
                Add resource here
              </ContextMenuItem>
            ) : null}
            {onPasteIntoCategory ? (
              <ContextMenuItem onSelect={() => onPasteIntoCategory(column.name)}>
                <ClipboardPaste className="mr-2 h-4 w-4" />
                Paste URL here
              </ContextMenuItem>
            ) : null}
            {canCustomizeCategory ? (
              <ContextMenuItem onSelect={() => onEditCategory(column.name)}>
                <Pencil className="mr-2 h-4 w-4" />
                Customize category
              </ContextMenuItem>
            ) : null}
            {canCustomizeCategory && onDeleteCategory ? (
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onDeleteCategory(column.name)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete category
              </ContextMenuItem>
            ) : null}
            {onRefresh ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={onRefresh}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh library
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      )
    },
    [
      canEditCategoryByName,
      onCreateResourceInCategory,
      onDeleteCategory,
      onEditCategory,
      onPasteIntoCategory,
      onRefresh,
      onSelectCategory,
    ],
  )

  if (compactMode) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden pb-0.5">
        <div className="flex items-center gap-1 rounded-sm border border-border/60 bg-card/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[20ch] truncate">
            {truncateCompactLabel(activeWorkspaceName || "Workspace", 24)}
          </span>
          <span aria-hidden="true">•</span>
          <span>
            {compactRows.length} {compactRows.length === 1 ? "category" : "categories"}
          </span>
          <span aria-hidden="true">•</span>
          <span>{resources.length} item</span>
          <span>{resources.length === 1 ? "" : "s"}</span>
        </div>

        <div ref={compactViewportRef} className="min-h-0 flex-1 overflow-hidden">
          {compactRowsToRender.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border/60 px-2 py-2 text-[11px] text-muted-foreground">
              No categories match this view.
            </div>
          ) : (
            <FixedSizeList
              height={compactViewportHeight}
              width="100%"
              itemCount={compactRowsToRender.length}
              itemSize={32}
              overscanCount={10}
              onScroll={handleCompactListScroll}
            >
              {({
                index,
                style,
              }: {
                index: number
                style: React.CSSProperties
              }) => {
                const row = compactRowsToRender[index]
                if (!row) {
                  return null
                }

                const expanded = expandedCompactCategories.has(row.column.name)
                const categoryLabel = row.column.symbol
                  ? `${row.column.symbol} ${row.column.name}`
                  : row.column.name

                return renderColumnContextMenu(
                  row.column,
                  <div style={style} className="px-0.5">
                    <div className="flex h-[30px] items-center gap-1 rounded-sm border border-border/65 bg-card/65 px-1">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={`compact-category-${index}`}
                        onClick={() => toggleCompactCategory(row.column.name)}
                        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-transparent px-0.5 text-[10px] font-medium text-foreground hover:border-border/70 hover:bg-background/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {expanded ? (
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                          <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="max-w-[14ch] truncate text-left">
                          {truncateCompactLabel(categoryLabel, 18)}
                        </span>
                        <span className="rounded-sm border border-border/70 px-1 text-[9px] leading-4 text-muted-foreground">
                          {row.linkCount}
                        </span>
                      </button>

                      {expanded ? (
                        <div
                          id={`compact-category-${index}`}
                          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none]"
                        >
                          {row.links.map((link) => (
                            <HoverCard key={`${row.key}:${link.id}`} openDelay={80}>
                              <HoverCardTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => openCompactLink(link.url)}
                                  className="inline-flex h-6 min-w-[48px] max-w-[14rem] items-center gap-1 rounded-sm border border-border/65 bg-background/60 px-1 text-left text-[10px] text-foreground hover:border-primary/45 hover:bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                  aria-label={`Open ${link.label}`}
                                >
                                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-[2px] border border-border/70 bg-background">
                                    {link.faviconUrl ? (
                                      <img
                                        src={link.faviconUrl}
                                        alt=""
                                        loading="lazy"
                                        className="h-3 w-3"
                                      />
                                    ) : (
                                      <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />
                                    )}
                                  </span>
                                  <span className="truncate">
                                    {truncateCompactLabel(link.label, 20)}
                                  </span>
                                </button>
                              </HoverCardTrigger>
                              <HoverCardContent align="start" side="bottom" className="w-72 space-y-2 p-2">
                                <p className="truncate text-xs font-semibold text-foreground">
                                  {link.label}
                                </p>
                                <p className="break-all text-[11px] text-muted-foreground">
                                  {link.url}
                                </p>
                                {link.note ? (
                                  <p className="text-[11px] text-muted-foreground">
                                    {link.note}
                                  </p>
                                ) : null}
                                <div className="flex items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => openCompactLink(link.url)}
                                    aria-label={`Open ${link.label}`}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() =>
                                      void copyCompactValue(link.url, "Link URL copied")
                                    }
                                    aria-label={`Copy ${link.label} URL`}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => {
                                      toast.message("AI actions", {
                                        description:
                                          "Use the compact ⚡ menu in the top bar for AI Inbox and Ask Library.",
                                      })
                                    }}
                                    aria-label="Open AI actions"
                                  >
                                    <Sparkles className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </HoverCardContent>
                            </HoverCard>
                          ))}
                        </div>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center justify-end">
                          <span className="text-[10px] text-muted-foreground">
                            {row.resourceCount} card
                            {row.resourceCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>,
                )
              }}
            </FixedSizeList>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-full overflow-x-hidden pb-2">
      <div
        className="[column-fill:_balance] [column-gap:0.75rem] sm:[column-gap:1rem]"
        style={{
          columnWidth: "20rem",
        }}
      >
        {columns.map((column) => {
          const items = resourcesByCategory.get(column.name) ?? []

          return renderColumnContextMenu(
            column,
            <section className="mb-3 block w-full break-inside-avoid rounded-lg border border-border/45 bg-card/35 p-2.5 sm:mb-4">
              <header className="flex items-center justify-between gap-2 px-1 pb-2">
                <p className="truncate text-sm font-semibold text-foreground">
                  {column.symbol ? `${column.symbol} ` : ""}
                  {column.name}
                </p>
                <span className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-xs text-muted-foreground ring-1 ring-border/45">
                  {items.length}
                </span>
              </header>

              <div
                className="flex min-h-16 flex-1 flex-col gap-2 px-1 pb-1"
                onDragOver={
                  dragEnabled && column.id
                    ? (event) => {
                        const columnId = column.id
                        if (!columnId) {
                          return
                        }

                        const target = event.target
                        if (
                          target instanceof Element &&
                          target.closest("[data-resource-drop-slot='true']")
                        ) {
                          return
                        }

                        const currentDragState =
                          dragState ??
                          resolveDragStateFromDataTransfer(event.dataTransfer)
                        if (!currentDragState) {
                          return
                        }

                        if (!dragState) {
                          setDragState(currentDragState)
                        }

                        event.preventDefault()
                        event.dataTransfer.dropEffect = "move"
                        setDropTarget((current) =>
                          current?.categoryId === columnId &&
                          current.index === items.length
                            ? current
                            : {
                                categoryId: columnId,
                                categoryName: column.name,
                                index: items.length,
                              },
                        )
                      }
                    : undefined
                }
                onDrop={
                  dragEnabled && column.id
                    ? (event) => {
                        const columnId = column.id
                        if (!columnId) {
                          return
                        }

                        const target = event.target
                        if (
                          target instanceof Element &&
                          target.closest("[data-resource-drop-slot='true']")
                        ) {
                          return
                        }

                        const currentDragState =
                          dragState ??
                          resolveDragStateFromDataTransfer(event.dataTransfer)
                        if (!currentDragState) {
                          return
                        }

                        event.preventDefault()
                        void onMoveItem({
                          itemId: currentDragState.itemId,
                          sourceCategoryId: currentDragState.sourceCategoryId,
                          sourceCategoryName: currentDragState.sourceCategoryName,
                          sourceIndex: currentDragState.sourceIndex,
                          targetCategoryId: columnId,
                          targetCategoryName: column.name,
                          targetIndex: items.length,
                        })
                        handleDragEnd()
                      }
                    : undefined
                }
              >
                <DropSlot
                  enabled={dragEnabled && Boolean(column.id)}
                  active={
                    dropTarget?.categoryId === column.id && dropTarget.index === 0
                  }
                  onDragOver={(event) => {
                    const columnId = column.id
                    if (!columnId) {
                      return
                    }

                    const currentDragState =
                      dragState ?? resolveDragStateFromDataTransfer(event.dataTransfer)
                    if (!currentDragState) {
                      return
                    }

                    if (!dragState) {
                      setDragState(currentDragState)
                    }

                    event.preventDefault()
                    event.dataTransfer.dropEffect = "move"
                    setDropTarget((current) =>
                      current?.categoryId === columnId &&
                      current.index === 0
                        ? current
                        : {
                            categoryId: columnId,
                            categoryName: column.name,
                            index: 0,
                          },
                    )
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const currentDragState =
                      dragState ?? resolveDragStateFromDataTransfer(event.dataTransfer)
                    if (!column.id || !currentDragState) {
                      return
                    }

                    void onMoveItem({
                      itemId: currentDragState.itemId,
                      sourceCategoryId: currentDragState.sourceCategoryId,
                      sourceCategoryName: currentDragState.sourceCategoryName,
                      sourceIndex: currentDragState.sourceIndex,
                      targetCategoryId: column.id,
                      targetCategoryName: column.name,
                      targetIndex: 0,
                    })
                    handleDragEnd()
                  }}
                />

                {items.map((resource, index) => {
                  const resolvedCategoryId =
                    resource.categoryId ?? column.id ?? null
                  const canDrag =
                    dragEnabled &&
                    Boolean(resolvedCategoryId) &&
                    canManageResource(resource)

                  return (
                    <Fragment key={resource.id}>
                      <ResourceCardItem
                        resource={resource}
                        categoryId={resolvedCategoryId}
                        order={resource.order}
                        onDelete={onDelete}
                        onEdit={onEdit}
                        canEditCategory={canEditCategoryByName(resource.category)}
                        onEditCategory={onEditCategory}
                        isDeleting={deletingResourceId === resource.id}
                        canManage={canManageResource(resource)}
                        openLinksInSameTab={openLinksInSameTab}
                        canDragCard={canDrag}
                        isCardDragging={dragState?.itemId === resource.id}
                        onCardDragStart={(event) => {
                          if (!resolvedCategoryId || !canDrag) {
                            event.preventDefault()
                            return
                          }

                          const dragPayload: LinkItemDragPayload = {
                            itemId: resource.id,
                            linkId: resource.links[0]?.id ?? resource.id,
                            sourceCategoryId: resolvedCategoryId,
                            sourceCategoryName: column.name,
                            sourceIndex: index,
                          }
                          setLinkItemDragData(event, dragPayload, resource.id)
                          setDragState({
                            itemId: resource.id,
                            sourceCategoryId: resolvedCategoryId,
                            sourceCategoryName: column.name,
                            sourceIndex: index,
                          })
                          setDropTarget({
                            categoryId: resolvedCategoryId,
                            categoryName: column.name,
                            index,
                          })
                        }}
                        onCardDragEnd={handleDragEnd}
                        canDragLinks={canDrag}
                        onLinkDragStart={(link, event) => {
                          if (!resolvedCategoryId || !canDrag) {
                            event.preventDefault()
                            return
                          }

                          const dragPayload: LinkItemDragPayload = {
                            itemId: resource.id,
                            linkId: link.id,
                            sourceCategoryId: resolvedCategoryId,
                            sourceCategoryName: column.name,
                            sourceIndex: index,
                          }
                          setLinkItemDragData(event, dragPayload, link.url)
                          setDragState({
                            itemId: resource.id,
                            sourceCategoryId: resolvedCategoryId,
                            sourceCategoryName: column.name,
                            sourceIndex: index,
                          })
                          setDropTarget({
                            categoryId: resolvedCategoryId,
                            categoryName: column.name,
                            index,
                          })
                        }}
                        onLinkDragEnd={handleDragEnd}
                      />

                      <DropSlot
                        enabled={dragEnabled && Boolean(column.id)}
                        active={
                          dropTarget?.categoryId === column.id &&
                          dropTarget.index === index + 1
                        }
                        onDragOver={(event) => {
                          const columnId = column.id
                          if (!columnId) {
                            return
                          }

                          const currentDragState =
                            dragState ??
                            resolveDragStateFromDataTransfer(event.dataTransfer)
                          if (!currentDragState) {
                            return
                          }

                          if (!dragState) {
                            setDragState(currentDragState)
                          }

                          event.preventDefault()
                          event.dataTransfer.dropEffect = "move"
                          setDropTarget((current) =>
                            current?.categoryId === columnId &&
                            current.index === index + 1
                              ? current
                              : {
                                  categoryId: columnId,
                                  categoryName: column.name,
                                  index: index + 1,
                                },
                          )
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          const currentDragState =
                            dragState ??
                            resolveDragStateFromDataTransfer(event.dataTransfer)
                          if (!column.id || !currentDragState) {
                            return
                          }

                          void onMoveItem({
                            itemId: currentDragState.itemId,
                            sourceCategoryId: currentDragState.sourceCategoryId,
                            sourceCategoryName: currentDragState.sourceCategoryName,
                            sourceIndex: currentDragState.sourceIndex,
                            targetCategoryId: column.id,
                            targetCategoryName: column.name,
                            targetIndex: index + 1,
                          })
                          handleDragEnd()
                        }}
                      />
                    </Fragment>
                  )
                })}
              </div>
            </section>,
          )
        })}
      </div>
    </div>
  )
}
