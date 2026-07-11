import { NextRequest, NextResponse } from "next/server";
import { checkMutatingRateLimit } from "@/lib/server/concurrency";

// Opt-in shared-secret auth + per-client rate limiting for the mutating API
// surface.
//
// AUTH IS OPT-IN. It activates ONLY when STABLE_AUDIO_ADMIN_TOKEN is set and
// non-empty. When unset (the default localhost/single-user configuration),
// behaviour is unchanged: no auth is required and the app behaves exactly as
// before. The token is never generated or hardcoded here; it comes solely from
// the environment, supplied by the operator.
//
// Only mutating methods (POST/PUT/PATCH/DELETE) under /api/* are gated. GET
// handlers — including the public GET /api/radio JSON contract and the
// ?stream=1 MP3 stream consumed by Pardora — are left open. Read-only access
// is unchanged regardless of whether a token is configured.
//
// When a token IS configured, every mutating /api/* request must carry
//   Authorization: Bearer <token>
// A missing or mismatched token yields 401. Comparison is constant-time.

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_REALM = 'Bearer realm="stable-audio-3-lab"';

export function proxy(request: NextRequest): NextResponse {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) {
    return NextResponse.next();
  }

  // Per-client rate limit (fail-open). Runs before auth so unauthenticated
  // floods are throttled before we spend cycles validating tokens.
  const clientId = resolveClientId(request);
  const rate = checkMutatingRateLimit(clientId);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) } },
    );
  }

  const token = process.env.STABLE_AUDIO_ADMIN_TOKEN;
  if (token) {
    const provided = readBearerToken(request);
    if (provided === null || !constantTimeEqual(provided, token)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401, headers: { "WWW-Authenticate": AUTH_REALM } },
      );
    }
    // CSRF defense (SEC-005): when auth is active, require mutating JSON
    // requests to originate from the app's own host. The check is skipped when
    // NEITHER Origin nor Referer is present, so non-browser clients (the Pardora
    // iOS/watchOS/CarPlay app, curl) keep working unchanged — those carry the
    // bearer token directly and present no CSRF surface. A browser-originated
    // cross-site POST (which would carry the victim's cookies and a foreign
    // Origin) is rejected with 403.
    const originViolation = checkSameOrigin(request);
    if (originViolation) {
      return NextResponse.json(
        { ok: false, error: originViolation },
        { status: 403 },
      );
    }
  }

  return NextResponse.next();
}

// Returns an error string when the request's Origin/Referer does not match the
// app's own host (CSRF), or null when the request is allowed. The check is
// bypassed (returns null) when neither header is present, since that indicates
// a non-browser client that carries the bearer token out-of-band.
function checkSameOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if (!origin && !referer) return null;

  const host = request.headers.get("host");
  if (!host) return null;

  const source = origin ?? referer!;
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return "Invalid Origin/Referer header";
  }
  if (!isAllowedScheme(parsed.protocol)) {
    return "Blocked request source";
  }
  // Compare hostname; also compare port when the Host header carries one so a
  // cross-port request on the same host is still caught (e.g. localhost:3008 ->
  // localhost:3007). An empty Host port (public default-port origins) skips the
  // port comparison.
  if (parsed.hostname !== host.split(":")[0]) {
    return "Cross-origin requests are not permitted for this endpoint";
  }
  const requestPort = host.split(":")[1];
  if (requestPort && parsed.port && parsed.port !== requestPort) {
    return "Cross-origin requests are not permitted for this endpoint";
  }
  return null;
}

function isAllowedScheme(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function resolveClientId(request: NextRequest): string {
  // NextRequest.ip is populated by the platform when available. Fall back to
  // the forwarding headers, then to "local" for same-origin dev requests.
  const direct = (request as NextRequest & { ip?: string }).ip;
  if (direct) return direct;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "local";
}

// Constant-time string comparison. Iterates over the longer of the two strings
// so a length mismatch does not leak via an early return, and never branches on
// secret data. Good enough for a high-entropy shared secret already protected
// by TLS in transit; avoids depending on node:crypto.timingSafeEqual, which is
// unavailable in the Edge runtime where the proxy runs.
function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    const av = i < a.length ? a.charCodeAt(i) : 0;
    const bv = i < b.length ? b.charCodeAt(i) : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

export const config = {
  // Only run for API routes; the handler short-circuits non-mutating methods.
  matcher: ["/api/:path*"],
};
