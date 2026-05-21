"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import { controlTips, modelOptions, promptPresets, promptTemplateGroups, buildVariationSeeds } from "@/lib/generation";
import { settingsFromMetadata, type ReusableGenerationSettings } from "@/lib/metadata-settings";

type AudioFormat = "mp3" | "wav";
type Result = { ok: boolean; audioUrl?: string; metadataUrl?: string; filename?: string; meta?: unknown; error?: string; detail?: unknown };
type LibraryItem = { filename: string; audioUrl: string; downloadUrl: string; metadataUrl?: string; bundleUrl?: string; format: AudioFormat; bytes: number; createdAt: string; favorite?: boolean; meta?: unknown };
type PersistedSettings = {
  mode: "music" | "sfx";
  model: string;
  prompt: string;
  negativePrompt: string;
  duration: number;
  steps: number;
  cfgScale: number;
  format: AudioFormat;
  mock: boolean;
  seed: string;
  playbackVolume: number;
};

const SETTINGS_KEY = "stable-audio-3-lab:settings:v1";

export default function Home() {
  const [mode, setMode] = useState<"music" | "sfx">("music");
  const [model, setModel] = useState("small-music");
  const [prompt, setPrompt] = useState(promptPresets.music[0]);
  const [negativePrompt, setNegativePrompt] = useState("low quality, distorted, clipping, harsh noise");
  const [duration, setDuration] = useState(12);
  const [steps, setSteps] = useState(8);
  const [cfgScale, setCfgScale] = useState(1);
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [seed, setSeed] = useState("");
  const [playbackVolume, setPlaybackVolume] = useState(0.8);
  const [mock, setMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batchCount, setBatchCount] = useState(1);
  const [batchProgress, setBatchProgress] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const selectedModel = useMemo(() => modelOptions.find((m) => m.id === model)!, [model]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<PersistedSettings>;
        if (saved.mode === "music" || saved.mode === "sfx") setMode(saved.mode);
        if (saved.model && modelOptions.some((option) => option.id === saved.model)) setModel(saved.model);
        if (typeof saved.prompt === "string" && saved.prompt.trim()) setPrompt(saved.prompt);
        if (typeof saved.negativePrompt === "string") setNegativePrompt(saved.negativePrompt);
        if (typeof saved.duration === "number" && Number.isFinite(saved.duration)) setDuration(Math.min(Math.max(saved.duration, 1), 380));
        if (typeof saved.steps === "number" && Number.isFinite(saved.steps)) setSteps(Math.min(Math.max(Math.round(saved.steps), 4), 50));
        if (typeof saved.cfgScale === "number" && Number.isFinite(saved.cfgScale)) setCfgScale(Math.min(Math.max(saved.cfgScale, 0), 12));
        if (saved.format === "mp3" || saved.format === "wav") setFormat(saved.format);
        if (typeof saved.seed === "string") setSeed(saved.seed.replace(/\D/g, "").slice(0, 10));
        if (typeof saved.playbackVolume === "number") setPlaybackVolume(clampPlaybackVolume(saved.playbackVolume));
        if (typeof saved.mock === "boolean") setMock(saved.mock);
      }
    } catch {
      // Bad localStorage should not break the app. Toss it into the void where bad JSON belongs.
      window.localStorage.removeItem(SETTINGS_KEY);
    } finally {
      setSettingsHydrated(true);
    }
    loadLibrary();
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    const settings: PersistedSettings = { mode, model, prompt, negativePrompt, duration, steps, cfgScale, format, mock, seed, playbackVolume };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settingsHydrated, mode, model, prompt, negativePrompt, duration, steps, cfgScale, format, mock, seed, playbackVolume]);

  async function loadLibrary() {
    setLibraryBusy(true);
    try {
      const response = await fetch("/api/library", { cache: "no-store" });
      const json = (await response.json()) as { ok: boolean; items?: LibraryItem[] };
      if (json.ok) setLibraryItems(json.items ?? []);
    } finally {
      setLibraryBusy(false);
    }
  }

  async function deleteLibraryItem(filename: string) {
    const confirmed = window.confirm(`Delete ${filename} and its metadata? This cannot be undone.`);
    if (!confirmed) return;

    await fetch("/api/library", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    if (result?.filename === filename) setResult(null);
    await loadLibrary();
  }

  async function toggleFavorite(filename: string, favorite: boolean) {
    await fetch("/api/library", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename, favorite }),
    });
    await loadLibrary();
  }

  function applySettings(settings: ReusableGenerationSettings) {
    setMode(settings.mode);
    setModel(settings.model);
    setPrompt(settings.prompt);
    setNegativePrompt(settings.negativePrompt);
    setDuration(settings.duration);
    setSteps(settings.steps);
    setCfgScale(settings.cfgScale);
    setFormat(settings.format);
    setSeed(typeof settings.seed === "number" ? String(settings.seed) : "");
    setMock(settings.mock);
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function loadConfigFromMetadata(meta: unknown) {
    const settings = settingsFromMetadata(meta);
    if (settings) applySettings(settings);
  }

  function randomizeSeed() {
    setSeed(String(Math.floor(Math.random() * 2147483648)));
  }

  function switchMode(next: "music" | "sfx") {
    setMode(next);
    setPrompt(promptPresets[next][0]);
    setResult(null);
    if (next === "sfx") {
      setModel("small-sfx");
      setDuration(6);
    } else {
      setModel("small-music");
      setDuration(12);
    }
  }

  async function generate() {
    setBusy(true);
    setResult(null);
    setBatchProgress("");
    try {
      const parsedSeed = seed.trim() ? Number(seed) : undefined;
      const variationSeeds = parsedSeed !== undefined ? buildVariationSeeds(parsedSeed, batchCount) : Array.from({ length: batchCount }, () => undefined as number | undefined);
      let latest: Result | null = null;
      for (let index = 0; index < variationSeeds.length; index += 1) {
        setBatchProgress(variationSeeds.length > 1 ? `Variation ${index + 1}/${variationSeeds.length}${variationSeeds[index] !== undefined ? ` • seed ${variationSeeds[index]}` : ""}` : "");
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt, negativePrompt, mode, model, duration, steps, cfgScale, format, mock, ...(variationSeeds[index] !== undefined ? { seed: variationSeeds[index] } : {}) }),
        });
        latest = (await response.json()) as Result;
        setResult(latest);
        if (!latest.ok) break;
        await loadLibrary();
      }
      if (latest?.ok) await loadLibrary();
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : "Unknown request failure" });
    } finally {
      setBusy(false);
      setBatchProgress("");
    }
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden px-4 py-4 sm:px-6 lg:px-8">
      <div className="relative z-10 mx-auto w-full max-w-[1760px]">
        <header className="mx-auto flex max-w-[1320px] items-center justify-between rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 shadow-2xl backdrop-blur-xl sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black shadow-[0_0_40px_rgba(156,255,211,.35)]">♪</div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold uppercase tracking-[0.28em] text-white/60 sm:text-sm">Stable Audio 3</div>
              <div className="font-semibold">Local Lab</div>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm text-white/60 md:flex">
            <span>M4 Max</span><span className="text-white/20">•</span><span>128GB unified</span><span className="text-white/20">•</span><span>{mock ? "mock-safe" : "real models"}</span>
          </div>
        </header>

        <section className="grid min-w-0 gap-6 py-8 lg:grid-cols-[minmax(300px,390px)_minmax(0,1fr)] xl:gap-8 xl:py-12">
          <motion.aside initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }} className="min-w-0 lg:sticky lg:top-6 lg:self-start">
            <div className="inline-flex rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100">
              Open-weight music + SFX testing rig
            </div>
            <h1 className="mt-6 max-w-[12ch] text-5xl font-light leading-[0.92] tracking-[-0.055em] text-white sm:text-6xl lg:text-[4.55rem] xl:text-[5.2rem]">
              Make noise worth keeping.
            </h1>
            <p className="mt-6 max-w-sm text-base leading-7 text-white/68 xl:text-lg xl:leading-8">
              Generate music or sound effects locally with Stable Audio 3, preview in-browser, then download as MP3 or WAV.
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {modelOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => {
                    if (option.id === "small-sfx") switchMode("sfx");
                    if (option.id !== "small-sfx") switchMode("music");
                    setModel(option.id);
                  }}
                  className={clsx(
                    "min-w-0 rounded-3xl border p-4 text-left transition hover:-translate-y-0.5",
                    model === option.id ? "border-emerald-200/50 bg-emerald-200/15" : "border-white/10 bg-white/[0.055] hover:bg-white/[0.09]",
                  )}
                >
                  <div className="font-semibold">{option.label}</div>
                  <div className="mt-2 line-clamp-3 text-xs leading-5 text-white/55">{option.bestFor}</div>
                </button>
              ))}
            </div>
          </motion.aside>

          <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.08 }} className="min-w-0 rounded-[2rem] border border-white/12 bg-white/[0.075] p-4 shadow-[0_30px_120px_rgba(0,0,0,.38)] backdrop-blur-2xl sm:p-5 xl:p-6">
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <Segmented value={mode} options={[{ value: "music", label: "Music" }, { value: "sfx", label: "Sound FX" }]} onChange={(value) => switchMode(value as "music" | "sfx")} />
              </div>
              <div>
                <Segmented value={format} options={[{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }]} onChange={(value) => setFormat(value as AudioFormat)} />
                <p className="mt-2 px-2 text-xs leading-5 text-white/45">{controlTips.format.body}</p>
              </div>
            </div>

            <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
              <div className="min-w-0 space-y-4">
                <label className="block text-sm font-medium text-white/70">Prompt</label>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={7} className="w-full resize-y rounded-3xl border border-white/10 bg-black/35 p-4 text-white outline-none ring-emerald-200/30 transition focus:ring-4" />
                <div className="flex min-w-0 flex-wrap gap-2">
                  {promptPresets[mode].map((preset) => (
                    <button key={preset} title={preset} onClick={() => setPrompt(preset)} className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-xs text-white/62 hover:bg-white/10 sm:max-w-[32%]">
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-white/45">Prompt templates</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {promptTemplateGroups.map((group) => (
                      <details key={group.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-white/75">{group.label}</summary>
                        <div className="mt-2 flex flex-col gap-2">
                          {group.templates.map((template) => (
                            <button key={template} type="button" onClick={() => setPrompt(template)} className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-left text-xs leading-5 text-white/58 hover:bg-white/10">
                              {template}
                            </button>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>

                <label className="block text-sm font-medium text-white/70">Negative prompt</label>
                <input value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} className="input" />

                <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-black/24 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <TipLabel title={controlTips.mock.title} tip={controlTips.mock.body} />
                    <div className="text-sm text-white/55">{controlTips.mock.body}</div>
                  </div>
                  <button aria-label="Toggle mock mode" onClick={() => setMock(!mock)} className={clsx("relative h-8 w-16 shrink-0 rounded-full transition", mock ? "bg-emerald-300" : "bg-white/20")}>
                    <span className={clsx("absolute top-1 h-6 w-6 rounded-full bg-black shadow transition", mock ? "left-9" : "left-1")} />
                  </button>
                </div>
              </div>

              <div className="min-w-0 space-y-4">
                <Field label="Model">
                  <select value={model} onChange={(e) => setModel(e.target.value)} className="input">
                    {modelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </Field>
                <Field label={`Duration: ${duration}s (max ${selectedModel.maxDuration}s)`} tip={controlTips.duration.body}>
                  <input type="range" min="1" max={selectedModel.maxDuration} value={Math.min(duration, selectedModel.maxDuration)} onChange={(e) => setDuration(Number(e.target.value))} className="w-full accent-emerald-200" />
                </Field>
                <Field label={`Steps: ${steps}`} tip={controlTips.steps.body}>
                  <input type="range" min="4" max="50" value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-full accent-indigo-200" />
                </Field>
                <Field label={`CFG: ${cfgScale}`} tip={controlTips.cfgScale.body}>
                  <input type="range" min="0" max="12" step="0.5" value={cfgScale} onChange={(e) => setCfgScale(Number(e.target.value))} className="w-full accent-pink-200" />
                </Field>

                <Field label="Seed" tip={controlTips.seed.body}>
                  <div className="flex gap-2">
                    <input
                      value={seed}
                      inputMode="numeric"
                      placeholder="Random each run"
                      onChange={(e) => setSeed(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      className="input min-w-0 flex-1"
                    />
                    <button type="button" onClick={randomizeSeed} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.07] px-3 text-xs font-bold leading-none text-white/70 hover:bg-white/12">
                      Random
                    </button>
                    <button type="button" onClick={() => setSeed("")} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-xs font-bold leading-none text-white/50 hover:bg-white/10">
                      Clear
                    </button>
                  </div>
                </Field>

                <Field label={`Default playback volume: ${Math.round(playbackVolume * 100)}%`} tip="Every preview player uses this volume, so new renders and library items stop jump-scaring the room.">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(playbackVolume * 100)}
                    onChange={(e) => setPlaybackVolume(clampPlaybackVolume(Number(e.target.value) / 100))}
                    className="w-full accent-cyan-200"
                  />
                </Field>

                <div className="rounded-3xl border border-emerald-200/10 bg-emerald-200/[0.06] p-4">
                  <div className="mb-2 text-sm font-semibold text-emerald-100">Quick tuning map</div>
                  <ul className="space-y-1 text-xs leading-5 text-white/58">
                    <li><span className="text-white/80">Fast drafts:</span> 4–6 steps, CFG 1.</li>
                    <li><span className="text-white/80">Good defaults:</span> 8 steps, CFG 1–2.</li>
                    <li><span className="text-white/80">Keeper pass:</span> 12–20 steps. If it gets cursed, back CFG down before calling a priest.</li>
                  </ul>
                </div>

                <Field label={`Batch variations: ${batchCount}`} tip="Generate 1–8 variations. With a fixed seed, each pass increments the seed so experiments stay organized instead of becoming soup.">
                  <input type="range" min="1" max="8" value={batchCount} onChange={(e) => setBatchCount(Number(e.target.value))} className="w-full accent-amber-200" />
                  {seed && batchCount > 1 && <div className="mt-2 text-xs text-white/45">Seeds: {buildVariationSeeds(Number(seed), batchCount).join(", ")}</div>}
                </Field>

                <button onClick={generate} disabled={busy} className="w-full rounded-full bg-white px-6 py-4 font-bold text-black shadow-[0_0_50px_rgba(255,255,255,.18)] transition hover:scale-[1.01] disabled:cursor-wait disabled:opacity-60">
                  {busy ? (batchProgress || "Generating… audio goblins negotiating royalties") : batchCount > 1 ? `Generate ${batchCount} variations` : `Generate ${format.toUpperCase()}`}
                </button>
              </div>
            </div>

            {result && <ResultPanel result={result} playbackVolume={playbackVolume} onLoadConfig={loadConfigFromMetadata} onDelete={deleteLibraryItem} />}
            <LibraryPanel items={libraryItems} playbackVolume={playbackVolume} busy={libraryBusy} onRefresh={loadLibrary} onDelete={deleteLibraryItem} onLoadConfig={loadConfigFromMetadata} onToggleFavorite={toggleFavorite} />
          </motion.section>
        </section>
      </div>
    </main>
  );
}

function Segmented({ value, options, onChange, compact = false }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; compact?: boolean }) {
  return (
    <div className={clsx("flex min-w-0 gap-2 rounded-full bg-black/30 p-1", compact ? "md:w-52" : "w-full")}>
      {options.map((item) => (
        <button key={item.value} onClick={() => onChange(item.value)} className={clsx("min-w-0 flex-1 rounded-full px-4 py-3 text-sm font-semibold uppercase tracking-[0.16em] transition", value === item.value ? "bg-white text-black" : "text-white/60 hover:text-white")}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 rounded-3xl border border-white/10 bg-black/24 p-4">
      <TipLabel title={label} tip={tip} />
      {children}
      {tip && <p className="mt-3 text-xs leading-5 text-white/50">{tip}</p>}
    </label>
  );
}

function TipLabel({ title, tip }: { title: string; tip?: string }) {
  return (
    <span className="mb-3 flex items-center gap-2 text-sm text-white/60">
      <span>{title}</span>
      {tip && (
        <span title={tip} aria-label={tip} className="grid h-5 w-5 cursor-help place-items-center rounded-full border border-white/10 bg-white/[0.07] text-[11px] font-bold text-white/55">
          ?
        </span>
      )}
    </span>
  );
}

export function clampPlaybackVolume(volume: number) {
  if (!Number.isFinite(volume)) return 0.8;
  return Math.min(Math.max(volume, 0), 1);
}

export function AudioPreview({ src, volume, label }: { src?: string; volume: number; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = clampPlaybackVolume(volume);
  }, [volume]);

  return <audio ref={audioRef} src={src} controls aria-label={label} className="w-full" />;
}

function AudioAnalysis({ src, compact = false }: { src: string; compact?: boolean }) {
  const [mode, setMode] = useState<"waveform" | "spectrogram">("waveform");
  const [status, setStatus] = useState("Analyzing pixels of sound...");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, "rgba(110, 231, 183, 0.95)");
      gradient.addColorStop(0.5, "rgba(125, 211, 252, 0.95)");
      gradient.addColorStop(1, "rgba(244, 114, 182, 0.95)");
      try {
        const response = await fetch(src);
        const buffer = await response.arrayBuffer();
        const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) throw new Error("Web Audio unavailable");
        const audioContext = new AudioContextCtor();
        const decoded = await audioContext.decodeAudioData(buffer.slice(0));
        await audioContext.close();
        if (cancelled) return;
        const data = decoded.getChannelData(0);
        if (mode === "waveform") drawWaveform(ctx, canvas, data, gradient);
        else drawSpectrogram(ctx, canvas, data);
        setStatus(`${mode === "waveform" ? "Waveform" : "Spectrogram"} • ${decoded.duration.toFixed(1)}s • ${decoded.sampleRate.toLocaleString()} Hz`);
      } catch {
        if (cancelled) return;
        drawFallback(ctx, canvas, gradient);
        setStatus("Preview analysis unavailable for this browser/audio file — fallback goblin glyphs shown.");
      }
    }
    draw();
    return () => { cancelled = true; };
  }, [src, mode]);

  return (
    <div className={clsx("mt-3 rounded-2xl border border-white/10 bg-black/28 p-3", compact && "p-2")}>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">Audio analysis</div>
        <Segmented compact value={mode} options={[{ value: "waveform", label: "Wave" }, { value: "spectrogram", label: "Spec" }]} onChange={(value) => setMode(value as "waveform" | "spectrogram")} />
      </div>
      <canvas ref={canvasRef} width={900} height={compact ? 96 : 150} className="h-24 w-full rounded-xl border border-white/10 bg-black/35 sm:h-32" />
      <div className="mt-2 text-xs text-white/45">{status}</div>
    </div>
  );
}

function drawWaveform(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: Float32Array, stroke: CanvasGradient) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(data.length / canvas.width));
  for (let x = 0; x < canvas.width; x += 1) {
    const start = x * step;
    let min = 1;
    let max = -1;
    for (let i = 0; i < step && start + i < data.length; i += 1) {
      const value = data[start + i];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const y1 = ((1 - max) / 2) * canvas.height;
    const y2 = ((1 - min) / 2) * canvas.height;
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
  }
  ctx.stroke();
}

