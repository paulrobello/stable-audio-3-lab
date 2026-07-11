// LAN/public stream-URL and playlist builders for the radio station.
//
// Pure URL construction: the LAN IP stream URL, the public-origin stream URL,
// the playlist (m3u/pls) URL + content builders, and the ICY "tune in" URL
// wrapper. Each respects the optional `style` query parameter via the shared
// `normalizeRadioStyleUrlParam` validator from `./styles`.

import type { RadioPlaylistFormat, RadioPlaylistUrls } from "./types";
import { normalizeRadioStyleUrlParam } from "./styles";

const RADIO_STATION_TITLE = "Stable Audio 3 Lab Radio";

export function buildRadioLanStreamUrl(lanIp: string | undefined, port: string | number | undefined, styleIdInput?: unknown) {
  const host = typeof lanIp === "string" ? lanIp.trim() : "";
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return undefined;
  const safePort = String(port ?? "3007").replace(/\D/g, "") || "3007";
  return appendRadioStyleParam(new URL(`http://${host}:${safePort}/api/radio?stream=1`), styleIdInput);
}

export function buildRadioPublicStreamUrl(origin: string | undefined, styleIdInput?: unknown) {
  const trimmed = typeof origin === "string" ? origin.trim() : "";
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.pathname = "/api/radio";
    url.search = "stream=1";
    url.hash = "";
    return appendRadioStyleParam(url, styleIdInput);
  } catch {
    return undefined;
  }
}

export function buildRadioPlaylistUrls(origin: string | undefined, styleIdInput?: unknown): RadioPlaylistUrls | undefined {
  const m3u = buildRadioRootUrl(origin, "/radio.m3u", styleIdInput);
  const pls = buildRadioRootUrl(origin, "/radio.pls", styleIdInput);
  return m3u && pls ? { m3u, pls } : undefined;
}

export function buildRadioTuneInStreamUrl(streamUrl: string) {
  const url = new URL(streamUrl);
  url.searchParams.set("icy", "1");
  return url.toString();
}

export function buildRadioPlaylistContent(format: RadioPlaylistFormat, streamUrl: string, title = RADIO_STATION_TITLE) {
  if (format === "m3u") {
    return [
      "#EXTM3U",
      `#EXTINF:-1,${title}`,
      streamUrl,
      "",
    ].join("\n");
  }
  return [
    "[playlist]",
    "NumberOfEntries=1",
    `File1=${streamUrl}`,
    `Title1=${title}`,
    "Length1=-1",
    "Version=2",
    "",
  ].join("\n");
}

function buildRadioRootUrl(origin: string | undefined, pathname: string, styleIdInput?: unknown) {
  const trimmed = typeof origin === "string" ? origin.trim() : "";
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return appendRadioStyleParam(url, styleIdInput);
  } catch {
    return undefined;
  }
}

function appendRadioStyleParam(url: URL, styleIdInput: unknown) {
  const styleId = normalizeRadioStyleUrlParam(styleIdInput);
  if (styleId) url.searchParams.set("style", styleId);
  return url.toString();
}
