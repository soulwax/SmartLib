"use client";

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
  onHoverCategoryChange?: (category: string | "All" | null) => void;
  resourceCounts: Record<string, number>;
  categorySymbols?: Record<string, string | undefined>;
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
  onHoverCategoryChange,
  resourceCounts,
  categorySymbols = {},
}: CategorySidebarProps) {
  const categoryItems = [
    "All",
    ...categories.filter((category) => category !== "All"),
  ];

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-1 p-4">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Categories
        </p>
        {categoryItems.map((cat) => {
          const Icon = resolveCategoryIcon(cat);
          const isActive = activeCategory === cat;
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
            <Tooltip key={cat}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onCategoryChange(cat)}
                  onMouseEnter={() => onHoverCategoryChange?.(cat)}
                  onMouseLeave={() => onHoverCategoryChange?.(null)}
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
                      isActive ? "text-primary" : "text-muted-foreground/60",
                    )}
                  >
                    {count}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="flex flex-col gap-0.5">
                <span className="font-medium">{tooltipLabel}</span>
                <span className="text-xs text-muted-foreground">
                  Hover + paste (Ctrl/Cmd+V) to paste a URL
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </ScrollArea>
  );
}