function drawSpectrogram(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: Float32Array) {
  const step = Math.max(1, Math.floor(data.length / canvas.width));
  for (let x = 0; x < canvas.width; x += 1) {
    const start = x * step;
    let energy = 0;
    let crossings = 0;
    for (let i = 1; i < step && start + i < data.length; i += 1) {
      const prev = data[start + i - 1];
      const value = data[start + i];
      energy += Math.abs(value);
      if ((prev < 0 && value >= 0) || (prev >= 0 && value < 0)) crossings += 1;
    }
    energy = Math.min(1, energy / step * 8);
    const hue = 170 + Math.min(120, crossings * 3);
    const height = Math.max(2, energy * canvas.height);
    ctx.fillStyle = `hsla(${hue}, 95%, ${45 + energy * 30}%, 0.9)`;
    ctx.fillRect(x, canvas.height - height, 1, height);
  }
}

function drawFallback(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, fill: CanvasGradient) {
  ctx.fillStyle = fill;
  for (let x = 0; x < canvas.width; x += 8) {
    const h = 12 + Math.abs(Math.sin(x * 0.035)) * (canvas.height - 20);
    ctx.fillRect(x, canvas.height - h, 4, h);
  }
}

function ResultPanel({ result, playbackVolume, onLoadConfig, onDelete }: { result: Result; playbackVolume: number; onLoadConfig: (meta: unknown) => void; onDelete: (filename: string) => void }) {
  return (
    <div className="mt-5 min-w-0 rounded-3xl border border-white/10 bg-black/35 p-4">
      {result.ok ? (
        <>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 truncate font-semibold text-emerald-100">Generated: {result.filename}</div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {result.audioUrl && <a href={result.audioUrl} download={result.filename} className="inline-flex min-h-10 items-center justify-center rounded-full bg-emerald-200 px-4 py-2 text-sm font-bold leading-none text-black hover:bg-white">Download {result.filename?.split(".").pop()?.toUpperCase()}</a>}
              {result.filename && <button onClick={() => onDelete(result.filename!)} className="inline-flex min-h-10 items-center justify-center rounded-full border border-red-300/35 bg-red-500/20 px-4 py-2 text-sm font-bold leading-none text-red-100 hover:bg-red-500/30">Delete</button>}
            </div>
          </div>
          <AudioPreview src={result.audioUrl} volume={playbackVolume} label={`Generated audio preview for ${result.filename ?? "latest render"}`} />
          {result.audioUrl && <AudioAnalysis src={result.audioUrl} />}
          <MetadataSummary meta={result.meta} metadataUrl={result.metadataUrl} onLoadConfig={onLoadConfig} />
          <pre className="mt-3 max-h-52 max-w-full overflow-auto rounded-2xl bg-black/40 p-3 font-mono text-xs text-white/62">{JSON.stringify(result.meta, null, 2)}</pre>
        </>
      ) : (
        <>
          <div className="font-semibold text-pink-200">Generation failed</div>
          <pre className="mt-3 max-h-64 max-w-full overflow-auto rounded-2xl bg-black/40 p-3 font-mono text-xs text-white/70">{JSON.stringify(result, null, 2)}</pre>
        </>
      )}
    </div>
  );
}

