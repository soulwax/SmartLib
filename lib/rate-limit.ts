import "server-only";

import { createHash } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

const REDIS_SOCKET_TIMEOUT_MS = 2500;

const RATE_LIMIT_KEY_PREFIX = "ratelimit";

// Minimum TTL for Redis rate limit keys (10 seconds) to avoid premature expiration
const REDIS_MIN_TTL_MS = 10_000;

type RedisReply = string | number | null | RedisReply[];

interface RedisResponseError extends Error {
  name: "RedisResponseError";
}

interface RedisConnectionConfig {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  useTls: boolean;
}

interface ParseResult {
  value: RedisReply | RedisResponseError;
  nextOffset: number;
}

interface MemoryBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  namespace: string;
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
  source: "redis" | "memory";
}

export interface RateLimitBackendHealth {
  configured: boolean;
  healthy: boolean;
  source: "redis" | "memory";
  message: string;
}

export class RateLimitExceededError extends Error {
  constructor(
    readonly result: RateLimitResult,
    message = "Too many requests. Please try again later.",
  ) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

export const RATE_LIMIT_RULES = {
  AUTH_REGISTER: {
    namespace: "auth:register",
    max: 5,
    windowMs: 15 * 60 * 1000,
  } satisfies RateLimitRule,
  AUTH_RESEND_VERIFICATION: {
    namespace: "auth:resend-verification",
    max: 6,
    windowMs: 60 * 60 * 1000,
  } satisfies RateLimitRule,
  AUTH_PASSWORD_RESET_REQUEST: {
    namespace: "auth:password-reset-request",
    max: 6,
    windowMs: 60 * 60 * 1000,
  } satisfies RateLimitRule,
  AUTH_PASSWORD_RESET_CONSUME: {
    namespace: "auth:password-reset-consume",
    max: 12,
    windowMs: 60 * 60 * 1000,
  } satisfies RateLimitRule,
  AUTH_ACCOUNT_DELETE: {
    namespace: "auth:account-delete",
    max: 3,
    windowMs: 60 * 60 * 1000,
  } satisfies RateLimitRule,
  AUTH_ADMIN_WRITE: {
    namespace: "auth:admin-write",
    max: 30,
    windowMs: 10 * 60 * 1000,
  } satisfies RateLimitRule,
  AUTH_CREDENTIALS_SIGNIN_IDENTIFIER: {
    namespace: "auth:credentials-signin-identifier",
    max: 10,
    windowMs: 10 * 60 * 1000,
  } satisfies RateLimitRule,
  AI_REQUESTS: {
    namespace: "ai:requests",
    max: 30,
    windowMs: 5 * 60 * 1000,
  } satisfies RateLimitRule,
  WRITE_REQUESTS: {
    namespace: "write:requests",
    max: 120,
    windowMs: 5 * 60 * 1000,
  } satisfies RateLimitRule,
} as const;

const memoryBuckets = new Map<string, MemoryBucket>();

const MEMORY_BUCKET_CLEANUP_INTERVAL_MS = 60 * 1000;

function cleanupExpiredMemoryBuckets(now: number = Date.now()): void {
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) {
      memoryBuckets.delete(key);
    }
  }
}

if (typeof setInterval === "function") {
  const timer = setInterval(() => {
    cleanupExpiredMemoryBuckets();
  }, MEMORY_BUCKET_CLEANUP_INTERVAL_MS);
  // In Node.js, unref the interval so it doesn't keep the process alive.
  (timer as NodeJS.Timeout).unref?.();
}
let hasLoggedRedisFallback = false;
let hasLoggedRedisTlsFallback = false;

function createRedisResponseError(message: string): RedisResponseError {
  const error = new Error(message) as RedisResponseError;
  error.name = "RedisResponseError";
  return error;
}

function createCommandPayload(parts: readonly string[]): string {
  let payload = `*${parts.length}\r\n`;
  for (const part of parts) {
    const value = part ?? "";
    payload += `$${Buffer.byteLength(value, "utf8")}\r\n${value}\r\n`;
  }
  return payload;
}

function readLine(
  buffer: Buffer,
  startOffset: number,
): { line: string; nextOffset: number } | null {
  const lineEnd = buffer.indexOf("\r\n", startOffset);
  if (lineEnd === -1) {
    return null;
  }

  return {
    line: buffer.toString("utf8", startOffset, lineEnd),
    nextOffset: lineEnd + 2,
  };
}

