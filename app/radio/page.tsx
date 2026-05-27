import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { headers } from "next/headers";
import {
  buildRadioLanStreamUrl,
  buildRadioPlaylistUrls,
  buildRadioPublicStreamUrl,
  buildRadioStreamState,
  defaultRadioState,
  normalizeRadioState,
  type RadioState,
  type RadioStreamState,
} from "@/lib/radio";
import RadioStationClient from "./RadioStationClient";

export const dynamic = "force-dynamic";

const statePath = () => path.join(process.cwd(), ".stable-audio-radio", "state.json");

export default async function RadioPage() {
  const [initialState, initialPromptModels] = await Promise.all([
    readInitialRadioStreamState(),
    listOllamaPromptModels(),
  ]);
  return <RadioStationClient initialState={initialState} initialPromptModels={initialPromptModels} />;
}

async function readInitialRadioStreamState(): Promise<RadioStreamState> {
  const state = await readRadioState();
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const port = host.includes(":") ? host.split(":").at(-1) : process.env.PORT || "3007";
  const publicOrigin = resolvePublicRadioOrigin(requestHeaders);
  const publicStreamUrl = buildRadioPublicStreamUrl(publicOrigin);
  const publicPlaylistUrls = buildRadioPlaylistUrls(resolveConfiguredPublicRadioOrigin(requestHeaders));
  const lanStreamUrl = buildRadioLanStreamUrl(resolveLanIp(), port);
  const lanPlaylistUrls = buildRadioPlaylistUrls(lanStreamUrl);
  return {
    ...buildRadioStreamState(state),
    ...(publicStreamUrl ? { streamUrl: publicStreamUrl } : {}),
    ...(lanStreamUrl ? { lanStreamUrl } : {}),
    ...(publicPlaylistUrls ? { publicPlaylistUrls } : {}),
    ...(lanPlaylistUrls ? { lanPlaylistUrls } : {}),
  };
}

async function readRadioState(): Promise<RadioState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as Partial<RadioState>;
    return normalizeRadioState(parsed);
  } catch {
    return defaultRadioState();
  }
}

function resolveLanIp() {
  const override = process.env.RADIO_LAN_HOST || process.env.LAN_IP;
  if (override) return override;
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
}

function resolvePublicRadioOrigin(requestHeaders: { get(name: string): string | null }) {
  const host = requestHeaders.get("host") ?? "";
  if (!host) return undefined;
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

function resolveConfiguredPublicRadioOrigin(requestHeaders: { get(name: string): string | null }) {
  const requestOrigin = resolvePublicRadioOrigin(requestHeaders);
  return process.env.RADIO_PUBLIC_ORIGIN || (requestOrigin?.includes("radio.pardev.net") ? requestOrigin : "https://radio.pardev.net");
}

async function listOllamaPromptModels() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.RADIO_OLLAMA_MODELS_TIMEOUT_MS || 1000));
  try {
    const response = await fetch(ollamaTagsUrl(), { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json() as { models?: Array<{ name?: unknown; model?: unknown }> };
    return [...new Set((data.models ?? [])
      .map((model) => typeof model.name === "string" ? model.name : typeof model.model === "string" ? model.model : "")
      .map((name) => name.trim())
      .filter(Boolean))];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function ollamaTagsUrl() {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? `http://${process.env.OLLAMA_HOST ?? "127.0.0.1"}:${process.env.OLLAMA_PORT ?? "11434"}`;
  return new URL("/api/tags", baseUrl).toString();
}
