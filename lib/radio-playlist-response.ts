import { NextRequest, NextResponse } from "next/server";
import {
  buildRadioPlaylistContent,
  buildRadioPublicStreamUrl,
  buildRadioTuneInStreamUrl,
  normalizeRadioStyleUrlParam,
  type RadioPlaylistFormat,
} from "@/lib/radio";

export function buildRadioPlaylistRouteResponse(format: RadioPlaylistFormat, request: NextRequest) {
  const styleId = normalizeRadioStyleUrlParam(request.nextUrl.searchParams.get("style") ?? request.nextUrl.searchParams.get("styleId"));
  const streamUrl = buildRadioPublicStreamUrl(resolvePublicRadioOrigin(request), styleId);
  if (!streamUrl) {
    return NextResponse.json({ ok: false, error: "Radio playlist origin is unavailable" }, { status: 400 });
  }
  return new NextResponse(buildRadioPlaylistContent(format, buildRadioTuneInStreamUrl(streamUrl)), {
    headers: {
      "content-type": format === "m3u" ? "audio/x-mpegurl; charset=utf-8" : "audio/x-scpls; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function resolvePublicRadioOrigin(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!host) return undefined;
  const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "")) || "https";
  return `${proto}://${host}`;
}