function parseRedisReply(buffer: Buffer, startOffset = 0): ParseResult | null {
  if (startOffset >= buffer.length) {
    return null;
  }

  const prefix = buffer[startOffset];
  const lineData = readLine(buffer, startOffset + 1);
  if (!lineData) {
    return null;
  }

  const { line, nextOffset } = lineData;

  if (prefix === 43) {
    return { value: line, nextOffset };
  }

  if (prefix === 45) {
    return { value: createRedisResponseError(line), nextOffset };
  }

  if (prefix === 58) {
    const parsed = Number.parseInt(line, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid Redis integer response: '${line}'`);
    }
    return { value: parsed, nextOffset };
  }

  if (prefix === 36) {
    const byteLength = Number.parseInt(line, 10);
    if (!Number.isFinite(byteLength)) {
      throw new Error(`Invalid Redis bulk string length: '${line}'`);
    }

    if (byteLength < 0) {
      return { value: null, nextOffset };
    }

    const bulkEnd = nextOffset + byteLength;
    if (buffer.length < bulkEnd + 2) {
      return null;
    }

    if (buffer[bulkEnd] !== 13 || buffer[bulkEnd + 1] !== 10) {
      throw new Error("Malformed Redis bulk string response.");
    }

    return {
      value: buffer.toString("utf8", nextOffset, bulkEnd),
      nextOffset: bulkEnd + 2,
    };
  }

  if (prefix === 42) {
    const elementCount = Number.parseInt(line, 10);
    if (!Number.isFinite(elementCount)) {
      throw new Error(`Invalid Redis array length: '${line}'`);
    }

    if (elementCount < 0) {
      return { value: null, nextOffset };
    }

    let cursor = nextOffset;
    const items: RedisReply[] = [];

    for (let index = 0; index < elementCount; index += 1) {
      const parsed = parseRedisReply(buffer, cursor);
      if (!parsed) {
        return null;
      }

      if (
        parsed.value !== null &&
        typeof parsed.value === "object" &&
        "name" in parsed.value &&
        (parsed.value as { name?: string }).name === "RedisResponseError"
      ) {
        return {
          value: parsed.value,
          nextOffset: parsed.nextOffset,
        };
      }

      items.push(parsed.value as RedisReply);
      cursor = parsed.nextOffset;
    }

    return { value: items, nextOffset: cursor };
  }

  throw new Error(
    `Unsupported Redis response prefix: '${String.fromCharCode(prefix)}'`,
  );
}

function connectRedisSocket(
  config: RedisConnectionConfig,
  useTls: boolean,
): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tls.connect({
          host: config.host,
          port: config.port,
          servername: config.host,
        })
      : net.createConnection({
          host: config.host,
          port: config.port,
        });

    const handleError = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(REDIS_SOCKET_TIMEOUT_MS);
    socket.once("error", handleError);
    socket.once("timeout", () =>
      handleError(new Error("Redis connection timed out")),
    );

    const readyEvent = useTls ? "secureConnect" : "connect";
    socket.once(readyEvent, () => {
      socket.off("error", handleError);
      resolve(socket);
    });
  });
}

async function executeRedisCommands(
  config: RedisConnectionConfig,
  commands: readonly string[][],
  useTls: boolean,
): Promise<RedisReply[]> {
  const socket = await connectRedisSocket(config, useTls);
  const expectedResponses = commands.length;
  const payload = commands
    .map((command) => createCommandPayload(command))
    .join("");

  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = Buffer.alloc(0);
    const replies: RedisReply[] = [];

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      reject(error);
    };

    const succeed = (result: RedisReply[]) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.end();
      resolve(result);
    };

    socket.on("error", (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });

    socket.on("timeout", () => {
      fail(new Error("Redis response timed out"));
    });

    socket.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }

      buffer = Buffer.concat([buffer, chunk]);

      try {
        while (true) {
          const parsed = parseRedisReply(buffer);
          if (!parsed) {
            break;
          }

          buffer = buffer.subarray(parsed.nextOffset);

          if (
            parsed.value !== null &&
            typeof parsed.value === "object" &&
            !Array.isArray(parsed.value) &&
            (parsed.value as { name?: string }).name === "RedisResponseError"
          ) {
            // Ensure fail always receives an Error object
            fail(
              parsed.value instanceof Error
                ? parsed.value
                : new Error(String(parsed.value)),
            );
            return;
          }

          replies.push(parsed.value as RedisReply);
          if (replies.length >= expectedResponses) {
            succeed(replies);
            return;
          }
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.once("end", () => {
      if (!settled && replies.length < expectedResponses) {
        fail(
          new Error("Redis connection closed before full response was read"),
        );
      }
    });

    socket.write(payload, "utf8", (error) => {
      if (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function buildRedisAuthCommands(config: RedisConnectionConfig): string[][] {
  if (!config.password) {
    return [];
  }

  if (config.username && config.username.length > 0) {
    return [["AUTH", config.username, config.password]];
  }

  return [["AUTH", config.password]];
}

async function executeRedisCommandsWithTlsFallback(
  config: RedisConnectionConfig,
  commands: readonly string[][],
): Promise<RedisReply[]> {
  try {
    return await executeRedisCommands(config, commands, config.useTls);
  } catch (primaryError) {
    const canTryTlsFallback = !config.useTls;
    if (!canTryTlsFallback) {
      throw primaryError;
    }

    const replies = await executeRedisCommands(config, commands, true);
    if (!hasLoggedRedisTlsFallback) {
      console.warn(
        "[rate-limit] REDIS_URL uses redis:// but required TLS at runtime; using TLS fallback connection.",
      );
      hasLoggedRedisTlsFallback = true;
    }
    return replies;
  }
}

function parseRedisConfig(): RedisConnectionConfig | null {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      return null;
    }

    const port = Number.parseInt(parsed.port || "6379", 10);
    if (!Number.isFinite(port) || port <= 0) {
      return null;
    }

    const forceTls = process.env.REDIS_TLS?.trim().toLowerCase() === "true";

    return {
      host: parsed.hostname,
      port,
      username: parsed.username ? decodeURIComponent(parsed.username) : null,
      password: parsed.password ? decodeURIComponent(parsed.password) : null,
      useTls: parsed.protocol === "rediss:" || forceTls,
    };
  } catch {
    return null;
  }
}

function buildRateLimitKey(
  rule: RateLimitRule,
  subject: string,
  now: number,
): string {
  const bucket = Math.floor(now / rule.windowMs);
  const subjectHash = createHash("sha256")
    .update(subject)
    .digest("hex")
    .slice(0, 32);
  return `${RATE_LIMIT_KEY_PREFIX}:${rule.namespace}:${bucket}:${subjectHash}`;
}

function parseIntReply(reply: RedisReply, context: string): number {
  if (typeof reply !== "number" || !Number.isFinite(reply)) {
    throw new Error(`Unexpected Redis reply for ${context}`);
  }
  return reply;
}

async function consumeRedisRateLimit(
  subject: string,
  rule: RateLimitRule,
  now: number,
): Promise<RateLimitResult | null> {
  const config = parseRedisConfig();
  if (!config) {
    return null;
  }

  const key = buildRateLimitKey(rule, subject, now);
  const ttlMs = Math.max(rule.windowMs * 2, REDIS_MIN_TTL_MS);

  const commands: string[][] = [...buildRedisAuthCommands(config)];
  commands.push(["INCR", key]);
  commands.push(["PEXPIRE", key, String(ttlMs)]);

  const replies = await executeRedisCommandsWithTlsFallback(config, commands);
  const offset = config.password ? 1 : 0;
  const count = parseIntReply(replies[offset], "INCR");
  const resetAt = (Math.floor(now / rule.windowMs) + 1) * rule.windowMs;
  const remaining = Math.max(0, rule.max - count);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  return {
    allowed: count <= rule.max,
    limit: rule.max,
    remaining,
    retryAfterSeconds,
    resetAt,
    source: "redis" as const,
  };
}

function consumeMemoryRateLimit(
  subject: string,
  rule: RateLimitRule,
  now: number,
): RateLimitResult {
  const key = buildRateLimitKey(rule, subject, now);
  const resetAt = (Math.floor(now / rule.windowMs) + 1) * rule.windowMs;
  const current = memoryBuckets.get(key);

  if (!current || current.resetAt <= now) {
    memoryBuckets.set(key, {
      count: 1,
      resetAt,
    });

    return {
      allowed: true,
      limit: rule.max,
      remaining: Math.max(0, rule.max - 1),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      resetAt,
      source: "memory",
    };
  }

  current.count += 1;
  memoryBuckets.set(key, current);

  return {
    allowed: current.count <= rule.max,
    limit: rule.max,
    remaining: Math.max(0, rule.max - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    resetAt: current.resetAt,
    source: "memory",
  };
}

export function getRequestIpAddress(request: Request): string {
  const candidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
    request.headers.get("true-client-ip"),
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const normalized = candidate.trim().toLowerCase();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return "unknown";
}

function normalizeSubject(value: string): string {
  return value.trim().toLowerCase();
}

export function getRequestRateLimitSubject(
  request: Request,
  userId?: string | null,
): string {
  if (typeof userId === "string" && userId.trim().length > 0) {
    return `user:${normalizeSubject(userId)}`;
  }

  return `ip:${getRequestIpAddress(request)}`;
}

export async function consumeRateLimit(
  subject: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const now = Date.now();

  try {
    const redisResult = await consumeRedisRateLimit(subject, rule, now);
    if (redisResult) {
      return redisResult;
    }
  } catch (error) {
    if (!hasLoggedRedisFallback) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[rate-limit] Redis unavailable, falling back to in-memory limiter: ${message}`,
      );
      hasLoggedRedisFallback = true;
    }
  }

  return consumeMemoryRateLimit(subject, rule, now);
}