function LibraryPanel({ items, playbackVolume, busy, onRefresh, onDelete, onLoadConfig, onToggleFavorite }: { items: LibraryItem[]; playbackVolume: number; busy: boolean; onRefresh: () => void; onDelete: (filename: string) => void; onLoadConfig: (meta: unknown) => void; onToggleFavorite: (filename: string, favorite: boolean) => void }) {
  return (
    <section className="mt-5 rounded-3xl border border-white/10 bg-black/25 p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Library</h2>
          <p className="text-sm text-white/55">Listen to previous generations, download keepers, or delete the cursed goblin noises.</p>
        </div>
        <button onClick={onRefresh} className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold leading-none text-white/70 hover:bg-white/10">
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-white/50">No generated audio yet. Make something weird.</div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <article key={item.filename} className="min-w-0 rounded-2xl border border-white/10 bg-black/30 p-3">
              <div className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-white/85">{item.favorite ? "★ " : ""}{item.filename}</div>
                  <div className="text-xs uppercase tracking-[0.16em] text-white/40">
                    {item.format} • {formatBytes(item.bytes)} • {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button onClick={() => onToggleFavorite(item.filename, !item.favorite)} className={clsx("inline-flex min-h-10 items-center justify-center rounded-full border px-3 py-2 text-xs font-bold leading-none", item.favorite ? "border-amber-200/40 bg-amber-200/20 text-amber-100" : "border-white/10 bg-white/[0.05] text-white/55 hover:bg-white/10")}>
                    {item.favorite ? "Starred" : "Star"}
                  </button>
                  <a href={item.downloadUrl} download={item.filename} className="inline-flex min-h-10 items-center justify-center rounded-full bg-white px-3 py-2 text-xs font-bold leading-none text-black hover:bg-emerald-100">Download</a>
                  {item.bundleUrl && <a href={item.bundleUrl} download className="inline-flex min-h-10 items-center justify-center rounded-full border border-violet-200/20 bg-violet-200/10 px-3 py-2 text-xs font-bold leading-none text-violet-100 hover:bg-violet-200/20">Bundle</a>}
                  <button onClick={() => onDelete(item.filename)} className="inline-flex min-h-10 items-center justify-center rounded-full border border-red-300/35 bg-red-500/20 px-3 py-2 text-xs font-bold leading-none text-red-100 hover:bg-red-500/30">Delete</button>
                </div>
              </div>
              <AudioPreview src={item.audioUrl} volume={playbackVolume} label={`Library audio preview for ${item.filename}`} />
              <AudioAnalysis src={item.audioUrl} compact />
              <MetadataSummary meta={item.meta} metadataUrl={item.metadataUrl} compact onLoadConfig={onLoadConfig} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MetadataSummary({ meta, metadataUrl, compact = false, onLoadConfig }: { meta?: unknown; metadataUrl?: string; compact?: boolean; onLoadConfig: (meta: unknown) => void }) {
  const settings = settingsFromMetadata(meta);
  const renderDurationMs = readGenerationDurationMs(meta);
  const backend = readBackend(meta);
  if (!settings) {
    return (
      <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-3 text-xs text-white/42">
        No metadata sidecar found for this older render.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-cyan-200/10 bg-cyan-200/[0.04] p-3">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/70">Generation metadata</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onLoadConfig(meta)} className="inline-flex min-h-8 items-center justify-center rounded-full border border-emerald-100/15 bg-emerald-100/10 px-3 py-1.5 text-[11px] font-bold leading-none text-emerald-50 hover:bg-emerald-100/20">
            Load config
          </button>
          {metadataUrl && (
            <a href={metadataUrl} download className="inline-flex min-h-8 items-center justify-center rounded-full border border-cyan-100/15 bg-cyan-100/10 px-3 py-1.5 text-[11px] font-bold leading-none text-cyan-50 hover:bg-cyan-100/20">
              Download JSON
            </a>
          )}
        </div>
      </div>
      {settings.prompt && <p className="text-sm leading-6 text-white/78">“{settings.prompt}”</p>}
      {!compact && settings.negativePrompt && <p className="mt-1 text-xs leading-5 text-white/45">Avoided: {settings.negativePrompt}</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
        {settings.model && <span className="rounded-full bg-white/[0.07] px-2.5 py-1">{settings.model}</span>}
        {settings.mode && <span className="rounded-full bg-white/[0.07] px-2.5 py-1">{settings.mode}</span>}
        {typeof settings.duration === "number" && <span className="rounded-full bg-white/[0.07] px-2.5 py-1">{settings.duration}s</span>}
        {typeof settings.steps === "number" && <span className="rounded-full bg-white/[0.07] px-2.5 py-1">{settings.steps} steps</span>}
        {typeof settings.cfgScale === "number" && <span className="rounded-full bg-white/[0.07] px-2.5 py-1">CFG {settings.cfgScale}</span>}
        {settings.format && <span className="rounded-full bg-white/[0.07] px-2.5 py-1">{settings.format}</span>}
        {backend && <span className="rounded-full bg-fuchsia-200/10 px-2.5 py-1 text-fuchsia-100">{backend}</span>}
        {typeof renderDurationMs === "number" && <span className="rounded-full bg-cyan-200/10 px-2.5 py-1 text-cyan-100">render {formatDuration(renderDurationMs)}</span>}
        {typeof settings.seed === "number" && <span className="rounded-full bg-white/[0.07] px-2.5 py-1">seed {settings.seed}</span>}
        {settings.mock && <span className="rounded-full bg-amber-200/10 px-2.5 py-1 text-amber-100">mock</span>}
      </div>
    </div>
  );
}

function readGenerationDurationMs(meta: unknown) {
  if (!meta || typeof meta !== "object") return undefined;
  const value = (meta as Record<string, unknown>).generationDurationMs;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBackend(meta: unknown) {
  if (!meta || typeof meta !== "object") return undefined;
  const value = (meta as Record<string, unknown>).backend;
  return value === "mlx" || value === "torch" ? value : undefined;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
