import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { getOptionalPerplexityEnv } from "@/lib/env";

export const runtime = "nodejs";

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  contextCategory: z.string().trim().min(1).max(80).optional(),
});

const aiMetadataSchema = z.object({
  label: z.string().trim().min(1).max(120),
  briefDescription: z.string().trim().max(280).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(24).optional(),
  suggestedCategory: z.string().trim().min(1).max(80).optional().nullable(),
});

type LinkMetadata = z.infer<typeof aiMetadataSchema>;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new z.ZodError([
      {
        code: "custom",
        path: [],
        message: "Request body must be valid JSON.",
      },
    ]);
  }
}

function normalizeUrl(rawUrl: string): string {
  const normalizedUrl = rawUrl.trim();
  let parsed: URL;

  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["url"],
        message: "URL must be a valid absolute URL.",
      },
    ]);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["url"],
        message: "URL must use http or https.",
      },
    ]);
  }

  return parsed.toString();
}

function normalizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const rawTag of tags ?? []) {
    const normalizedTag = rawTag.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!normalizedTag) {
      continue;
    }

    const key = normalizedTag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    next.push(normalizedTag);

    if (next.length >= 24) {
      break;
    }
  }

  return next;
}

const TECHNICAL_ACRONYMS = new Set([
  "api",
  "cdn",
  "npm",
  "sql",
  "css",
  "html",
  "xml",
  "json",
  "yaml",
  "toml",
  "http",
  "https",
  "ftp",
  "ssh",
  "tcp",
  "udp",
  "ip",
  "dns",
  "url",
  "uri",
  "ui",
  "ux",
  "cli",
  "gui",
  "ide",
  "sdk",
  "jdk",
  "jwt",
  "oauth",
  "saml",
  "rest",
  "soap",
  "grpc",
  "aws",
  "gcp",
  "cpu",
  "gpu",
  "ram",
  "ssd",
  "hdd",
]);

const LOWERCASE_ARTICLES = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "for",
  "nor",
  "on",
  "at",
  "to",
  "by",
  "in",
  "of",
  "as",
  "vs",
  "via",
]);

function titleCaseFromSegment(segment: string): string {
  const words = segment
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((part) => part.length > 0);

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();

      if (index === 0) {
        return TECHNICAL_ACRONYMS.has(lower)
          ? lower.toUpperCase()
          : word[0].toUpperCase() + word.slice(1).toLowerCase();
      }

      if (TECHNICAL_ACRONYMS.has(lower)) {
        return lower.toUpperCase();
      }

      if (LOWERCASE_ARTICLES.has(lower)) {
        return lower;
      }

      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function buildFallbackMetadata(
  url: string,
  contextCategory?: string,
): LinkMetadata {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);
  const tail =
    segments.length > 0
      ? decodeURIComponent(segments[segments.length - 1])
      : "";

  const derivedLabel = titleCaseFromSegment(tail);
  const label = (derivedLabel || host).slice(0, 120);
  const suggestedCategory =
    contextCategory && contextCategory.toLowerCase() !== "all"
      ? contextCategory
      : "General";

  return {
    label,
    briefDescription: `Added from ${host}.`,
    tags: normalizeTags([host.split(".")[0]]),
    suggestedCategory,
  };
}

function extractResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybeChoices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) {
    return null;
  }

  const firstChoice = maybeChoices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return null;
  }

  const message = (firstChoice as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const maybeText = (part as { text?: unknown }).text;
        return typeof maybeText === "string" ? maybeText : "";
      })
      .join("")
      .trim();

    return text || null;
  }

  return null;
}

function extractJsonCandidate(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return errorResponse(new NextResponse("AI link enrichment service is unavailable."), 503);
  return text.trim();
}

async function fetchPerplexityLinkMetadata(
  apiKey: string,
  model: string,
  url: string,
  contextCategory?: string,
): Promise<LinkMetadata> {
  const systemPrompt = [
    "You produce metadata for a software resource link.",
    "Respond with JSON only and no markdown.",
    'JSON shape: {"label":"...","briefDescription":"...","tags":["..."],"suggestedCategory":"..."}',
    "Rules:",
    "- label: short title, <= 120 chars.",
    "- briefDescription: one sentence, <= 280 chars.",
    "- tags: 3 to 8 concise technical tags, each <= 40 chars.",
    "- suggestedCategory: one concise category, <= 80 chars.",
  ].join("\n");

  const userPrompt = [
    `URL: ${url}`,
    contextCategory ? `Current category context: ${contextCategory}` : null,
    "Focus on developer-library relevance.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Perplexity request failed (${response.status}): ${responseText || "No response body."}`,
    );
  }

  const payload = (await response.json()) as unknown;
  const content = extractResponseText(payload);
  if (!content) {
    throw new Error("Perplexity response did not include message content.");
  }

  const parsed = JSON.parse(extractJsonCandidate(content)) as unknown;
  const metadata = aiMetadataSchema.parse(parsed);

  return {
    label: metadata.label.trim().slice(0, 120),
    briefDescription: metadata.briefDescription?.trim().slice(0, 280) || null,
    tags: normalizeTags(metadata.tags),
    suggestedCategory: metadata.suggestedCategory?.trim().slice(0, 80) || null,
  };
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401);
    }

    if (!session.user.isAdmin) {
      return errorResponse("Admin access required.", 403);
    }

    const payload = await readRequestJson(request);
    const input = requestSchema.parse(payload);
    const normalizedUrl = normalizeUrl(input.url);
    const perplexityEnv = getOptionalPerplexityEnv();

    if (!perplexityEnv) {
      return errorResponse("PERPLEXITY_API_KEY is not configured.", 503);
    }

    try {
      const metadata = await fetchPerplexityLinkMetadata(
        perplexityEnv.apiKey,
        perplexityEnv.model,
        normalizedUrl,
        input.contextCategory,
      );

      return NextResponse.json({
        url: normalizedUrl,
        ...metadata,
        source: "perplexity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[ai/link-metadata] Perplexity enrichment failed: ${message}`,
      );

      const fallback = buildFallbackMetadata(
        normalizedUrl,
        input.contextCategory,
      );
      return NextResponse.json({
        url: normalizedUrl,
        ...fallback,
        source: "fallback",
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid link metadata request payload.",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    return errorResponse("Unexpected server error.", 500);
  }
}
