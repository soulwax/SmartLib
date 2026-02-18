"use client"

import { Fragment, useMemo, useState } from "react"

import type { ResourceCard } from "@/lib/resources"
import { cn } from "@/lib/utils"
import { ResourceCardItem } from "@/components/resource-card"

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
  dragEnabled: boolean
  canManageResource: (resource: ResourceCard) => boolean
  canEditCategoryByName: (category: string) => boolean
  onEditCategory: (category: string) => void
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
      aria-hidden="true"
      onDragOver={enabled ? onDragOver : undefined}
      onDrop={enabled ? onDrop : undefined}
      className={cn(
        "h-2 rounded-md transition-colors",
        enabled
          ? active
            ? "bg-primary/40"
            : "bg-transparent hover:bg-primary/15"
          : "bg-transparent"
      )}
    />
  )
}

export function ResourceBoard({
  columns,
  resources,
  dragEnabled,
  canManageResource,
  canEditCategoryByName,
  onEditCategory,
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

  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const handleDragEnd = () => {
    setDragState(null)
    setDropTarget(null)
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start gap-4">
        {columns.map((column) => {
          const items = resourcesByCategory.get(column.name) ?? []

          return (
            <section
              key={column.name}
              className="flex w-[22rem] shrink-0 flex-col rounded-xl border border-border/70 bg-card/60"
            >
              <header className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <p className="truncate text-sm font-semibold text-foreground">
                  {column.symbol ? `${column.symbol} ` : ""}
                  {column.name}
                </p>
                <span className="rounded-md border border-border/70 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {items.length}
                </span>
              </header>

              <div className="flex min-h-20 flex-1 flex-col gap-2 p-3">
                <DropSlot
                  enabled={dragEnabled && Boolean(dragState && column.id)}
                  active={
                    dropTarget?.categoryId === column.id && dropTarget.index === 0
                  }
                  onDragOver={(event) => {
                    const columnId = column.id
                    if (!columnId || !dragState) {
                      return
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
                          }
                    )
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (!column.id || !dragState) {
                      return
                    }

                    void onMoveItem({
                      itemId: dragState.itemId,
                      sourceCategoryId: dragState.sourceCategoryId,
                      sourceCategoryName: dragState.sourceCategoryName,
                      sourceIndex: dragState.sourceIndex,
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
                        categorySymbol={column.symbol}
                        onDelete={onDelete}
                        onEdit={onEdit}
                        canEditCategory={canEditCategoryByName(resource.category)}
                        onEditCategory={onEditCategory}
                        isDeleting={deletingResourceId === resource.id}
                        canManage={canManageResource(resource)}
                        openLinksInSameTab={openLinksInSameTab}
                        draggable={canDrag}
                        isDragging={dragState?.itemId === resource.id}
                        onDragStart={(event) => {
                          if (!resolvedCategoryId || !canDrag) {
                            event.preventDefault()
                            return
                          }

                          event.dataTransfer.effectAllowed = "move"
                          event.dataTransfer.setData("text/plain", resource.id)
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
                        onDragEnd={handleDragEnd}
                      />

                      <DropSlot
                        enabled={dragEnabled && Boolean(dragState && column.id)}
                        active={
                          dropTarget?.categoryId === column.id &&
                          dropTarget.index === index + 1
                        }
                        onDragOver={(event) => {
                          const columnId = column.id
                          if (!columnId || !dragState) {
                            return
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
                                }
                          )
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          if (!column.id || !dragState) {
                            return
                          }

                          void onMoveItem({
                            itemId: dragState.itemId,
                            sourceCategoryId: dragState.sourceCategoryId,
                            sourceCategoryName: dragState.sourceCategoryName,
                            sourceIndex: dragState.sourceIndex,
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
            </section>
          )
        })}
      </div>
    </div>
  )
}
