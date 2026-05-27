"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ForwardIcon, HandThumbDownIcon, HandThumbUpIcon, TrashIcon } from "@heroicons/react/24/solid";
import { defaultRadioTtsVoice, getRadioTtsVoiceOptions, normalizeRadioSongLengthMinutes, radioOllamaModels, radioSongLengthMinuteOptions, radioStyles, type RadioPlaylistUrls, type RadioPromptDraft, type RadioStreamState, type RadioStyleId, type RadioTrackRecord, type RadioTtsProvider, type RadioTtsVoiceOption } from "@/lib/radio";

type RadioApiResponse = { ok: boolean; state?: RadioStreamState; draft?: RadioPromptDraft; fallbackTrack?: RadioTrackRecord; rejectedTrack?: RadioTrackRecord; skippedTrack?: RadioTrackRecord; deletedTrack?: RadioTrackRecord; cleanedTracks?: RadioTrackRecord[]; promptModels?: string[]; voices?: RadioTtsVoiceOption[]; error?: string };
type RadioTestVoiceResponse = { ok: boolean; audioUrl?: string; error?: string };
type GenerateResponse = { ok: boolean; filename?: string; title?: string; audioUrl?: string; meta?: unknown; error?: string };
const RADIO_STATE_RETRY_MS = 1500;
const RADIO_STATE_POLL_MS = 5000;
const RADIO_QUEUE_GENERATION_TIMEOUT_MS = 45_000;
type RadioPlaybackPhase = "announcement" | "song";

