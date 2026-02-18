"use client";

import { useMemo } from "react";

import pkg from "@/package.json";

import type { ResourceWorkspace } from "@/lib/resources";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Settings } from "lucide-react";

type WorkspaceRailOrientation = "vertical" | "horizontal";

interface WorkspaceRailProps {
  workspaces: ResourceWorkspace[];
  activeWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string) => void;
  onCreateWorkspace?: () => void;
  onOpenSettings?: () => void;
  canCreateWorkspace?: boolean;
  showSettingsButton?: boolean;
  resourceCountsByWorkspace?: Record<string, number>;
  orientation?: WorkspaceRailOrientation;
  isLoading?: boolean;
}

function workspaceBadge(workspaceName: string): string {
  const segments = workspaceName
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return "??";
  }

  const initials = segments
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "??";
}

export function WorkspaceRail({
  workspaces,
  activeWorkspaceId,
  onWorkspaceChange,
  onCreateWorkspace,
  onOpenSettings,
  canCreateWorkspace = false,
  showSettingsButton = false,
  resourceCountsByWorkspace = {},
  orientation = "vertical",
  isLoading = false,
}: WorkspaceRailProps) {
  const isVertical = orientation === "vertical";

  const sortedWorkspaces = useMemo(() => {
    return [...workspaces].sort((left, right) => {
      const leftIsShared = !left.ownerUserId;
      const rightIsShared = !right.ownerUserId;
      if (leftIsShared !== rightIsShared) {
        return leftIsShared ? -1 : 1;
      }

      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      });
    });
  }, [workspaces]);
  const showLoadingState = isLoading && sortedWorkspaces.length === 0;
  const skeletonCount = isVertical ? 5 : 6;

  return (
    <div className={cn("flex h-full flex-col", !isVertical ? "w-full" : undefined)}>
      <ScrollArea className={cn("h-full", !isVertical ? "w-full" : undefined)}>
        <div
          className={cn(
            "flex gap-1.5 p-2",
            isVertical ? "h-full flex-col items-center" : "items-center",
          )}
        >
          {showLoadingState
            ? Array.from({ length: skeletonCount }, (_, index) => (
                <Skeleton
                  key={`workspace-skeleton-${index}`}
                  className={cn(
                    "h-9 w-9 rounded-full",
                    !isVertical ? "shrink-0" : undefined,
                  )}
                />
              ))
            : sortedWorkspaces.map((workspace) => {
                const isActive = workspace.id === activeWorkspaceId;
                const badge = workspaceBadge(workspace.name);
                const count = resourceCountsByWorkspace[workspace.id] ?? 0;
                const isSharedWorkspace = !workspace.ownerUserId;

                return (
                  <Tooltip key={workspace.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onWorkspaceChange(workspace.id)}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={workspace.name}
                        className={cn(
                          "relative flex h-9 w-9 items-center justify-center overflow-hidden border text-xs font-semibold transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isActive
                            ? "rounded-xl border-primary bg-primary text-primary-foreground shadow-sm"
                            : "rounded-full border-border bg-secondary text-secondary-foreground hover:rounded-xl hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        <span>{badge}</span>
                        {isSharedWorkspace ? (
                          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-card bg-emerald-500" />
                        ) : null}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side={isVertical ? "right" : "bottom"}>
                      {workspace.name} - {count} resource{count === 1 ? "" : "s"}
                    </TooltipContent>
                  </Tooltip>
                );
              })}

          {canCreateWorkspace ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-9 w-9 rounded-full border border-dashed border-border text-muted-foreground transition-all hover:rounded-xl hover:text-foreground",
                    isVertical ? "mt-1" : undefined,
                  )}
                  onClick={onCreateWorkspace}
                  aria-label="Create workspace"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isVertical ? "right" : "bottom"}>
                Create workspace
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </ScrollArea>

      {showSettingsButton && isVertical ? (
        <div className="mt-auto flex flex-col items-center border-t border-border/70 pb-2 pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full border border-border text-muted-foreground transition-all hover:rounded-xl hover:text-foreground"
                onClick={onOpenSettings}
                aria-label="Open general settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">General settings</TooltipContent>
          </Tooltip>
          <span className="mt-1 select-none text-[9px] leading-none tracking-wide text-muted-foreground/50">
            v{pkg.version}
          </span>
        </div>
      ) : null}
    </div>
  );
}
