import React from "react";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";

import { auth } from "@/auth";
import { AuthProvider } from "@/components/auth-provider";
import { ColorSchemeProvider } from "@/components/color-scheme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  findColorSchemePreferenceByUserId,
  findColorSchemePreferenceByVisitorId,
} from "@/lib/color-scheme-preference-repository";
import {
  DEFAULT_COLOR_SCHEME_ID,
  normalizeColorSchemeId,
} from "@/lib/color-schemes";
import "./globals.css";

const VISITOR_ID_COOKIE = "dv_visitor_id";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Bluesix - Resource Library",
  description:
    "Personal dashboard to browse, organize, and access your developer resources without tab chaos.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon.ico", sizes: "any" },
    ],
    shortcut: ["/favicon.svg"],
    apple: [{ url: "/icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1117",
};

async function resolveInitialColorSchemeId() {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);

  if (session?.user?.id) {
    const userPreference = await findColorSchemePreferenceByUserId(session.user.id);
    if (userPreference) {
      return {
        session,
        colorSchemeId: normalizeColorSchemeId(userPreference.colorScheme),
      };
    }
  }

  const visitorId = cookieStore.get(VISITOR_ID_COOKIE)?.value?.trim();
  if (visitorId) {
    const visitorPreference = await findColorSchemePreferenceByVisitorId(visitorId);
    if (visitorPreference) {
      return {
        session,
        colorSchemeId: normalizeColorSchemeId(visitorPreference.colorScheme),
      };
    }
  }

  return {
    session,
    colorSchemeId: DEFAULT_COLOR_SCHEME_ID,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { session, colorSchemeId } = await resolveInitialColorSchemeId();

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">
        <AuthProvider session={session}>
          <ColorSchemeProvider initialColorSchemeId={colorSchemeId}>
            <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
          </ColorSchemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
