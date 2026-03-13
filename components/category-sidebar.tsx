"use client";

import { useCallback, useMemo, useState } from "react";
import {
  LINK_ITEM_DRAG_MIME,
  parseLinkItemDragPayload,
} from "@/lib/link-item-drag";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Globe,
  Code2,
  Cpu,
  Gamepad2,
  Sigma,
  Network,
  Server,
  Database,
  ShieldCheck,
  Layers,
  ClipboardPaste,
  Copy,
  FolderPlus,
  Search,
  Pencil,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  All: Layers,
  General: Globe,
  "C++": Code2,
  Rust: Code2,
  Go: Code2,
  TypeScript: Code2,
  Python: Code2,
  "Graphics / GPU": Cpu,
  "Game Engines": Gamepad2,
  Math: Sigma,
  Networking: Network,
  DevOps: Server,
  Databases: Database,
  Security: ShieldCheck,
};

interface CategorySidebarProps {
  categories: string[];
  activeCategory: string | "All";
  onCategoryChange: (cat: string | "All") => void;
  resourceCounts: Record<string, number>;
  categorySymbols?: Record<string, string | undefined>;
  canManageCategories?: boolean;
  onCreateCategory?: () => void;
  canEditCategory?: (category: string) => boolean;
  onEditCategory?: (category: string) => void;
  onDeleteCategory?: (category: string) => void;
  canPasteIntoCategory?: boolean;
  onPasteIntoCategory?: (category: string) => void;
  canDropLinkItems?: boolean;
  onDropLinkItemToCategory?: (input: {
    itemId: string;
    linkId: string;
    sourceCategoryId: string;
    sourceCategoryName: string;
    sourceIndex: number;
    targetCategory: string;
  }) => void;
  onOpenWorkspaceSettings?: () => void;
  showHeading?: boolean;
  compactHeading?: boolean;
  headingLabel?: string;
  headingMeta?: string;
  headingCount?: number;
  roleHint?: string | null;
  isLoading?: boolean;
}

function resolveCategoryIcon(category: string): LucideIcon {
  const direct = CATEGORY_ICONS[category];
  if (direct) {
    return direct;
  }

  const segments = category.split("/").map((segment) => segment.trim());
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segmentIcon = CATEGORY_ICONS[segments[index]];
    if (segmentIcon) {
      return segmentIcon;
    }
  }

  return Globe;
}

