"use client";

import { useMemo } from "react";

import pkg from "@/package.json";

import type { ResourceOrganization } from "@/lib/resources";
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

type OrganizationRailOrientation = "vertical" | "horizontal";

interface OrganizationRailProps {
  organizations: ResourceOrganization[];
  activeOrganizationId: string | null;
  onOrganizationChange: (organizationId: string) => void;
  onCreateOrganization?: () => void;
  onOpenSettings?: () => void;
  canCreateOrganization?: boolean;
  showSettingsButton?: boolean;
  orientation?: OrganizationRailOrientation;
  isLoading?: boolean;
  compactMode?: boolean;
}

function organizationBadge(organizationName: string): string {
  const segments = organizationName
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

export function OrganizationRail({
  organizations,
  activeOrganizationId,
  onOrganizationChange,
  onCreateOrganization,
  onOpenSettings,
  canCreateOrganization = false,
  showSettingsButton = false,
  orientation = "vertical",
  isLoading = false,
  compactMode = false,
}: OrganizationRailProps) {
  const isVertical = orientation === "vertical";
  const buttonSizeClass = compactMode ? "h-8 w-8" : "h-9 w-9";
  const sortedOrganizations = useMemo(
    () =>
      [...organizations].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
        }),
      ),
    [organizations],
  );
  const showLoadingState = isLoading && sortedOrganizations.length === 0;
  const skeletonCount = isVertical ? 4 : 5;

  return (
    <div className={cn("flex h-full flex-col", !isVertical ? "w-full" : undefined)}>
      <ScrollArea className={cn("h-full", !isVertical ? "w-full" : undefined)}>
        <div
          className={cn(
            compactMode ? "flex gap-1 p-1.5" : "flex gap-1.5 p-2",
            isVertical ? "h-full flex-col items-center" : "items-center",
          )}
        >
          {showLoadingState
            ? Array.from({ length: skeletonCount }, (_, index) => (
                <Skeleton
                  key={`organization-skeleton-${index}`}
                  className={cn(
                    buttonSizeClass,
                    "rounded-xl",
                    !isVertical ? "shrink-0" : undefined,
                  )}
                />
              ))
            : sortedOrganizations.map((organization) => {
                const isActive = organization.id === activeOrganizationId;
                const badge = organizationBadge(organization.name);

                return (
                  <Tooltip key={organization.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onOrganizationChange(organization.id)}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={organization.name}
                        className={cn(
                          "group/organization relative flex items-center justify-center overflow-hidden border text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          buttonSizeClass,
                          isActive
                            ? "rounded-xl border-primary bg-primary text-primary-foreground shadow-sm"
                            : "rounded-xl border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        <span>{badge}</span>
                        {compactMode && isVertical ? (
                          <span className="pointer-events-none absolute left-[calc(100%+0.45rem)] top-1/2 z-20 hidden -translate-y-1/2 whitespace-nowrap rounded-sm border border-border/70 bg-popover px-1.5 py-0.5 text-[10px] font-medium text-popover-foreground opacity-0 transition-opacity group-hover/organization:opacity-100 group-focus-visible/organization:opacity-100 md:block">
                            {organization.name}
                          </span>
                        ) : null}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side={isVertical ? "right" : "bottom"}>
                      {organization.name}
                    </TooltipContent>
                  </Tooltip>
                );
              })}

          {canCreateOrganization ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disableTooltip
                  className={cn(
                    buttonSizeClass,
                    "rounded-xl border border-dashed border-border text-muted-foreground transition-all hover:text-foreground",
                    isVertical ? "mt-1" : undefined,
                  )}
                  onClick={onCreateOrganization}
                  aria-label="Create organization"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isVertical ? "right" : "bottom"}>
                Create organization
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </ScrollArea>

      {showSettingsButton && isVertical ? (
        <div
          className={cn(
            "mt-auto flex flex-col items-center border-t border-border/70",
            compactMode ? "pb-1 pt-1" : "pb-2 pt-2",
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disableTooltip
                className={cn(
                  buttonSizeClass,
                  "rounded-xl border border-border text-muted-foreground transition-all hover:text-foreground",
                )}
                onClick={onOpenSettings}
                aria-label="Open general settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">General settings</TooltipContent>
          </Tooltip>
          <span
            className={cn(
              "select-none leading-none tracking-wide text-muted-foreground/50",
              compactMode ? "mt-0.5 text-[8px]" : "mt-1 text-[9px]",
            )}
          >
            v{pkg.version}
          </span>
        </div>
      ) : null}
    </div>
  );
}
