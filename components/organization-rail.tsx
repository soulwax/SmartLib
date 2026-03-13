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
import { FileText, Github, Plus, Settings } from "lucide-react";

type OrganizationRailOrientation = "vertical" | "horizontal";

const PROJECT_GITHUB_URL = "https://github.com/soulwax/lib.bluesix.dev";
const PROJECT_CHANGELOG_URL = "/CHANGELOG.md";
const ORGANIZATION_TONES = [
  {
    background:
      "linear-gradient(145deg, rgba(255, 91, 146, 0.3), rgba(117, 59, 213, 0.72))",
    border: "rgba(255, 159, 194, 0.42)",
    foreground: "rgba(255, 240, 247, 0.98)",
  },
  {
    background:
      "linear-gradient(145deg, rgba(83, 180, 255, 0.32), rgba(36, 95, 219, 0.72))",
    border: "rgba(134, 204, 255, 0.42)",
    foreground: "rgba(240, 248, 255, 0.98)",
  },
  {
    background:
      "linear-gradient(145deg, rgba(88, 222, 181, 0.28), rgba(17, 129, 120, 0.72))",
    border: "rgba(122, 242, 204, 0.4)",
    foreground: "rgba(240, 255, 252, 0.98)",
  },
  {
    background:
      "linear-gradient(145deg, rgba(255, 188, 89, 0.3), rgba(214, 103, 42, 0.72))",
    border: "rgba(255, 213, 146, 0.42)",
    foreground: "rgba(255, 248, 238, 0.98)",
  },
];

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

function organizationTone(organizationName: string) {
  const hash = organizationName
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);

  return ORGANIZATION_TONES[hash % ORGANIZATION_TONES.length];
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
  const buttonSizeClass = compactMode ? "h-8 w-8" : "h-10 w-10";
  const buttonRadiusClass = "rounded-xl";
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
            compactMode ? "flex gap-1 p-1.5" : "flex gap-2 p-2",
            isVertical ? "h-full flex-col items-center" : "items-center",
          )}
        >
          {showLoadingState
            ? Array.from({ length: skeletonCount }, (_, index) => (
                <Skeleton
                  key={`organization-skeleton-${index}`}
                  className={cn(
                    buttonSizeClass,
                    buttonRadiusClass,
                    !isVertical ? "shrink-0" : undefined,
                  )}
                />
              ))
            : sortedOrganizations.map((organization) => {
                const isActive = organization.id === activeOrganizationId;
                const badge = organizationBadge(organization.name);
                const tone = organizationTone(organization.name);

                return (
                  <Tooltip key={organization.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onOrganizationChange(organization.id)}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={organization.name}
                        className={cn(
                          "group/organization relative overflow-hidden border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          !isVertical && !compactMode
                            ? "flex min-w-[10rem] items-center gap-2 rounded-2xl px-3 py-2 text-left"
                            : cn(
                                buttonSizeClass,
                                buttonRadiusClass,
                                "flex items-center justify-center",
                              ),
                          isActive
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        {!isVertical && !compactMode ? (
                          <>
                            <span
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[0.62rem] font-bold uppercase tracking-[0.18em]"
                              style={{
                                background: tone.background,
                                borderColor: tone.border,
                                color: tone.foreground,
                              }}
                            >
                              {badge}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {organization.name}
                            </span>
                          </>
                        ) : (
                          <span
                            className="inline-flex h-full w-full items-center justify-center text-[0.68rem] font-bold uppercase tracking-[0.2em]"
                            style={{
                              background: isActive ? undefined : tone.background,
                              color: isActive ? undefined : tone.foreground,
                            }}
                          >
                            {badge}
                          </span>
                        )}

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
                    buttonRadiusClass,
                    "border border-dashed border-border text-muted-foreground transition-all hover:text-foreground",
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
                asChild
                variant="ghost"
                size="icon"
                disableTooltip
                className={cn(
                  buttonSizeClass,
                  buttonRadiusClass,
                  "border border-border text-muted-foreground transition-all hover:text-foreground",
                )}
                aria-label="Open project changelog"
              >
                <a
                  href={PROJECT_CHANGELOG_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText className="h-3.5 w-3.5" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">View changelog</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                disableTooltip
                className={cn(
                  buttonSizeClass,
                  buttonRadiusClass,
                  "border border-border text-muted-foreground transition-all hover:text-foreground",
                  compactMode ? "mt-1" : "mt-1.5",
                )}
                aria-label="Open project GitHub repository"
              >
                <a
                  href={PROJECT_GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Github className="h-3.5 w-3.5" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">View on GitHub</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disableTooltip
                className={cn(
                  buttonSizeClass,
                  buttonRadiusClass,
                  "border border-border text-muted-foreground transition-all hover:text-foreground",
                  compactMode ? "mt-1" : "mt-1.5",
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
              "mt-1 select-none leading-none tracking-wide text-muted-foreground/50",
              compactMode ? "text-[8px]" : "text-[9px]",
            )}
          >
            v{pkg.version}
          </span>
        </div>
      ) : null}
    </div>
  );
}