export function CategorySidebar({
  categories,
  activeCategory,
  onCategoryChange,
  resourceCounts,
  categorySymbols = {},
  canManageCategories = false,
  onCreateCategory,
  canEditCategory,
  onEditCategory,
  onDeleteCategory,
  canPasteIntoCategory = false,
  onPasteIntoCategory,
  canDropLinkItems = false,
  onDropLinkItemToCategory,
  onOpenWorkspaceSettings,
  showHeading = true,
  compactHeading = false,
  headingLabel = "Categories",
  headingMeta,
  headingCount,
  roleHint,
  isLoading = false,
}: CategorySidebarProps) {
  const [categoryFilter, setCategoryFilter] = useState("");
  const copyText = useCallback(async (value: string, label: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard unavailable");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success(label);
    } catch {
      toast.error("Could not copy text to clipboard.");
    }
  }, []);

  const categoryItems = [
    "All",
    ...categories.filter((category) => category !== "All"),
  ];
  const normalizedCategoryFilter = categoryFilter.trim().toLowerCase();
  const filteredCategoryItems = useMemo(() => {
    if (!normalizedCategoryFilter) {
      return categoryItems;
    }

    return categoryItems.filter((category) => {
      if (category === "All") {
        return true;
      }

      const symbol = categorySymbols[category];
      return (
        category.toLowerCase().includes(normalizedCategoryFilter) ||
        symbol?.toLowerCase().includes(normalizedCategoryFilter)
      );
    });
  }, [categoryItems, categorySymbols, normalizedCategoryFilter]);
  const showLoadingState = isLoading && categories.length === 0;
  const readDraggedLinkItem = useCallback(
    (event: React.DragEvent<HTMLElement>) =>
      parseLinkItemDragPayload(
        event.dataTransfer.getData(LINK_ITEM_DRAG_MIME),
      ),
    [],
  );

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-4">
        {showHeading ? (
          <div
            className={cn(
              "mb-3 px-1",
              compactHeading ? "space-y-1.5" : "space-y-2",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p
                className={cn(
                  "section-title-pill",
                  compactHeading ? "gap-1.5 px-2.5 py-0.5 text-[0.62rem]" : "",
                )}
              >
                <Layers className="h-3.5 w-3.5 text-primary" />
                {headingLabel}
              </p>
              {typeof headingCount === "number" ? (
                <span className="section-title-badge">{headingCount}</span>
              ) : null}
            </div>
            {headingMeta ? (
              <p className="section-title-meta">{headingMeta}</p>
            ) : null}
            {roleHint ? <p className="section-title-hint">{roleHint}</p> : null}
          </div>
        ) : null}
        {!showLoadingState && categoryItems.length > 0 ? (
          <div className="mb-3 px-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                type="search"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                placeholder="Filter categories"
                className="h-9 rounded-xl border-border/70 bg-secondary/40 pl-9 pr-9 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
                aria-label="Filter categories"
              />
              {categoryFilter ? (
                <button
                  type="button"
                  onClick={() => setCategoryFilter("")}
                  className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Clear category filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {showLoadingState
          ? Array.from({ length: 7 }, (_, index) => (
              <div
                key={`category-skeleton-${index}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2"
              >
                <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-3 w-8 shrink-0 rounded-sm" />
              </div>
            ))
          : filteredCategoryItems.length > 0
            ? filteredCategoryItems.map((cat) => {
              const Icon = resolveCategoryIcon(cat);
              const isActive = activeCategory === cat;
              const isEditableByOwner =
                cat !== "All" && (canEditCategory?.(cat) ?? false);
              const symbol = categorySymbols[cat];
              const count =
                cat === "All"
                  ? Object.values(resourceCounts).reduce((a, b) => a + b, 0)
                  : (resourceCounts[cat] ?? 0);

              const tooltipLabel =
                cat === "All"
                  ? `All categories — ${count} resource${count !== 1 ? "s" : ""}`
                  : `${symbol ? `${symbol} ` : ""}${cat} — ${count} resource${count !== 1 ? "s" : ""}`;

              return (
                <ContextMenu key={cat}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => onCategoryChange(cat)}
                            onDragOver={(event) => {
                              if (!canDropLinkItems || cat === "All") {
                                return;
                              }

                              const payload = readDraggedLinkItem(event);
                              if (!payload) {
                                return;
                              }

                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(event) => {
                              if (!canDropLinkItems || cat === "All") {
                                return;
                              }

                              const payload = readDraggedLinkItem(event);
                              if (!payload) {
                                return;
                              }

                              event.preventDefault();
                              onDropLinkItemToCategory?.({
                                itemId: payload.itemId,
                                linkId: payload.linkId,
                                sourceCategoryId: payload.sourceCategoryId,
                                sourceCategoryName: payload.sourceCategoryName,
                                sourceIndex: payload.sourceIndex,
                                targetCategory: cat,
                              });
                            }}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                              "hover:bg-secondary hover:text-foreground",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              isActive
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground",
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            {symbol ? (
                              <span className="shrink-0 text-sm leading-none">
                                {symbol}
                              </span>
                            ) : null}
                            <span className="truncate">{cat}</span>
                            <span
                              className={cn(
                                "ml-auto font-mono text-xs tabular-nums",
                                isActive
                                  ? "text-primary"
                                  : "text-muted-foreground/60",
                              )}
                            >
                              {count}
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="right"
                          className="flex flex-col gap-0.5"
                        >
                          <span className="font-medium">{tooltipLabel}</span>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </ContextMenuTrigger>

                  <ContextMenuContent className="w-56">
                    <ContextMenuLabel>
                      {symbol ? `${symbol} ` : ""}
                      {cat}
                    </ContextMenuLabel>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onCategoryChange(cat)}>
                      View this category
                    </ContextMenuItem>
                    {cat !== "All" ? (
                      <ContextMenuItem onSelect={() => onCategoryChange("All")}>
                        View all categories
                      </ContextMenuItem>
                    ) : null}
                    {cat !== "All" && canPasteIntoCategory ? (
                      <ContextMenuItem
                        onSelect={() => onPasteIntoCategory?.(cat)}
                      >
                        <ClipboardPaste className="mr-2 h-4 w-4" />
                        Paste URL into category
                      </ContextMenuItem>
                    ) : null}
                    <ContextMenuItem
                      onSelect={() =>
                        void copyText(cat, "Category name copied to clipboard")
                      }
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy category name
                    </ContextMenuItem>
                    {isEditableByOwner ? (
                      <ContextMenuItem onSelect={() => onEditCategory?.(cat)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit Category
                      </ContextMenuItem>
                    ) : null}

                    {canManageCategories ? (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => onCreateCategory?.()}>
                          <FolderPlus className="mr-2 h-4 w-4" />
                          Create category
                        </ContextMenuItem>
                        {cat !== "All" ? (
                          <ContextMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => onDeleteCategory?.(cat)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete category
                          </ContextMenuItem>
                        ) : null}
                      </>
                    ) : null}
                  </ContextMenuContent>
                </ContextMenu>
              );
            })
            : (
              <div className="rounded-xl border border-dashed border-border/70 bg-secondary/25 px-3 py-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No category matches</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try a shorter filter or clear it to see all categories.
                </p>
              </div>
            )}
        </div>
      </ScrollArea>

      {onOpenWorkspaceSettings ? (
        <div className="border-t border-border/70 p-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={onOpenWorkspaceSettings}
              >
                <Settings className="h-3.5 w-3.5" />
                Collection settings
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Rename or delete this collection
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}
