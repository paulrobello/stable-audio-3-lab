// LAN/public stream-URL and playlist builders for the radio station.
//
// Pure URL construction: the LAN IP stream URL, the public-origin stream URL,
// the playlist (m3u/pls) URL + content builders, and the ICY "tune in" URL
// wrapper. Each respects the optional `style` query parameter via the shared
// `normalizeRadioStyleUrlParam` validator from `./styles`.

import type { RadioPlaylistFormat, RadioPlaylistUrls } from "./types";
import { normalizeRadioStyleUrlParam } from "./styles";

const RADIO_STATION_TITLE = "Stable Audio 3 Lab Radio";

/**
 * Build the LAN (`http://<ip>:<port>/api/radio?stream=1`) MP3 stream URL.
 *
 * Returns `undefined` unless `lanIp` is a valid IPv4 address. Appends the
 * optional `style` query param when `styleIdInput` resolves to a known style.
 *
 * @returns The stream URL string, or `undefined` for an invalid IP.
 */
export function buildRadioLanStreamUrl(lanIp: string | undefined, port: string | number | undefined, styleIdInput?: unknown) {
  const host = typeof lanIp === "string" ? lanIp.trim() : "";
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return undefined;
  const safePort = String(port ?? "3007").replace(/\D/g, "") || "3007";
  return appendRadioStyleParam(new URL(`http://${host}:${safePort}/api/radio?stream=1`), styleIdInput);
}

/**
 * Build the public-origin stream URL (`<origin>/api/radio?stream=1`).
 *
 * Accepts only `http:`/`https:` origins; returns `undefined` for an empty or
 * non-parseable origin. Appends the optional `style` query param when valid.
 *
 * @returns The stream URL string, or `undefined` for an invalid origin.
 */
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

/** Build the public m3u + pls playlist URL pair for the given origin, or `undefined` if the origin is invalid. */
export function buildRadioPlaylistUrls(origin: string | undefined, styleIdInput?: unknown): RadioPlaylistUrls | undefined {
  const m3u = buildRadioRootUrl(origin, "/radio.m3u", styleIdInput);
  const pls = buildRadioRootUrl(origin, "/radio.pls", styleIdInput);
  return m3u && pls ? { m3u, pls } : undefined;
}

/** Append the `icy=1` query param to a stream URL so the server returns ICY "tune in" metadata headers. */
export function buildRadioTuneInStreamUrl(streamUrl: string) {
  const url = new URL(streamUrl);
  url.searchParams.set("icy", "1");
  return url.toString();
}

/** Render the full text body of an m3u or pls playlist file pointing at `streamUrl`. */
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