export default function RadioStationClient({ initialState = null, initialPromptModels = [] }: { initialState?: RadioStreamState | null; initialPromptModels?: string[] }) {
  const [radioState, setRadioState] = useState<RadioStreamState | null>(initialState);
  const [selectedStyleId, setSelectedStyleId] = useState<RadioStyleId>(initialState?.selectedStyleId ?? "synthwave");
  const [promptModel, setPromptModel] = useState<string>(initialState?.promptModel ?? radioOllamaModels[0]);
  const [promptModels, setPromptModels] = useState<string[]>(() => cleanPromptModels(initialPromptModels));
  const [announceEnabled, setAnnounceEnabled] = useState(initialState?.announceEnabled ?? true);
  const [songLengthMinutes, setSongLengthMinutes] = useState(() => normalizeRadioSongLengthMinutes(initialState?.songLengthMinutes));
  const [ttsProvider, setTtsProvider] = useState<RadioTtsProvider>(initialState?.ttsProvider ?? "openai");
  const [ttsVoice, setTtsVoice] = useState(initialState?.ttsVoice ?? "nova");
  const [announcementPrefix, setAnnouncementPrefix] = useState(initialState?.announcementPrefix ?? "Now playing: ");
  const [announcementSuffix, setAnnouncementSuffix] = useState(initialState?.announcementSuffix ?? "");
  const [draft, setDraft] = useState<RadioPromptDraft | null>(initialState?.currentDraft ?? null);
  const [generated, setGenerated] = useState<GenerateResponse | null>(null);
  const [status, setStatus] = useState("");
  const [testVoiceAudioUrl, setTestVoiceAudioUrl] = useState("");
  const [remoteTtsVoiceOptions, setRemoteTtsVoiceOptions] = useState<{ provider: RadioTtsProvider; voices: RadioTtsVoiceOption[] } | null>(null);
  const [browserStreamUrl, setBrowserStreamUrl] = useState(initialState?.streamUrl ?? initialState?.lanStreamUrl ?? "");
  const [busy, setBusy] = useState<"draft" | "generate" | "rating" | "config" | "maintenance" | "select" | "delete" | "voice" | null>(null);
  const [optimisticLike, setOptimisticLike] = useState<{ trackKey: string; liked: boolean } | null>(null);
  const [streamReloadKey, setStreamReloadKey] = useState(0);
  const [trackElapsedSeconds, setTrackElapsedSeconds] = useState(0);
  const [playbackPhase, setPlaybackPhase] = useState<RadioPlaybackPhase>(() => initialState?.currentTrack?.announcementFilename ? "announcement" : "song");
  const audioRef = useRef<HTMLAudioElement>(null);
  const testVoiceAudioRef = useRef<HTMLAudioElement>(null);
  const maintenanceRunningRef = useRef(false);
  const maintenancePausedRef = useRef(false);
  const loadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamElapsedAtTrackStartRef = useRef(0);
  const resumeAfterStreamReloadRef = useRef(false);

  const selectedStyle = useMemo(() => radioStyles.find((style) => style.id === selectedStyleId) ?? radioStyles[0], [selectedStyleId]);
  const promptModelOptions = useMemo(() => mergePromptModelOptions(promptModels, promptModel), [promptModels, promptModel]);
  const ttsVoiceOptions = useMemo(() => {
    const fallback = getRadioTtsVoiceOptions(ttsProvider, ttsVoice);
    if (remoteTtsVoiceOptions?.provider !== ttsProvider || remoteTtsVoiceOptions.voices.length === 0) return fallback;
    return mergeCurrentVoiceOption(remoteTtsVoiceOptions.voices, ttsVoice);
  }, [remoteTtsVoiceOptions, ttsProvider, ttsVoice]);
  const currentTrack = radioState?.currentTrack;
  const selectedStyleQueue = useMemo(
    () => radioState?.history.filter((track) => track.styleId === selectedStyleId) ?? [],
    [radioState?.history, selectedStyleId],
  );
  const activeDraft = draft ?? radioState?.currentDraft ?? null;
  const browserOriginStreamUrl = useBrowserOriginStreamUrl(radioState?.streamUrl ?? radioState?.lanStreamUrl ?? browserStreamUrl);
  const visibleStreamUrl = browserOriginStreamUrl;
  const publicPlaylistUrls = radioState?.publicPlaylistUrls;
  const lanPlaylistUrls = radioState?.lanPlaylistUrls;
  const stablePlayerStreamUrl = useStableRadioStreamUrl(currentTrack?.filename, browserOriginStreamUrl);
  const announcementUrl = useBrowserOriginOutputUrl(currentTrack?.announcementFilename);
  const songStreamUrl = useMemo(
    () => currentTrack?.announcementFilename ? appendSkipAnnouncementParam(stablePlayerStreamUrl) : stablePlayerStreamUrl,
    [currentTrack?.announcementFilename, stablePlayerStreamUrl],
  );
  const reloadedSongStreamUrl = useMemo(() => appendStreamReloadParam(songStreamUrl, streamReloadKey), [songStreamUrl, streamReloadKey]);
  const playerStreamUrl = playbackPhase === "announcement" && announcementUrl ? announcementUrl : reloadedSongStreamUrl;
  const currentTrackKey = trackFeedbackKey(currentTrack);
  const currentTrackLiked = optimisticLike?.trackKey === currentTrackKey ? optimisticLike.liked : isRadioTrackLiked(currentTrack, radioState);
  const songDurationSeconds = songLengthMinutes * 60;
  const trackDurationSeconds = currentTrack?.durationSeconds ?? songDurationSeconds;
  const safeTrackElapsedSeconds = Math.min(trackElapsedSeconds, trackDurationSeconds);
  const skipDisabled = !currentTrack || (!!busy && busy !== "maintenance");

  useEffect(() => {
    setBrowserStreamUrl(`${window.location.origin}/api/radio?stream=1`);
    void loadState();
    const poll = setInterval(() => void loadState(), RADIO_STATE_POLL_MS);
    return () => {
      if (loadRetryTimerRef.current) clearTimeout(loadRetryTimerRef.current);
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (!radioState || busy || maintenanceRunningRef.current || maintenancePausedRef.current) return;
    void maintainQueue(radioState);
  }, [radioState?.updatedAt]);

  useEffect(() => {
    setOptimisticLike(null);
    setTrackElapsedSeconds(0);
    setPlaybackPhase(currentTrack?.announcementFilename ? "announcement" : "song");
    streamElapsedAtTrackStartRef.current = readAudioCurrentTime(audioRef.current);
  }, [currentTrackKey, currentTrack?.announcementFilename]);

  useEffect(() => {
    if (!resumeAfterStreamReloadRef.current || !audioRef.current) return;
    resumeAfterStreamReloadRef.current = false;
    void audioRef.current.play().catch(() => undefined);
  }, [playerStreamUrl]);

  useEffect(() => {
    if (!testVoiceAudioUrl || !testVoiceAudioRef.current) return;
    void playTestVoiceAudio();
  }, [testVoiceAudioUrl]);

  useEffect(() => {
    let cancelled = false;
    setRemoteTtsVoiceOptions(null);
    void loadTtsVoiceOptions().then((voices) => {
      if (!cancelled && voices.length) setRemoteTtsVoiceOptions({ provider: ttsProvider, voices });
    });
    return () => {
      cancelled = true;
    };
  }, [ttsProvider]);

  async function loadState() {
    try {
      const response = await fetch("/api/radio", { cache: "no-store" });
      const json = await response.json() as RadioApiResponse;
      if (!json.ok || !json.state) throw new Error(json.error ?? "Radio state unavailable");
      if (loadRetryTimerRef.current) {
        clearTimeout(loadRetryTimerRef.current);
        loadRetryTimerRef.current = null;
      }
      setRadioState(json.state);
      setSelectedStyleId(json.state.selectedStyleId);
      setPromptModel(json.state.promptModel);
      setAnnounceEnabled(json.state.announceEnabled);
      setSongLengthMinutes(normalizeRadioSongLengthMinutes(json.state.songLengthMinutes));
      setTtsProvider(json.state.ttsProvider);
      setTtsVoice(json.state.ttsVoice);
      setAnnouncementPrefix(json.state.announcementPrefix);
      setAnnouncementSuffix(json.state.announcementSuffix);
      setDraft(json.state.currentDraft ?? null);
      if (json.promptModels) setPromptModels(cleanPromptModels(json.promptModels));
    } catch (error) {
      setStatus(`${error instanceof Error ? error.message : "Could not load radio state."} Retrying...`);
      if (!loadRetryTimerRef.current) {
        loadRetryTimerRef.current = setTimeout(() => {
          loadRetryTimerRef.current = null;
          void loadState();
        }, RADIO_STATE_RETRY_MS);
      }
    }
  }

  async function postRadio(body: Record<string, unknown>) {
    const response = await fetch("/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json() as RadioApiResponse;
    if (!json.ok) throw new Error(json.error ?? "Radio request failed");
    if (json.state) {
      setRadioState(json.state);
      setSongLengthMinutes(normalizeRadioSongLengthMinutes(json.state.songLengthMinutes));
    }
    if (json.draft) setDraft(json.draft);
    if (json.promptModels) setPromptModels(cleanPromptModels(json.promptModels));
    return json;
  }

  async function saveConfiguration({
    nextStyleId = selectedStyleId,
    nextPromptModel = promptModel,
    nextAnnounceEnabled = announceEnabled,
    nextSongLengthMinutes = songLengthMinutes,
    nextTtsProvider = ttsProvider,
    nextTtsVoice = ttsVoice,
    nextAnnouncementPrefix = announcementPrefix,
    nextAnnouncementSuffix = announcementSuffix,
  }: {
    nextStyleId?: RadioStyleId;
    nextPromptModel?: string;
    nextAnnounceEnabled?: boolean;
    nextSongLengthMinutes?: number;
    nextTtsProvider?: RadioTtsProvider;
    nextTtsVoice?: string;
    nextAnnouncementPrefix?: string;
    nextAnnouncementSuffix?: string;
  } = {}) {
    setBusy("config");
    setStatus("Saving station settings...");
    try {
      await postRadio({
        action: "configure",
        styleId: nextStyleId,
        promptModel: nextPromptModel,
        announceEnabled: nextAnnounceEnabled,
        songLengthMinutes: nextSongLengthMinutes,
        ttsProvider: nextTtsProvider,
        ttsVoice: nextTtsVoice,
        announcementPrefix: nextAnnouncementPrefix,
        announcementSuffix: nextAnnouncementSuffix,
      });
      setStatus("Station settings saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save station settings.");
    } finally {
      setBusy(null);
    }
  }

  async function draftNextPrompt() {
    setBusy("draft");
    setGenerated(null);
    setStatus(`Asking Ollama ${promptModel} for a ${selectedStyle.label} track prompt...`);
    try {
      const json = await postRadio({ action: "draft", styleId: selectedStyleId, promptModel, announceEnabled });
      setStatus(json.draft?.promptProvider === "fallback" ? "Ollama was unavailable; drafted a local fallback prompt." : "Prompt drafted from Ollama.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Prompt draft failed.");
    } finally {
      setBusy(null);
    }
  }

  async function generateDraftTrack() {
    if (!activeDraft) return;
    setBusy("generate");
    setGenerated(null);
    setStatus("Generating station track as MP3...");
    try {
      const json = await generateTrackFromDraft(activeDraft, { quiet: false, announce: announceEnabled });
      maintenancePausedRef.current = false;
      setStatus("Track registered for the radio stream. Prompt provider/model were written to metadata.");
      if (json.state) await maintainQueue(json.state);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Track generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function generateTrackFromDraft(trackDraft: RadioPromptDraft, { quiet, announce, signal }: { quiet: boolean; announce: boolean; signal?: AbortSignal }) {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        prompt: trackDraft.prompt,
        negativePrompt: trackDraft.negativePrompt,
        mode: "music",
        model: "small-music",
        duration: songDurationSeconds,
        steps: 8,
        cfgScale: 1,
        format: "mp3",
        mock: false,
        title: trackDraft.title,
      }),
    });
    const result = await response.json() as GenerateResponse;
    if (!quiet) setGenerated(result);
    if (!result.ok || !result.filename) throw new Error(result.error ?? "Track generation failed");
    return postRadio({
      action: "track",
      filename: result.filename,
      title: result.title ?? trackDraft.title,
      prompt: trackDraft.prompt,
      styleId: trackDraft.styleId,
      announce,
        promptProvider: trackDraft.promptProvider,
        promptModel: trackDraft.promptModel,
        durationSeconds: songDurationSeconds,
      });
  }

  async function generateQueueTrackFromDraft(trackDraft: RadioPromptDraft, announce: boolean) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RADIO_QUEUE_GENERATION_TIMEOUT_MS);
    try {
      return await generateTrackFromDraft(trackDraft, { quiet: true, announce, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("Queue track generation timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function maintainQueue(startState: RadioStreamState) {
    maintenanceRunningRef.current = true;
    setBusy("maintenance");
    setStatus("Checking radio cleanup and queue...");
    try {
      const cleanupJson = await postRadio({ action: "cleanup" });
      let nextState = cleanupJson.state ?? startState;
      let generatedCount = 0;
      let fallbackCount = 0;
      const maxGenerations = nextState.queueTarget + 1;

      while (nextState.queueAheadCount < nextState.queueTarget && generatedCount < maxGenerations) {
        setStatus(`Generating queue track ${generatedCount + 1} of ${maxGenerations}...`);
        try {
          const draftJson = await postRadio({
            action: "draft",
            styleId: nextState.selectedStyleId,
            promptModel: nextState.promptModel,
            announceEnabled: nextState.announceEnabled,
          });
          if (!draftJson.draft) break;
          const trackJson = await generateQueueTrackFromDraft(draftJson.draft, nextState.announceEnabled);
          if (!trackJson.state) break;
          nextState = trackJson.state;
        } catch (error) {
          const fallbackJson = await postRadio({ action: "fallbackTrack", reason: "queue_refill_timeout" });
          if (!fallbackJson.state) throw error;
          nextState = fallbackJson.state;
          fallbackCount += 1;
        }
        generatedCount += 1;
      }

      if (fallbackCount > 0) {
        setStatus(`Using starred library fallback; queue ready with ${nextState.queueAheadCount} songs ahead.`);
      } else if (generatedCount > 0) {
        setStatus(`Queue ready with ${nextState.queueAheadCount} songs ahead.`);
      } else if (cleanupJson.cleanedTracks?.length) {
        setStatus(`Cleaned ${cleanupJson.cleanedTracks.length} expired unliked song${cleanupJson.cleanedTracks.length === 1 ? "" : "s"}.`);
      } else {
        setStatus("");
      }
    } catch (error) {
      maintenancePausedRef.current = true;
      setStatus(error instanceof Error ? error.message : "Radio maintenance failed.");
    } finally {
      maintenanceRunningRef.current = false;
      setBusy(null);
    }
  }

  async function rateCurrent(rating: "up" | "down") {
    const phrase = currentTrack?.prompt ?? activeDraft?.prompt ?? "";
    const ratedTrackKey = trackFeedbackKey(currentTrack);
    if (ratedTrackKey) setOptimisticLike({ trackKey: ratedTrackKey, liked: rating === "up" ? !currentTrackLiked : false });
    setBusy("rating");
    setStatus(rating === "up" ? "Recording thumbs up..." : "Recording thumbs down...");
    try {
      const json = await postRadio({ action: "rating", rating, styleId: currentTrack?.styleId ?? selectedStyleId, phrase });
      if (ratedTrackKey) setOptimisticLike(null);
      maintenancePausedRef.current = false;
      if (json.rejectedTrack) {
        setStatus(json.state?.currentTrack ? `Removed "${json.rejectedTrack.title}" and skipped to "${json.state.currentTrack.title}".` : `Removed "${json.rejectedTrack.title}". Generate another station song to continue.`);
      } else {
        setStatus("Preference saved for future prompt drafts.");
      }
      if (json.state) await maintainQueue(json.state);
    } catch (error) {
      if (ratedTrackKey) setOptimisticLike(null);
      setStatus(error instanceof Error ? error.message : "Could not save preference.");
    } finally {
      setBusy(null);
    }
  }

  async function skipCurrentTrack() {
    if (!currentTrack) return;
    const skippedFilename = currentTrack.filename;
    setBusy("select");
    setStatus(`Skipping "${currentTrack.title}"...`);
    try {
      resumeAfterStreamReloadRef.current = true;
      const json = await postRadio({ action: "skipTrack" });
      const nextState = json.state;
      const nextTrack = nextState?.currentTrack;
      if (nextTrack && nextTrack.filename !== skippedFilename) {
        setStreamReloadKey((key) => key + 1);
        setTrackElapsedSeconds(0);
        maintenancePausedRef.current = false;
        setStatus(json.skippedTrack ? `Skipped "${json.skippedTrack.title}" and loaded "${nextTrack.title}".` : `Loaded "${nextTrack.title}".`);
        if (!maintenanceRunningRef.current) await maintainQueue(nextState);
      } else {
        resumeAfterStreamReloadRef.current = false;
        setStatus("No queued song is available to skip to.");
      }
    } catch (error) {
      resumeAfterStreamReloadRef.current = false;
      setStatus(error instanceof Error ? error.message : "Could not skip the current song.");
    } finally {
      setBusy(null);
    }
  }

  async function selectLineupTrack(track: RadioTrackRecord) {
    if (track.filename === currentTrack?.filename) return;
    setBusy("select");
    setStatus(`Loading "${track.title}"...`);
    try {
      resumeAfterStreamReloadRef.current = true;
      const json = await postRadio({ action: "selectTrack", filename: track.filename });
      setStreamReloadKey((key) => key + 1);
      setTrackElapsedSeconds(0);
      maintenancePausedRef.current = false;
      setStatus(json.state?.currentTrack ? `Now playing "${json.state.currentTrack.title}".` : "Selected lineup song.");
      if (json.state) await maintainQueue(json.state);
    } catch (error) {
      resumeAfterStreamReloadRef.current = false;
      setStatus(error instanceof Error ? error.message : "Could not load selected song.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteLineupTrack(track: RadioTrackRecord) {
    const metadataText = hasRadioTrackFeedback(track, radioState) ? "Feedback metadata will be kept." : "Metadata will be deleted too.";
    const confirmed = window.confirm(`Delete ${track.title} from the radio queue and remove ${track.filename}? ${metadataText}`);
    if (!confirmed) return;

    setBusy("delete");
    setStatus(`Deleting "${track.title}"...`);
    try {
      const wasCurrentTrack = track.filename === currentTrack?.filename;
      const json = await postRadio({ action: "deleteTrack", filename: track.filename });
      if (wasCurrentTrack) {
        resumeAfterStreamReloadRef.current = true;
        setStreamReloadKey((key) => key + 1);
        setTrackElapsedSeconds(0);
      }
      maintenancePausedRef.current = false;
      setStatus(json.deletedTrack ? `Deleted "${json.deletedTrack.title}" from the radio queue.` : "Deleted radio queue item.");
      if (json.state) await maintainQueue(json.state);
    } catch (error) {
      resumeAfterStreamReloadRef.current = false;
      setStatus(error instanceof Error ? error.message : "Could not delete radio queue item.");
    } finally {
      setBusy(null);
    }
  }

  function changeStyle(styleId: RadioStyleId) {
    maintenancePausedRef.current = false;
    setSelectedStyleId(styleId);
    void saveConfiguration({ nextStyleId: styleId });
  }

  function changeAnnounce(enabled: boolean) {
    setAnnounceEnabled(enabled);
    void saveConfiguration({ nextAnnounceEnabled: enabled });
  }

  function changeSongLengthMinutes(minutesInput: string) {
    const minutes = normalizeRadioSongLengthMinutes(minutesInput);
    setSongLengthMinutes(minutes);
    void saveConfiguration({ nextSongLengthMinutes: minutes });
  }

  function changeTtsProvider(provider: RadioTtsProvider) {
    const nextVoice = defaultRadioTtsVoice(provider);
    setRemoteTtsVoiceOptions(null);
    setTtsProvider(provider);
    setTtsVoice(nextVoice);
    void saveConfiguration({ nextTtsProvider: provider, nextTtsVoice: nextVoice });
  }

  function changeTtsVoice(voice: string) {
    setTtsVoice(voice);
    void saveConfiguration({ nextTtsVoice: voice });
  }

  async function testVoice() {
    setBusy("voice");
    setStatus("Generating test voice sample...");
    try {
      const response = await fetch("/api/radio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "testVoice",
          ttsProvider,
          ttsVoice,
          announcementPrefix,
          announcementSuffix,
        }),
      });
      const json = await response.json() as RadioTestVoiceResponse;
      if (!json.ok || !json.audioUrl) throw new Error(json.error ?? "Test voice generation failed");
      setTestVoiceAudioUrl(json.audioUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not generate test voice sample.");
    } finally {
      setBusy(null);
    }
  }

  async function loadTtsVoiceOptions() {
    try {
      const response = await fetch("/api/radio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ttsVoices", ttsProvider, ttsVoice }),
      });
      const json = await response.json() as RadioApiResponse;
      return json.ok ? json.voices ?? [] : [];
    } catch {
      return [];
    }
  }

  async function playTestVoiceAudio() {
    const audio = testVoiceAudioRef.current;
    if (!audio) return;
    try {
      await audio.play();
      setStatus("Playing test voice sample.");
    } catch {
      setStatus("Test voice sample is ready. Press play in the audio controls.");
    }
  }

  function handleAudioTimeUpdate(event: React.SyntheticEvent<HTMLAudioElement>) {
    if (playbackPhase === "announcement") return;
    const elapsed = Math.max(0, readAudioCurrentTime(event.currentTarget) - streamElapsedAtTrackStartRef.current);
    setTrackElapsedSeconds(Math.min(elapsed, trackDurationSeconds));
  }

  function handleAudioEnded() {
    if (playbackPhase === "announcement" && reloadedSongStreamUrl) {
      resumeAfterStreamReloadRef.current = true;
      streamElapsedAtTrackStartRef.current = 0;
      setTrackElapsedSeconds(0);
      setPlaybackPhase("song");
      setStatus("Playing song audio...");
      return;
    }
    setTrackElapsedSeconds(trackDurationSeconds);
    setStatus("Waiting for more station audio from the continuous stream...");
    void loadState();
  }

  function handleAudioError() {
    if (playbackPhase === "announcement" && reloadedSongStreamUrl) {
      resumeAfterStreamReloadRef.current = true;
      setPlaybackPhase("song");
      setStatus("Announcement audio was unavailable. Playing song audio...");
      return;
    }
    setStatus("Could not play the current station audio.");
  }

  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1480px]">
        <header className="flex flex-col gap-3 rounded-[2rem] border border-white/10 bg-white/[0.06] p-4 shadow-2xl backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/" className="text-sm font-semibold text-emerald-100/75 hover:text-emerald-50">Stable Audio 3 Lab</Link>
            <h1 className="mt-1 text-3xl font-light tracking-[-0.04em] text-white sm:mt-2 sm:text-5xl">AI Radio Station</h1>
            <p className="mt-2 hidden max-w-2xl text-sm leading-6 text-white/58 sm:block">
              Pandora-style prompt feedback loop for local AI-generated songs, with Ollama prompt provenance and a raw MP3 stream URL.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.08] p-3 text-sm text-emerald-50 md:max-w-xl">
            <div className="font-semibold">Sonos/TuneIn import</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {publicPlaylistUrls ? <PlaylistUrlGroup label="radio.pardev.net" urls={publicPlaylistUrls} /> : null}
              {lanPlaylistUrls ? <PlaylistUrlGroup label="LAN host" urls={lanPlaylistUrls} /> : null}
            </div>
            <div className="mt-3 text-xs font-semibold text-emerald-100/85">Direct MP3 stream</div>
            <code className="mt-1 block break-all text-xs text-emerald-100/75">{visibleStreamUrl || "/api/radio?stream=1"}</code>
            <div className="mt-1 text-xs text-white/45">{radioState?.streamReady ? "Current MP3 is ready." : "Generate/register an MP3 track first."}</div>
          </div>
        </header>

        <section className="mt-4 rounded-[2rem] border border-white/10 bg-black/30 p-3 shadow-2xl backdrop-blur-xl">
          <div className="grid gap-3 lg:grid-cols-[minmax(190px,260px)_minmax(0,1fr)_minmax(260px,380px)] lg:items-center">
            <label className="block text-xs font-bold uppercase tracking-[0.16em] text-white/42">
              Genre
              <select
                value={selectedStyleId}
                onChange={(event) => changeStyle(event.target.value as RadioStyleId)}
                disabled={!!busy}
                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-3 text-sm font-semibold normal-case tracking-normal text-white outline-none disabled:opacity-55"
              >
                {radioStyles.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
              </select>
            </label>

            <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.045] p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-white">{currentTrack?.title ?? "No song loaded"}</div>
                  <div className="mt-1 truncate text-xs uppercase tracking-[0.14em] text-white/38">
                    {currentTrack ? trackProvenanceLabel(currentTrack) : selectedStyle.label}
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-emerald-100/80">
                  {radioState ? `${radioState.queueAheadCount}/${radioState.queueTarget} ahead` : "Queue loading"}
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-white/55">
                  <span>{formatDuration(safeTrackElapsedSeconds)} / {formatDuration(trackDurationSeconds)}</span>
                  <span>{playerStreamUrl ? "Streaming" : "Waiting"}</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Song progress"
                  aria-valuemin={0}
                  aria-valuemax={trackDurationSeconds}
                  aria-valuenow={Math.round(safeTrackElapsedSeconds)}
                  className="h-2 overflow-hidden rounded-full bg-white/10"
                >
                  <div className="h-full rounded-full bg-emerald-200 transition-[width]" style={{ width: `${trackDurationSeconds ? safeTrackElapsedSeconds / trackDurationSeconds * 100 : 0}%` }} />
                </div>
              </div>
              {playerStreamUrl ? (
                <audio
                  ref={audioRef}
                  src={playerStreamUrl}
                  controls
                  className="mt-3 w-full"
                  onTimeUpdate={handleAudioTimeUpdate}
                  onEnded={handleAudioEnded}
                  onError={handleAudioError}
                />
              ) : (
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/24 p-3 text-sm text-white/45">Waiting for the first MP3 track.</div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => void rateCurrent("up")}
                disabled={!!busy || !currentTrack}
                aria-pressed={currentTrackLiked}
                className={clsx(
                  "flex min-h-14 items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-bold transition disabled:opacity-45",
                  currentTrackLiked ? "border-amber-100 bg-amber-300 text-black shadow-[0_0_28px_rgba(252,211,77,.28)]" : "border-amber-200/30 bg-amber-200/12 text-amber-50",
                )}
              >
                <HandThumbUpIcon className="h-5 w-5" />
                <span>{currentTrackLiked ? "Liked" : "Like"}</span>
              </button>
              <button type="button" onClick={() => void skipCurrentTrack()} disabled={skipDisabled} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-cyan-200/30 bg-cyan-300/12 px-3 py-3 text-sm font-bold text-cyan-50 disabled:opacity-45">
                <ForwardIcon className="h-5 w-5" />
                <span>Skip</span>
              </button>
              <button type="button" onClick={() => void rateCurrent("down")} disabled={!!busy || !currentTrack} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-pink-200/30 bg-pink-400/12 px-3 py-3 text-sm font-bold text-pink-50 disabled:opacity-45">
                <HandThumbDownIcon className="h-5 w-5" />
                <span>Dislike</span>
              </button>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(320px,410px)_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-[2rem] border border-white/10 bg-black/24 p-4">
            <div>
              <h2 className="text-lg font-semibold">Music style</h2>
              <div className="mt-3 grid gap-2">
                {radioStyles.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => changeStyle(style.id)}
                    className={clsx(
                      "rounded-2xl border p-3 text-left transition hover:bg-white/[0.08]",
                      selectedStyleId === style.id ? "border-emerald-200/45 bg-emerald-200/15" : "border-white/10 bg-white/[0.04]",
                    )}
                  >
                    <div className="font-semibold text-white/88">{style.label}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{style.seedPrompt}</div>
                  </button>
                ))}
              </div>
            </div>

            <label className="block rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/65">
              Ollama prompt model
              <select value={promptModel} onChange={(event) => setPromptModel(event.target.value)} onBlur={() => void saveConfiguration()} className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 p-3 text-white outline-none">
                {promptModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
              <input value={promptModel} onChange={(event) => setPromptModel(event.target.value)} onBlur={() => void saveConfiguration()} className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 p-3 text-xs text-white outline-none" aria-label="Custom Ollama prompt model" />
            </label>

            <label className="block rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/65">
              Song length
              <select value={songLengthMinutes} onChange={(event) => changeSongLengthMinutes(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 p-3 text-white outline-none" aria-label="Song length">
                {radioSongLengthMinuteOptions.map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes} minute{minutes === 1 ? "" : "s"}</option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <span>
                <span className="block text-sm font-semibold text-white/75">Announce titles</span>
                <span className="block text-xs leading-5 text-white/45">Uses ~/Repos/par-tts-core-ts when provider credentials are available.</span>
              </span>
              <button type="button" aria-label="Toggle title announcements" onClick={() => changeAnnounce(!announceEnabled)} className={clsx("relative h-8 w-16 shrink-0 rounded-full transition", announceEnabled ? "bg-emerald-300" : "bg-white/20")}>
                <span className={clsx("absolute top-1 h-6 w-6 rounded-full bg-black shadow transition", announceEnabled ? "left-9" : "left-1")} />
              </button>
            </label>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/65">
              <div className="font-semibold text-white/75">TTS announcement</div>
              <label className="mt-3 block">
                Provider
                <select value={ttsProvider} onChange={(event) => changeTtsProvider(event.target.value as RadioTtsProvider)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 p-3 text-white outline-none">
                  <option value="openai">OpenAI</option>
                  <option value="elevenlabs">ElevenLabs</option>
                  <option value="deepgram">Deepgram</option>
                  <option value="gemini">Gemini</option>
                  <option value="kokoro-onnx">Kokoro</option>
                </select>
              </label>
              <label className="mt-3 block">
                Voice
                <select value={ttsVoice} onChange={(event) => changeTtsVoice(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 p-3 text-white outline-none" aria-label="TTS voice">
                  {ttsVoiceOptions.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.description ? `${voice.label} - ${voice.description}` : voice.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block">
                Prefix
                <input value={announcementPrefix} onChange={(event) => setAnnouncementPrefix(event.target.value)} onBlur={() => void saveConfiguration()} className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 p-3 text-white outline-none" aria-label="Announcement prefix" />
              </label>
              <label className="mt-3 block">
                Suffix
                <input value={announcementSuffix} onChange={(event) => setAnnouncementSuffix(event.target.value)} onBlur={() => void saveConfiguration()} className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 p-3 text-white outline-none" aria-label="Announcement suffix" />
              </label>
              <button
                type="button"
                onClick={() => void testVoice()}
                disabled={!!busy}
                className="mt-3 w-full rounded-xl border border-cyan-200/30 bg-cyan-300/12 px-4 py-3 font-bold text-cyan-50 transition hover:bg-cyan-300/20 disabled:cursor-wait disabled:opacity-55"
              >
                {busy === "voice" ? "Testing..." : "Test voice"}
              </button>
              {testVoiceAudioUrl && (
                <audio
                  ref={testVoiceAudioRef}
                  src={testVoiceAudioUrl}
                  controls
                  data-testid="test-voice-audio"
                  className="mt-3 w-full"
                  onError={() => setStatus("Could not play the generated test voice audio.")}
                />
              )}
            </div>
          </aside>

          <section className="min-w-0 rounded-[2rem] border border-white/10 bg-white/[0.065] p-4 shadow-[0_30px_120px_rgba(0,0,0,.28)] backdrop-blur-xl">
            <div className="grid gap-3 lg:grid-cols-2">
              <button type="button" onClick={draftNextPrompt} disabled={!!busy} className="rounded-full bg-white px-5 py-3 font-bold text-black transition hover:scale-[1.01] disabled:cursor-wait disabled:opacity-55">
                {busy === "draft" ? "Drafting..." : "Draft next prompt"}
              </button>
              <button type="button" onClick={generateDraftTrack} disabled={!!busy || !activeDraft} className="rounded-full border border-emerald-200/35 bg-emerald-300/18 px-5 py-3 font-bold text-emerald-50 transition hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-45">
                {busy === "maintenance" ? "Auto-filling queue..." : busy === "generate" ? "Generating..." : "Generate station song"}
              </button>
            </div>

            {status && <div className="mt-4 rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50/82">{status}</div>}

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <Panel title="Prompt draft">
                {activeDraft ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-2xl font-semibold tracking-[-0.025em] text-white">{activeDraft.title}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-white/38">
                        {activeDraft.promptProvider} • {activeDraft.promptModel} • {selectedStyle.label}
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-white/76">{activeDraft.prompt}</p>
                    <p className="rounded-2xl border border-white/10 bg-black/22 p-3 text-xs leading-5 text-white/45">Avoid: {activeDraft.negativePrompt}</p>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-white/48">Draft a prompt to start testing local Ollama taste matching for this style.</p>
                )}
              </Panel>

              <Panel title="Current stream track">
                {currentTrack ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-2xl font-semibold tracking-[-0.025em] text-white">{currentTrack.title}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-white/38">
                        {currentTrack.filename} • {trackProvenanceLabel(currentTrack)}
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-white/58">{currentTrack.prompt}</p>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-white/48">No registered station track yet. Generate a prompt, render an MP3, then this panel becomes the stream source.</p>
                )}
              </Panel>
            </div>

            {generated && !generated.ok && <pre className="mt-4 max-h-52 overflow-auto rounded-2xl bg-black/35 p-3 text-xs text-pink-100">{JSON.stringify(generated, null, 2)}</pre>}

            <Panel title={`${selectedStyle.label} queue`} className="mt-4">
              {selectedStyleQueue.length ? (
                <div className="grid gap-2">
                  {selectedStyleQueue.map((track) => {
                    const isCurrentTrack = track.filename === currentTrack?.filename;
                    const trackLiked = isRadioTrackLiked(track, radioState);
                    return (
                      <div
                        key={track.id}
                        aria-current={isCurrentTrack ? "true" : undefined}
                        className={clsx(
                          "min-w-0 rounded-2xl border p-3 transition",
                          isCurrentTrack ? "border-emerald-200/35 bg-emerald-200/[0.08]" : "border-white/10 bg-white/[0.035]",
                        )}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="min-w-0 truncate font-semibold text-white/82">{isCurrentTrack ? "Now playing: " : ""}{track.title}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.14em] text-white/35">{trackProvenanceLabel(track)}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {trackLiked && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/30 bg-amber-200/12 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-amber-100">
                                <HandThumbUpIcon className="h-4 w-4" aria-hidden="true" />
                                <span>Thumbs up</span>
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void selectLineupTrack(track)}
                              disabled={isCurrentTrack || busy === "select" || busy === "delete"}
                              aria-label={isCurrentTrack ? `Now playing ${track.title}` : `Play ${track.title}`}
                              className={clsx(
                                "touch-manipulation rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] transition disabled:cursor-default",
                                isCurrentTrack ? "border-emerald-200/30 bg-emerald-200/12 text-emerald-100/75" : "border-white/15 bg-white/[0.07] text-white/75 hover:border-emerald-200/35 hover:bg-emerald-200/12 hover:text-emerald-50",
                              )}
                            >
                              {isCurrentTrack ? "Playing" : busy === "select" ? "Loading" : "Play"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteLineupTrack(track)}
                              disabled={busy === "delete"}
                              aria-label={`Delete ${track.title}`}
                              title={`Delete ${track.title}`}
                              className="touch-manipulation rounded-full border border-rose-200/20 bg-rose-400/10 p-2 text-rose-100/80 transition hover:border-rose-200/40 hover:bg-rose-400/18 hover:text-rose-50 disabled:cursor-default disabled:opacity-45"
                            >
                              <TrashIcon className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-1 truncate text-xs text-white/42">{track.filename}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-white/45">No songs queued for this music style yet.</p>
              )}
            </Panel>

            <Panel title="Preference memory" className="mt-4">
              <div className="grid gap-3 md:grid-cols-2">
                <PreferenceList title="Likes" items={radioState?.preferences[selectedStyleId]?.likes ?? []} />
                <PreferenceList title="Dislikes" items={radioState?.preferences[selectedStyleId]?.dislikes ?? []} />
              </div>
            </Panel>
          </section>
        </section>
      </div>
    </main>
  );
}

function cleanPromptModels(models: string[]) {
  return models.map((model) => model.trim()).filter(Boolean);
}

function mergePromptModelOptions(models: string[], currentModel: string) {
  const source = models.length ? models : [...radioOllamaModels];
  return [...new Set([...source, currentModel].map((model) => model.trim()).filter(Boolean))];
}

function mergeCurrentVoiceOption(options: RadioTtsVoiceOption[], currentVoice: string) {
  if (!currentVoice || options.some((voice) => voice.id === currentVoice)) return options;
  return [{ id: currentVoice, label: currentVoice }, ...options];
}

function PlaylistUrlGroup({ label, urls }: { label: string; urls: RadioPlaylistUrls }) {
  return (
    <div>
      <div className="text-xs font-semibold text-emerald-100/85">{label}</div>
      <code className="mt-1 block break-all text-xs text-emerald-100/75">{urls.m3u}</code>
      <code className="mt-1 block break-all text-xs text-emerald-100/75">{urls.pls}</code>
    </div>
  );
}

function appendStreamReloadParam(streamUrl: string | undefined, reloadKey: number) {
  if (!streamUrl || reloadKey === 0) return streamUrl;
  const separator = streamUrl.includes("?") ? "&" : "?";
  return `${streamUrl}${separator}client=${reloadKey}`;
}

function appendSkipAnnouncementParam(streamUrl: string | undefined) {
  if (!streamUrl) return streamUrl;
  const separator = streamUrl.includes("?") ? "&" : "?";
  return `${streamUrl}${separator}skipAnnouncement=1`;
}

function useBrowserOriginStreamUrl(streamUrl: string | undefined) {
  const [browserOrigin, setBrowserOrigin] = useState("");

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  return useMemo(() => {
    if (!streamUrl || !browserOrigin) return streamUrl;
    try {
      const url = new URL(streamUrl, browserOrigin);
      const origin = new URL(browserOrigin);
      url.protocol = origin.protocol;
      url.host = origin.host;
      return url.toString();
    } catch {
      return `${browserOrigin}/api/radio?stream=1`;
    }
  }, [browserOrigin, streamUrl]);
}

function useBrowserOriginOutputUrl(filename: string | undefined) {
  const [browserOrigin, setBrowserOrigin] = useState("");

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  return useMemo(() => {
    if (!filename || !browserOrigin) return undefined;
    return `${browserOrigin}/outputs/${encodeURIComponent(filename)}`;
  }, [browserOrigin, filename]);
}

function readAudioCurrentTime(audio: HTMLAudioElement | null) {
  return audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function useStableRadioStreamUrl(trackFilename: string | undefined, streamUrl: string | undefined) {
  const [stableStreamUrl, setStableStreamUrl] = useState(streamUrl);
  const stableTrackRef = useRef(trackFilename);

  useEffect(() => {
    if (!trackFilename || !streamUrl) {
      stableTrackRef.current = undefined;
      setStableStreamUrl(undefined);
      return;
    }
    if (stableTrackRef.current !== trackFilename) {
      stableTrackRef.current = trackFilename;
      setStableStreamUrl(streamUrl);
      return;
    }
    if (stableStreamUrl && urlOrigin(stableStreamUrl) !== urlOrigin(streamUrl)) {
      setStableStreamUrl(streamUrl);
      return;
    }
    if (!stableStreamUrl) setStableStreamUrl(streamUrl);
  }, [trackFilename, streamUrl, stableStreamUrl]);

  return stableStreamUrl;
}

function urlOrigin(value: string) {
  try {
    return new URL(value, "http://localhost").origin;
  } catch {
    return "";
  }
}

function trackFeedbackKey(track: RadioTrackRecord | undefined) {
  return track?.id ?? track?.filename ?? null;
}

function trackProvenanceLabel(track: RadioTrackRecord) {
  const source = track.source === "library-fallback" ? "Library fallback" : undefined;
  return [track.styleId, source, `${track.promptProvider ?? "unknown"} ${track.promptModel ?? ""}`.trim()].filter(Boolean).join(" • ");
}

function isRadioTrackLiked(track: RadioTrackRecord | undefined, state: RadioStreamState | null) {
  if (!track) return false;
  if (track.rating === "up") return true;
  return state?.preferences[track.styleId]?.likes.includes(track.prompt) ?? false;
}

function hasRadioTrackFeedback(track: RadioTrackRecord, state: RadioStreamState | null) {
  if (track.rating === "up" || track.rating === "down") return true;
  const preference = state?.preferences[track.styleId];
  return !!preference && (preference.likes.includes(track.prompt) || preference.dislikes.includes(track.prompt));
}

function Panel({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={clsx("min-w-0 rounded-3xl border border-white/10 bg-black/25 p-4", className)}>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-white/45">{title}</h2>
      {children}
    </section>
  );
}

function PreferenceList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <div className="mb-2 text-sm font-semibold text-white/70">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-white/38">No feedback recorded yet.</div>
      ) : (
        <ul className="space-y-2 text-sm leading-5 text-white/62">
          {items.slice().reverse().map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}
