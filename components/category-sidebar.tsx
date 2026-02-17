"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Copy,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
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
  onEditCategorySymbol?: (category: string) => void;
  onDeleteCategory?: (category: string) => void;
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
  onEditCategorySymbol,
  onDeleteCategory,
}: CategorySidebarProps) {
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

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-1 p-4">
        <div className="mb-3 px-1">
          <p className="section-title-pill">
            <Layers className="h-3.5 w-3.5 text-primary" />
            Categories
          </p>
        </div>
        {categoryItems.map((cat) => {
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
                <ContextMenuItem
                  onSelect={() =>
                    void copyText(cat, "Category name copied to clipboard")
                  }
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy category name
                </ContextMenuItem>

                {canManageCategories ? (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onCreateCategory?.()}>
                      <FolderPlus className="mr-2 h-4 w-4" />
                      Create category
                    </ContextMenuItem>
                    {isEditableByOwner ? (
                      <ContextMenuItem
                        onSelect={() => onEditCategorySymbol?.(cat)}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit category
                      </ContextMenuItem>
                    ) : null}
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
        })}
      </div>
    </ScrollArea>
  );
}
