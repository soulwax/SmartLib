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
import { ChevronRight, FileText, Github, Plus, Settings } from "lucide-react";

type OrganizationRailOrientation = "vertical" | "horizontal";
const PROJECT_GITHUB_URL = "https://github.com/soulwax/lib.bluesix.dev";
const PROJECT_CHANGELOG_URL = "/CHANGELOG.md";
const ORGANIZATION_TONES = [
  {
    background: "linear-gradient(145deg, rgba(255, 91, 146, 0.3), rgba(117, 59, 213, 0.72))",
    border: "rgba(255, 159, 194, 0.42)",
    foreground: "rgba(255, 240, 247, 0.98)",
  },
  {
    background: "linear-gradient(145deg, rgba(83, 180, 255, 0.32), rgba(36, 95, 219, 0.72))",
    border: "rgba(134, 204, 255, 0.42)",
    foreground: "rgba(240, 248, 255, 0.98)",
  },
  {
    background: "linear-gradient(145deg, rgba(88, 222, 181, 0.28), rgba(17, 129, 120, 0.72))",
    border: "rgba(122, 242, 204, 0.4)",
    foreground: "rgba(240, 255, 252, 0.98)",
  },
  {
    background: "linear-gradient(145deg, rgba(255, 188, 89, 0.3), rgba(214, 103, 42, 0.72))",
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
  const buttonSizeClass = compactMode ? "h-8 w-8" : "h-9 w-9";
  const buttonRadiusClass = "rounded-xl";
  const renderAsList = isVertical && !compactMode;
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
      {renderAsList ? (
        <div className="border-b border-border/70 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground/80">
                Organizations
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Shared and personal library roots
              </p>
            </div>
            <span className="rounded-full border border-border/70 bg-secondary/65 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {sortedOrganizations.length}
            </span>
          </div>
        </div>
      ) : null}

      <ScrollArea className={cn("h-full", !isVertical ? "w-full" : undefined)}>
        <div
          className={cn(
            renderAsList
              ? "flex flex-col gap-1.5 px-2 py-3"
              : compactMode
                ? "flex gap-1 p-1.5"
                : "flex gap-1.5 p-2",
            isVertical && !renderAsList ? "h-full flex-col items-center" : undefined,
            !isVertical ? "items-center" : undefined,
          )}
        >
          {showLoadingState
            ? Array.from({ length: skeletonCount }, (_, index) => (
                <Skeleton
                  key={`organization-skeleton-${index}`}
                  className={cn(
                    renderAsList
                      ? "h-14 w-full rounded-2xl"
                      : buttonSizeClass,
                    !renderAsList ? buttonRadiusClass : undefined,
                    !isVertical ? "shrink-0" : undefined,
                  )}
                />
              ))
            : sortedOrganizations.map((organization) => {
                const isActive = organization.id === activeOrganizationId;
                const badge = organizationBadge(organization.name);
                const tone = organizationTone(organization.name);
                const organizationMeta = organization.ownerUserId
                  ? "Private space"
                  : "Shared space";

                return (
                  <Tooltip key={organization.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onOrganizationChange(organization.id)}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={organization.name}
                        className={cn(
                          "group/organization relative transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          renderAsList
                            ? isActive
                              ? "rounded-r-2xl border-l-2 border-primary bg-gradient-to-r from-primary/14 via-primary/6 to-transparent px-3 py-3 text-foreground"
                              : "rounded-r-2xl border-l-2 border-transparent px-3 py-3 text-muted-foreground hover:border-primary/40 hover:bg-accent/18 hover:text-foreground"
                            : !isVertical
                              ? cn(
                                  "flex min-w-[10rem] items-center gap-2 rounded-2xl border px-3 py-2 text-left",
                                  isActive
                                    ? "border-primary bg-primary/12 text-foreground shadow-sm"
                                    : "border-border bg-secondary/55 text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
                                )
                              : isActive
                                ? cn(
                                    buttonRadiusClass,
                                    buttonSizeClass,
                                    "flex items-center justify-center overflow-hidden border border-primary bg-primary text-primary-foreground shadow-sm",
                                  )
                                : cn(
                                    buttonRadiusClass,
                                    buttonSizeClass,
                                    "flex items-center justify-center overflow-hidden border border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
                                  ),
                        )}
                      >
                        {renderAsList ? (
                          <>
                            <span
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[0.68rem] font-bold uppercase tracking-[0.2em]"
                              style={{
                                background: tone.background,
                                borderColor: tone.border,
                                color: tone.foreground,
                              }}
                            >
                              {badge}
                            </span>
                            <span className="min-w-0 flex-1 text-left">
                              <span className="block truncate text-sm font-semibold text-foreground">
                                {organization.name}
                              </span>
                              <span className="mt-0.5 flex items-center gap-2 text-[0.64rem] uppercase tracking-[0.2em] text-muted-foreground/85">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                                {organizationMeta}
                              </span>
                            </span>
                            <ChevronRight
                              className={cn(
                                "h-4 w-4 shrink-0 transition-transform",
                                isActive
                                  ? "translate-x-0 text-primary"
                                  : "translate-x-[-2px] text-muted-foreground/60 group-hover/organization:translate-x-0 group-hover/organization:text-foreground/80",
                              )}
                            />
                          </>
                        ) : !isVertical ? (
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
                          <span>{badge}</span>
                        )}
                        {compactMode && isVertical && !renderAsList ? (
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
            renderAsList ? (
              <button
                type="button"
                onClick={onCreateOrganization}
                className="group/organization relative flex w-full items-center gap-3 rounded-r-2xl border-l-2 border-dashed border-border/70 px-3 py-3 text-left text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/16 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Create organization"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border/70 bg-secondary/45 text-muted-foreground transition-colors group-hover/organization:border-primary/40 group-hover/organization:text-foreground">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    Add organization
                  </span>
                  <span className="mt-0.5 block text-[0.64rem] uppercase tracking-[0.2em] text-muted-foreground/85">
                    Create a new root space
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
                      !renderAsList ? buttonSizeClass : undefined,
                      !renderAsList ? buttonRadiusClass : undefined,
                      !renderAsList
                        ? "border border-dashed border-border text-muted-foreground transition-all hover:text-foreground"
                        : undefined,
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
            )
          ) : null}
        </div>
      </ScrollArea>

      {showSettingsButton && isVertical ? (
        <div
          className={cn(
            renderAsList
              ? "mt-auto border-t border-border/70 px-2 py-3"
              : "mt-auto flex flex-col items-center border-t border-border/70",
            !renderAsList ? (compactMode ? "pb-1 pt-1" : "pb-2 pt-2") : undefined,
          )}
        >
          {renderAsList ? (
            <div className="space-y-1">
              <a
                href={PROJECT_CHANGELOG_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group/organization flex w-full items-center gap-3 rounded-r-2xl border-l-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/35 hover:bg-accent/16 hover:text-foreground"
              >
                <FileText className="h-4 w-4 shrink-0" />
                Changelog
              </a>
              <a
                href={PROJECT_GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group/organization flex w-full items-center gap-3 rounded-r-2xl border-l-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/35 hover:bg-accent/16 hover:text-foreground"
              >
                <Github className="h-4 w-4 shrink-0" />
                GitHub
              </a>
              <button
                type="button"
                onClick={onOpenSettings}
                className="group/organization flex w-full items-center gap-3 rounded-r-2xl border-l-2 border-transparent px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:border-primary/35 hover:bg-accent/16 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings className="h-4 w-4 shrink-0" />
                Settings
              </button>
            </div>
          ) : (
            <>
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
            </>
          )}
          <span
            className={cn(
              "select-none leading-none tracking-wide text-muted-foreground/50",
              renderAsList
                ? "mt-3 block px-3 text-[0.62rem] uppercase tracking-[0.22em]"
                : compactMode
                  ? "mt-0.5 text-[8px]"
                  : "mt-1 text-[9px]",
            )}
          >
            v{pkg.version}
          </span>
        </div>
      ) : null}
    </div>
  );
}