export async function getRateLimitBackendHealth(): Promise<RateLimitBackendHealth> {
  const rawRedisUrl = process.env.REDIS_URL?.trim();
  if (!rawRedisUrl) {
    return {
      configured: false,
      healthy: true,
      source: "memory",
      message: "REDIS_URL is not configured; using in-memory rate limiting.",
    };
  }

  const config = parseRedisConfig();
  if (!config) {
    return {
      configured: true,
      healthy: false,
      source: "memory",
      message:
        "REDIS_URL is set but invalid. Expected redis:// or rediss:// with host and port.",
    };
  }

  const commands: string[][] = [...buildRedisAuthCommands(config), ["PING"]];

  try {
    const replies = await executeRedisCommandsWithTlsFallback(config, commands);
    const offset = config.password ? 1 : 0;
    const pingReply = replies[offset];
    const isHealthyReply =
      typeof pingReply === "string" && pingReply.toUpperCase() === "PONG";

    if (!isHealthyReply) {
      return {
        configured: true,
        healthy: false,
        source: "memory",
        message: "Redis responded unexpectedly to PING.",
      };
    }

    return {
      configured: true,
      healthy: true,
      source: "redis",
      message: "Redis connection healthy.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      configured: true,
      healthy: false,
      source: "memory",
      message: `Redis health check failed: ${message}`,
    };
  }
}

export async function assertRateLimit(
  subject: string,
  rule: RateLimitRule,
  message?: string,
): Promise<RateLimitResult> {
  const normalizedSubject = normalizeSubject(subject);
  const result = await consumeRateLimit(normalizedSubject, rule);
  if (!result.allowed) {
    throw new RateLimitExceededError(result, message);
  }
  return result;
}

export async function assertRequestRateLimit(
  request: Request,
  rule: RateLimitRule,
  options?: {
    userId?: string | null;
    suffix?: string | null;
    message?: string;
  },
): Promise<RateLimitResult> {
  const baseSubject = getRequestRateLimitSubject(request, options?.userId);
  const suffix = options?.suffix?.trim();
  const subject = suffix
    ? `${baseSubject}:${normalizeSubject(suffix)}`
    : baseSubject;
  return assertRateLimit(subject, rule, options?.message);
}

export function createRateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  return {
    "Retry-After": String(Math.max(1, result.retryAfterSeconds)),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

export function asRateLimitJsonResponse(error: unknown): Response | null {
  if (!(error instanceof RateLimitExceededError)) {
    return null;
  }

  return new Response(JSON.stringify({ error: error.message }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      ...createRateLimitHeaders(error.result),
    },
  });
}
