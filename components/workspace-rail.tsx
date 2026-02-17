"use client";

import { useMemo } from "react";

import type { ResourceWorkspace } from "@/lib/resources";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus } from "lucide-react";

type WorkspaceRailOrientation = "vertical" | "horizontal";

interface WorkspaceRailProps {
  workspaces: ResourceWorkspace[];
  activeWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string) => void;
  onCreateWorkspace?: () => void;
  canCreateWorkspace?: boolean;
  resourceCountsByWorkspace?: Record<string, number>;
  orientation?: WorkspaceRailOrientation;
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
  canCreateWorkspace = false,
  resourceCountsByWorkspace = {},
  orientation = "vertical",
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

  return (
    <ScrollArea className={cn("h-full", !isVertical ? "w-full" : undefined)}>
      <div
        className={cn(
          "flex gap-2 p-3",
          isVertical ? "h-full flex-col items-center" : "items-center",
        )}
      >
        {sortedWorkspaces.map((workspace) => {
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
                    "relative flex h-11 w-11 items-center justify-center overflow-hidden border text-sm font-semibold transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "rounded-2xl border-primary bg-primary text-primary-foreground shadow-sm"
                      : "rounded-full border-border bg-secondary text-secondary-foreground hover:rounded-2xl hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <span>{badge}</span>
                  {isSharedWorkspace ? (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-card bg-emerald-500" />
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
                  "h-11 w-11 rounded-full border border-dashed border-border text-muted-foreground transition-all hover:rounded-2xl hover:text-foreground",
                  isVertical ? "mt-1" : undefined,
                )}
                onClick={onCreateWorkspace}
                aria-label="Create workspace"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={isVertical ? "right" : "bottom"}>
              Create workspace
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </ScrollArea>
  );
}
