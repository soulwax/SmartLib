"use client"

import React from "react"
import { Check } from "lucide-react"
import { toast } from "sonner"

import { useColorScheme } from "@/components/color-scheme-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ColorSchemeDefinition, ColorSchemeId } from "@/lib/color-schemes"

function hslColor(token: string): string {
  return `hsl(${token.trim()})`
}

function isSchemeLight(scheme: ColorSchemeDefinition): boolean {
  // background token format: "H S% L%" — lightness >= 50 indicates a light theme
  const parts = scheme.tokens.background.trim().split(/\s+/)
  const lightness = parseFloat(parts[2] ?? "0")
  return lightness >= 50
}

function Swatches({ scheme }: { scheme: ColorSchemeDefinition }) {
  return (
    <span
      className="flex shrink-0 overflow-hidden rounded-sm border border-white/10"
      style={{ width: 36, height: 12 }}
      aria-hidden
    >
      <span className="flex-1" style={{ background: hslColor(scheme.tokens.background) }} />
      <span className="flex-1" style={{ background: hslColor(scheme.tokens.primary) }} />
      <span className="flex-1" style={{ background: hslColor(scheme.tokens.accent) }} />
    </span>
  )
}

function SchemeItem({
  scheme,
  isSelected,
  onSelect,
}: {
  scheme: ColorSchemeDefinition
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      className="flex cursor-pointer items-center gap-2 px-2 py-1.5"
      onSelect={onSelect}
    >
      <Swatches scheme={scheme} />
      <span className="flex-1 text-xs leading-none">{scheme.name}</span>
      {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
    </DropdownMenuItem>
  )
}

interface PaletteDropdownProps {
  children: React.ReactNode
  align?: "start" | "center" | "end"
  sideOffset?: number
}

export function PaletteDropdown({
  children,
  align = "end",
  sideOffset = 4,
}: PaletteDropdownProps) {
  const { schemes, currentColorSchemeId, setColorSchemeById, isSaving, isLoading } =
    useColorScheme()

  const darkSchemes = schemes.filter((s) => !isSchemeLight(s))
  const lightSchemes = schemes.filter(isSchemeLight)

  async function handleSelect(id: string) {
    const saved = await setColorSchemeById(id as ColorSchemeId, { persist: true })
    if (!saved) {
      toast.error("Theme not saved", {
        description: "Applied locally but could not persist your preference.",
      })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={sideOffset}
        className="max-h-[22rem] w-52 overflow-y-auto"
      >
        <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Dark Themes
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {darkSchemes.map((scheme) => (
            <SchemeItem
              key={scheme.id}
              scheme={scheme}
              isSelected={currentColorSchemeId === scheme.id}
              onSelect={() => void handleSelect(scheme.id)}
            />
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Light Themes
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {lightSchemes.map((scheme) => (
            <SchemeItem
              key={scheme.id}
              scheme={scheme}
              isSelected={currentColorSchemeId === scheme.id}
              onSelect={() => void handleSelect(scheme.id)}
            />
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
          {isSaving ? "Saving preference…" : isLoading ? "Loading…" : "Preference synced"}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
