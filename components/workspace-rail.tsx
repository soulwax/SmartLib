"use client";

import { useMemo, type ReactNode } from "react";

import type { ResourceWorkspace } from "@/lib/resources";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronRight, Plus, RefreshCw, Settings2 } from "lucide-react";

type WorkspaceRailOrientation = "vertical" | "horizontal";

const WORKSPACE_TONES = [
  {
    background:
      "linear-gradient(145deg, rgba(133, 108, 255, 0.18), rgba(79, 70, 229, 0.42))",
    border: "rgba(153, 140, 255, 0.34)",
    foreground: "rgba(244, 242, 255, 0.98)",
  },
  {
    background:
      "linear-gradient(145deg, rgba(46, 196, 182, 0.18), rgba(15, 118, 110, 0.4))",
    border: "rgba(86, 227, 213, 0.32)",
    foreground: "rgba(240, 255, 252, 0.98)",
  },
  {
    background:
      "linear-gradient(145deg, rgba(255, 159, 67, 0.18), rgba(221, 107, 32, 0.4))",
    border: "rgba(255, 190, 122, 0.34)",
    foreground: "rgba(255, 248, 238, 0.98)",
  },
  {
    background:
      "linear-gradient(145deg, rgba(59, 130, 246, 0.18), rgba(29, 78, 216, 0.42))",
    border: "rgba(125, 181, 255, 0.34)",
    foreground: "rgba(239, 246, 255, 0.98)",
  },
];

interface WorkspaceRailProps {
  workspaces: ResourceWorkspace[];
  activeWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string) => void;
  onCreateWorkspace?: () => void;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  canCustomizeWorkspace?: (workspace: ResourceWorkspace) => boolean;
  canCreateWorkspace?: boolean;
  onRefresh?: () => void;
  resourceCountsByWorkspace?: Record<string, number>;
  orientation?: WorkspaceRailOrientation;
  isLoading?: boolean;
  compactMode?: boolean;
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

function workspaceTone(workspaceName: string) {
  const hash = workspaceName
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);

  return WORKSPACE_TONES[hash % WORKSPACE_TONES.length];
}

export function WorkspaceRail({
  workspaces,
  activeWorkspaceId,
  onWorkspaceChange,
  onCreateWorkspace,
  onOpenWorkspaceSettings,
  canCustomizeWorkspace,
  canCreateWorkspace = false,
  onRefresh,
  resourceCountsByWorkspace = {},
  orientation = "vertical",
  isLoading = false,
  compactMode = false,
}: WorkspaceRailProps) {
  const isVertical = orientation === "vertical";
  const workspaceButtonSizeClass = compactMode ? "h-8 w-8" : "h-9 w-9";
  const renderAsList = isVertical && !compactMode;

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

  const workspaceGroups = useMemo(() => {
    const shared = sortedWorkspaces.filter((workspace) => !workspace.ownerUserId);
    const personal = sortedWorkspaces.filter((workspace) => workspace.ownerUserId);

    return [
      {
        id: "shared",
        label: "Shared",
        workspaces: shared,
      },
      {
        id: "personal",
        label: "Mine",
        workspaces: personal,
      },
    ].filter((group) => group.workspaces.length > 0);
  }, [sortedWorkspaces]);

  const showLoadingState = isLoading && sortedWorkspaces.length === 0;
  const skeletonCount = isVertical ? 5 : 6;
  const activeWorkspace =
    sortedWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  const canCustomizeTargetWorkspace = (workspace: ResourceWorkspace): boolean =>
    onOpenWorkspaceSettings
      ? (canCustomizeWorkspace?.(workspace) ?? Boolean(workspace.ownerUserId))
      : false;

  const wrapWorkspaceItemMenu = (
    workspace: ResourceWorkspace,
    content: ReactNode,
  ) => (
    <ContextMenu key={workspace.id}>
      <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>{workspace.name}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onWorkspaceChange(workspace.id)}>
          Open collection
        </ContextMenuItem>
        {canCustomizeTargetWorkspace(workspace) ? (
          <ContextMenuItem
            onSelect={() => onOpenWorkspaceSettings?.(workspace.id)}
          >
            <Settings2 className="mr-2 h-4 w-4" />
            Customize collection
          </ContextMenuItem>
        ) : null}
        {canCreateWorkspace && onCreateWorkspace ? (
          <ContextMenuItem onSelect={onCreateWorkspace}>
            <Plus className="mr-2 h-4 w-4" />
            New collection
          </ContextMenuItem>
        ) : null}
        {onRefresh ? (
          <ContextMenuItem onSelect={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh library
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn("flex h-full flex-col", !isVertical ? "w-full" : undefined)}>
          {renderAsList ? (
            <div className="border-b border-border/70 px-2.5 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground/80">
                    Workspaces
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Collections inside the active organization
                  </p>
                </div>
                <span className="rounded-full border border-border/70 bg-secondary/65 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {sortedWorkspaces.length}
                </span>
              </div>
            </div>
          ) : null}

          <ScrollArea className={cn("h-full", !isVertical ? "w-full" : undefined)}>
            <div
              className={cn(
                renderAsList
                  ? "flex flex-col gap-3 px-1.5 py-2"
                  : compactMode
                    ? "flex gap-1 p-1.5"
                    : "flex gap-1.5 p-2",
                isVertical && !renderAsList ? "h-full flex-col items-center" : undefined,
                !isVertical ? "items-center" : undefined,
              )}
            >
          {showLoadingState ? (
            Array.from({ length: skeletonCount }, (_, index) => (
              <Skeleton
                key={`workspace-skeleton-${index}`}
                className={cn(
                  renderAsList ? "h-14 w-full rounded-2xl" : workspaceButtonSizeClass,
                  renderAsList ? undefined : "rounded-full",
                  !isVertical ? "shrink-0" : undefined,
                )}
              />
            ))
          ) : renderAsList ? (
            workspaceGroups.map((group) => (
              <div key={group.id} className="space-y-1">
                <div className="flex items-center gap-2 px-1.5">
                  <span className="text-[0.58rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground/70">
                    {group.label}
                  </span>
                  <span className="h-px flex-1 bg-border/70" />
                </div>

                <div className="flex flex-col gap-1">
                  {group.workspaces.map((workspace) => {
                    const isActive = workspace.id === activeWorkspaceId;
                    const badge = workspaceBadge(workspace.name);
                    const tone = workspaceTone(workspace.name);
                    const count = resourceCountsByWorkspace[workspace.id] ?? 0;
                    const workspaceMeta = workspace.ownerUserId
                      ? "Private"
                      : "Shared";

                    return wrapWorkspaceItemMenu(
                      workspace,
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => onWorkspaceChange(workspace.id)}
                            aria-current={isActive ? "page" : undefined}
                            aria-label={workspace.name}
                            className={cn(
                              "group/workspace relative flex items-center gap-2.5 rounded-r-xl border-l-2 px-2 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              isActive
                                ? "border-primary bg-gradient-to-r from-primary/14 via-primary/6 to-transparent text-foreground"
                                : "border-transparent text-muted-foreground hover:border-primary/40 hover:bg-accent/18 hover:text-foreground",
                            )}
                          >
                            <span
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[0.62rem] font-bold uppercase tracking-[0.16em]"
                              style={{
                                background: tone.background,
                                borderColor: tone.border,
                                color: tone.foreground,
                              }}
                            >
                              {badge}
                            </span>

                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[0.92rem] font-semibold leading-tight text-foreground">
                                {workspace.name}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-[0.56rem] uppercase tracking-[0.16em] text-muted-foreground/80">
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 shrink-0 rounded-full",
                                    workspace.ownerUserId ? "bg-primary/70" : "bg-emerald-500/80",
                                  )}
                                />
                                {workspaceMeta}
                              </span>
                            </span>

                            <span className="flex shrink-0 items-center gap-1.5">
                              <span className="rounded-full border border-border/70 bg-secondary/70 px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                {count}
                              </span>
                              <ChevronRight
                                className={cn(
                                  "h-3.5 w-3.5 transition-transform",
                                  isActive
                                    ? "translate-x-0 text-primary"
                                    : "translate-x-[-2px] text-muted-foreground/60 group-hover/workspace:translate-x-0 group-hover/workspace:text-foreground/80",
                                )}
                              />
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {workspace.name} - {count} resource{count === 1 ? "" : "s"}
                        </TooltipContent>
                      </Tooltip>,
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            sortedWorkspaces.map((workspace) => {
              const isActive = workspace.id === activeWorkspaceId;
              const badge = workspaceBadge(workspace.name);
              const count = resourceCountsByWorkspace[workspace.id] ?? 0;
              const isSharedWorkspace = !workspace.ownerUserId;

              return wrapWorkspaceItemMenu(
                workspace,
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onWorkspaceChange(workspace.id)}
                      aria-current={isActive ? "page" : undefined}
                      aria-label={workspace.name}
                      className={cn(
                        "group/workspace relative flex items-center justify-center overflow-hidden border text-xs font-semibold transition-all",
                        workspaceButtonSizeClass,
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "rounded-xl border-primary bg-primary text-primary-foreground shadow-sm"
                          : "rounded-full border-border bg-secondary text-secondary-foreground hover:rounded-xl hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <span>{badge}</span>
                      {compactMode && isVertical ? (
                        <span className="pointer-events-none absolute left-[calc(100%+0.45rem)] top-1/2 z-20 hidden -translate-y-1/2 whitespace-nowrap rounded-sm border border-border/70 bg-popover px-1.5 py-0.5 text-[10px] font-medium text-popover-foreground opacity-0 transition-opacity group-hover/workspace:opacity-100 group-focus-visible/workspace:opacity-100 md:block">
                          {workspace.name}
                        </span>
                      ) : null}
                      {isSharedWorkspace ? (
                        <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-card bg-emerald-500" />
                      ) : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side={isVertical ? "right" : "bottom"}>
                    {workspace.name} - {count} resource{count === 1 ? "" : "s"}
                  </TooltipContent>
                </Tooltip>,
              );
            })
          )}

          {canCreateWorkspace ? (
            renderAsList ? (
              <button
                type="button"
                onClick={onCreateWorkspace}
                className="group/workspace relative flex w-full items-center gap-2.5 rounded-r-xl border-l-2 border-dashed border-border/70 px-2 py-2 text-left text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/16 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Create workspace"
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border/70 bg-secondary/45 text-muted-foreground transition-colors group-hover/workspace:border-primary/40 group-hover/workspace:text-foreground">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.92rem] font-semibold leading-tight text-foreground">
                    Add workspace
                  </span>
                  <span className="mt-0.5 block text-[0.56rem] uppercase tracking-[0.16em] text-muted-foreground/80">
                    Create a new collection
                  </span>
                </span>
              </button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disableTooltip
                    className={cn(
                      workspaceButtonSizeClass,
                      "rounded-full border border-dashed border-border text-muted-foreground transition-all hover:rounded-xl hover:text-foreground",
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
            )
          ) : null}
            </div>
          </ScrollArea>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56">
        <ContextMenuLabel>Workspace list</ContextMenuLabel>
        <ContextMenuSeparator />
        {canCreateWorkspace && onCreateWorkspace ? (
          <ContextMenuItem onSelect={onCreateWorkspace}>
            <Plus className="mr-2 h-4 w-4" />
            New collection
          </ContextMenuItem>
        ) : null}
        {activeWorkspace && canCustomizeTargetWorkspace(activeWorkspace) ? (
          <ContextMenuItem
            onSelect={() => onOpenWorkspaceSettings?.(activeWorkspace.id)}
          >
            <Settings2 className="mr-2 h-4 w-4" />
            Customize current collection
          </ContextMenuItem>
        ) : null}
        {onRefresh ? (
          <ContextMenuItem onSelect={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh library
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
