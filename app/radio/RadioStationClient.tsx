"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ForwardIcon, HandThumbDownIcon, HandThumbUpIcon, PencilSquareIcon, SparklesIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { buildRadioStats, defaultRadioTtsVoice, getRadioTtsVoiceOptions, normalizeRadioSongLengthMinutes, normalizeRadioUnlikedTrackExpirationHours, radioOllamaModels, radioSongLengthMinuteOptions, radioStyles, radioUnlikedTrackExpirationHourOptions, type RadioPlaylistUrls, type RadioPromptDraft, type RadioStats, type RadioStreamState, type RadioStyle, type RadioStyleDraft, type RadioStyleId, type RadioTrackRecord, type RadioTtsProvider, type RadioTtsVoiceOption } from "@/lib/radio";

type RadioApiResponse = { ok: boolean; state?: RadioStreamState; draft?: RadioPromptDraft; style?: RadioStyle; styleDraft?: RadioStyleDraft; deletedStyle?: RadioStyle; fallbackTrack?: RadioTrackRecord; rejectedTrack?: RadioTrackRecord; skippedTrack?: RadioTrackRecord; deletedTrack?: RadioTrackRecord; cleanedTracks?: RadioTrackRecord[]; promptModels?: string[]; voices?: RadioTtsVoiceOption[]; error?: string };
type RadioTestVoiceResponse = { ok: boolean; audioUrl?: string; error?: string };
type GenerateResponse = { ok: boolean; filename?: string; title?: string; audioUrl?: string; meta?: unknown; error?: string };
type AudioAssessment = { summary?: string; attributes?: { instruments?: string[]; mood?: string[]; genre?: string[]; rhythm?: string; tempoBpm?: number; key?: string }; model?: string };
type AssessmentResponse = { ok: boolean; assessment?: AudioAssessment; error?: string };
type PreferenceMemoryItem = { phrase: string; assessment?: AudioAssessment };
const RADIO_STATE_RETRY_MS = 1500;
const RADIO_STATE_POLL_MS = 30000;
type RadioPlaybackPhase = "announcement" | "song";

export default function RadioStationClient({ initialState = null, initialPromptModels = [] }: { initialState?: RadioStreamState | null; initialPromptModels?: string[] }) {
  const [radioState, setRadioState] = useState<RadioStreamState | null>(initialState);
  const [selectedStyleId, setSelectedStyleId] = useState<RadioStyleId>(initialState?.selectedStyleId ?? "synthwave");
  const [promptModel, setPromptModel] = useState<string>(initialState?.promptModel ?? radioOllamaModels[0]);
  const [promptModels, setPromptModels] = useState<string[]>(() => cleanPromptModels(initialPromptModels));
  const [announceEnabled, setAnnounceEnabled] = useState(initialState?.announceEnabled ?? true);
  const [songLengthMinutes, setSongLengthMinutes] = useState(() => normalizeRadioSongLengthMinutes(initialState?.songLengthMinutes));
  const [unlikedTrackExpirationHours, setUnlikedTrackExpirationHours] = useState(() => normalizeRadioUnlikedTrackExpirationHours(initialState?.unlikedTrackExpirationHours));
  const [ttsProvider, setTtsProvider] = useState<RadioTtsProvider>(initialState?.ttsProvider ?? "openai");
  const [ttsVoice, setTtsVoice] = useState(initialState?.ttsVoice ?? "nova");
  const [announcementPrefix, setAnnouncementPrefix] = useState(initialState?.announcementPrefix ?? "Now playing: ");
  const [announcementSuffix, setAnnouncementSuffix] = useState(initialState?.announcementSuffix ?? "");
  const [styleRequest, setStyleRequest] = useState("");
  const [editingStyleId, setEditingStyleId] = useState<RadioStyleId | null>(null);
  const [styleLabel, setStyleLabel] = useState("");
  const [styleSeedPrompt, setStyleSeedPrompt] = useState("");
  const [styleNegativePrompt, setStyleNegativePrompt] = useState("");
  const [draft, setDraft] = useState<RadioPromptDraft | null>(initialState?.currentDraft ?? null);
  const [generated, setGenerated] = useState<GenerateResponse | null>(null);
  const [status, setStatus] = useState("");
  const [testVoiceAudioUrl, setTestVoiceAudioUrl] = useState("");
  const [remoteTtsVoiceOptions, setRemoteTtsVoiceOptions] = useState<{ provider: RadioTtsProvider; voices: RadioTtsVoiceOption[] } | null>(null);
  const [browserStreamUrl, setBrowserStreamUrl] = useState(initialState?.streamUrl ?? initialState?.lanStreamUrl ?? "");
  const [busy, setBusy] = useState<"draft" | "generate" | "rating" | "config" | "maintenance" | "select" | "delete" | "voice" | "style" | "styleDraft" | "assess" | null>(null);
  const [currentAssessment, setCurrentAssessment] = useState<AudioAssessment | null>(null);
  const [currentAssessmentError, setCurrentAssessmentError] = useState("");
  const [optimisticLike, setOptimisticLike] = useState<{ trackKey: string; liked: boolean } | null>(null);
  const [selectedQueueTrackIds, setSelectedQueueTrackIds] = useState<Set<string>>(() => new Set());
  const [streamReloadKey, setStreamReloadKey] = useState(0);
  const [trackElapsedSeconds, setTrackElapsedSeconds] = useState(0);
  const [playbackPhase, setPlaybackPhase] = useState<RadioPlaybackPhase>(() => initialState?.announceEnabled !== false && initialState?.currentTrack?.announcementFilename ? "announcement" : "song");
  const audioRef = useRef<HTMLAudioElement>(null);
  const testVoiceAudioRef = useRef<HTMLAudioElement>(null);
  const loadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamElapsedAtTrackStartRef = useRef(0);
  const resumeAfterStreamReloadRef = useRef(false);

  const availableStyles = useMemo(() => radioState?.styles?.length ? radioState.styles : radioStyles, [radioState?.styles]);
  const selectedStyle = useMemo(() => availableStyles.find((style) => style.id === selectedStyleId) ?? availableStyles[0] ?? radioStyles[0], [availableStyles, selectedStyleId]);
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
  const selectedQueueTracks = useMemo(
    () => selectedStyleQueue.filter((track) => selectedQueueTrackIds.has(track.id)),
    [selectedQueueTrackIds, selectedStyleQueue],
  );
  const preferenceLikeItems = useMemo(
    () => buildPreferenceMemoryItems(radioState, selectedStyleId, "up"),
    [radioState, selectedStyleId],
  );
  const preferenceDislikeItems = useMemo(
    () => buildPreferenceMemoryItems(radioState, selectedStyleId, "down"),
    [radioState, selectedStyleId],
  );
  const selectedQueueCount = selectedQueueTracks.length;
  const allQueueTracksSelected = selectedStyleQueue.length > 0 && selectedQueueCount === selectedStyleQueue.length;
  const activeDraft = draft ?? radioState?.currentDraft ?? null;
  const browserOriginStreamUrl = useBrowserOriginStreamUrl(radioState?.streamUrl ?? radioState?.lanStreamUrl ?? browserStreamUrl);
  const visibleStreamUrl = browserOriginStreamUrl;
  const publicPlaylistUrls = radioState?.publicPlaylistUrls;
  const lanPlaylistUrls = radioState?.lanPlaylistUrls;
  const stablePlayerStreamUrl = useStableRadioStreamUrl(currentTrack?.filename, browserOriginStreamUrl);
  const currentTrackHasAnnouncement = !!currentTrack?.announcementFilename;
  const shouldPlayCurrentAnnouncement = announceEnabled && currentTrackHasAnnouncement;
  const announcementUrl = useBrowserOriginOutputUrl(shouldPlayCurrentAnnouncement ? currentTrack?.announcementFilename : undefined);
  const songStreamUrl = useMemo(
    () => currentTrackHasAnnouncement ? appendSkipAnnouncementParam(stablePlayerStreamUrl) : stablePlayerStreamUrl,
    [currentTrackHasAnnouncement, stablePlayerStreamUrl],
  );
  const reloadedSongStreamUrl = useMemo(() => appendStreamReloadParam(songStreamUrl, streamReloadKey), [songStreamUrl, streamReloadKey]);
  const playerStreamUrl = shouldPlayCurrentAnnouncement && playbackPhase === "announcement" && announcementUrl ? announcementUrl : reloadedSongStreamUrl;
  const currentTrackKey = trackFeedbackKey(currentTrack);
  const currentTrackLiked = optimisticLike?.trackKey === currentTrackKey ? optimisticLike.liked : isRadioTrackLiked(currentTrack, radioState);
  const radioStats = useMemo<RadioStats | null>(() => radioState ? radioState.stats ?? buildRadioStats(radioState) : null, [radioState]);
  const songDurationSeconds = songLengthMinutes * 60;
  const trackDurationSeconds = currentTrack?.durationSeconds ?? songDurationSeconds;
  const safeTrackElapsedSeconds = Math.min(trackElapsedSeconds, trackDurationSeconds);
  const skipDisabled = !currentTrack || (!!busy && busy !== "maintenance");

  useEffect(() => {
    setBrowserStreamUrl(`${window.location.origin}/api/radio?stream=1`);
    const includePromptModels = promptModels.length === 0;
    void loadState({ includePromptModels });
    const poll = setInterval(() => void loadState({ includePromptModels: false }), RADIO_STATE_POLL_MS);
    return () => {
      if (loadRetryTimerRef.current) clearTimeout(loadRetryTimerRef.current);
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    setOptimisticLike(null);
    setCurrentAssessment(null);
    setCurrentAssessmentError("");
    setTrackElapsedSeconds(0);
    setPlaybackPhase(shouldPlayCurrentAnnouncement ? "announcement" : "song");
    streamElapsedAtTrackStartRef.current = readAudioCurrentTime(audioRef.current);
  }, [currentTrackKey, shouldPlayCurrentAnnouncement]);

  useEffect(() => {
    const visibleIds = new Set(selectedStyleQueue.map((track) => track.id));
    setSelectedQueueTrackIds((previous) => {
      const next = new Set([...previous].filter((trackId) => visibleIds.has(trackId)));
      return next.size === previous.size ? previous : next;
    });
  }, [selectedStyleQueue]);

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

  async function loadState(options: { includePromptModels?: boolean } = {}) {
    try {
      const stateUrl = options.includePromptModels === false ? "/api/radio?promptModels=0" : "/api/radio";
      const response = await fetch(stateUrl, { cache: "no-store" });
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
      setUnlikedTrackExpirationHours(normalizeRadioUnlikedTrackExpirationHours(json.state.unlikedTrackExpirationHours));
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
          void loadState(options);
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
      setSelectedStyleId(json.state.selectedStyleId);
      setSongLengthMinutes(normalizeRadioSongLengthMinutes(json.state.songLengthMinutes));
      setUnlikedTrackExpirationHours(normalizeRadioUnlikedTrackExpirationHours(json.state.unlikedTrackExpirationHours));
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
    nextUnlikedTrackExpirationHours = unlikedTrackExpirationHours,
    nextTtsProvider = ttsProvider,
    nextTtsVoice = ttsVoice,
    nextAnnouncementPrefix = announcementPrefix,
    nextAnnouncementSuffix = announcementSuffix,
  }: {
    nextStyleId?: RadioStyleId;
    nextPromptModel?: string;
    nextAnnounceEnabled?: boolean;
    nextSongLengthMinutes?: number;
    nextUnlikedTrackExpirationHours?: number;
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
        unlikedTrackExpirationHours: nextUnlikedTrackExpirationHours,
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
      setStatus("Track registered for the radio stream. Prompt provider/model were written to metadata.");
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

  async function rateCurrent(rating: "up" | "down") {
    const phrase = currentTrack?.prompt ?? activeDraft?.prompt ?? "";
    const ratedTrackKey = trackFeedbackKey(currentTrack);
    if (ratedTrackKey) setOptimisticLike({ trackKey: ratedTrackKey, liked: rating === "up" ? !currentTrackLiked : false });
    setBusy("rating");
    setStatus(rating === "up" ? "Recording thumbs up..." : "Recording thumbs down...");
    try {
      const json = await postRadio({ action: "rating", rating, styleId: currentTrack?.styleId ?? selectedStyleId, phrase });
      if (ratedTrackKey) setOptimisticLike(null);
      if (json.rejectedTrack) {
        setStatus(json.state?.currentTrack ? `Removed "${json.rejectedTrack.title}" and skipped to "${json.state.currentTrack.title}".` : `Removed "${json.rejectedTrack.title}". Generate another station song to continue.`);
      } else {
        setStatus("Preference saved for future prompt drafts.");
      }
    } catch (error) {
      if (ratedTrackKey) setOptimisticLike(null);
      setStatus(error instanceof Error ? error.message : "Could not save preference.");
    } finally {
      setBusy(null);
    }
  }

  async function assessCurrentTrack() {
    if (!currentTrack) return;
    setBusy("assess");
    setCurrentAssessmentError("");
    setStatus(`Assessing "${currentTrack.title}"...`);
    try {
      const response = await fetch("/api/assess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: currentTrack.filename,
          source: "radio",
          title: currentTrack.title,
          prompt: currentTrack.prompt,
          styleId: currentTrack.styleId,
          rating: currentTrack.rating,
        }),
      });
      const json = await response.json() as AssessmentResponse;
      if (!json.ok || !json.assessment) throw new Error(json.error ?? "Audio assessment failed");
      setCurrentAssessment(json.assessment);
      setStatus("Audio assessment saved to the track metadata.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Audio assessment failed.";
      setCurrentAssessmentError(message);
      setStatus(message);
    } finally {
      setBusy(null);
    }
  }

  async function rateLineupTrack(track: RadioTrackRecord, rating: "up" | "down") {
    setBusy("rating");
    setStatus(rating === "up" ? `Recording thumbs up for "${track.title}"...` : `Recording thumbs down for "${track.title}"...`);
    try {
      const json = await postRadio({ action: "rating", rating, filename: track.filename, styleId: track.styleId, phrase: track.prompt });
      if (json.rejectedTrack) {
        setStatus(json.state?.currentTrack ? `Removed "${json.rejectedTrack.title}" and skipped to "${json.state.currentTrack.title}".` : `Removed "${json.rejectedTrack.title}". Generate another station song to continue.`);
      } else {
        setStatus(`Preference saved for "${track.title}".`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save queue preference.");
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
        setStatus(json.skippedTrack ? `Skipped "${json.skippedTrack.title}" and loaded "${nextTrack.title}".` : `Loaded "${nextTrack.title}".`);
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
      setStatus(json.state?.currentTrack ? `Now playing "${json.state.currentTrack.title}".` : "Selected lineup song.");
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
      setStatus(json.deletedTrack ? `Deleted "${json.deletedTrack.title}" from the radio queue.` : "Deleted radio queue item.");
    } catch (error) {
      resumeAfterStreamReloadRef.current = false;
      setStatus(error instanceof Error ? error.message : "Could not delete radio queue item.");
    } finally {
      setBusy(null);
    }
  }

  function toggleQueueTrackSelection(trackId: string, selected: boolean) {
    setSelectedQueueTrackIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(trackId);
      else next.delete(trackId);
      return next;
    });
  }

  function toggleAllQueueTrackSelection(selected: boolean) {
    setSelectedQueueTrackIds(selected ? new Set(selectedStyleQueue.map((track) => track.id)) : new Set());
  }

  async function deleteSelectedLineupTracks() {
    const tracks = selectedQueueTracks;
    if (!tracks.length) return;
    const countText = tracks.length === 1 ? `"${tracks[0].title}"` : `${tracks.length} selected songs`;
    const confirmed = window.confirm(`Delete ${countText} from the radio queue and remove their audio files? Feedback metadata will be kept for liked/disliked tracks.`);
    if (!confirmed) return;

    setBusy("delete");
    setStatus(`Deleting ${tracks.length} selected ${tracks.length === 1 ? "song" : "songs"}...`);
    try {
      const deletedTrackIds = new Set(tracks.map((track) => track.id));
      const deletedCurrentTrack = tracks.some((track) => track.filename === currentTrack?.filename);
      for (const track of tracks) {
        await postRadio({ action: "deleteTrack", filename: track.filename });
      }
      if (deletedCurrentTrack) {
        resumeAfterStreamReloadRef.current = true;
        setStreamReloadKey((key) => key + 1);
        setTrackElapsedSeconds(0);
      }
      setSelectedQueueTrackIds((previous) => {
        const next = new Set(previous);
        for (const trackId of deletedTrackIds) next.delete(trackId);
        return next;
      });
      setStatus(`Deleted ${tracks.length} selected ${tracks.length === 1 ? "song" : "songs"} from the radio queue.`);
    } catch (error) {
      resumeAfterStreamReloadRef.current = false;
      setStatus(error instanceof Error ? error.message : "Could not delete selected radio queue items.");
    } finally {
      setBusy(null);
    }
  }

  function changeStyle(styleId: RadioStyleId) {
    setSelectedStyleId(styleId);
    void saveConfiguration({ nextStyleId: styleId });
  }

  async function draftCustomStyleWithCodex() {
    setBusy("styleDraft");
    setStatus("Asking Codex CLI for style prompts...");
    try {
      const json = await postRadio({ action: "draftStyle", request: styleRequest });
      if (!json.styleDraft) throw new Error("Codex did not return a style draft.");
      setStyleLabel(json.styleDraft.label);
      setStyleSeedPrompt(json.styleDraft.seedPrompt);
      setStyleNegativePrompt(json.styleDraft.negativePrompt);
      setEditingStyleId(null);
      setStatus(`Drafted ${json.styleDraft.label}${json.styleDraft.model ? ` with ${json.styleDraft.model}` : ""}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not draft music style prompts.");
    } finally {
      setBusy(null);
    }
  }

  async function saveCustomStyle() {
    setBusy("style");
    setStatus(editingStyleId ? "Saving music style..." : "Creating music style...");
    try {
      const json = await postRadio({
        action: editingStyleId ? "updateStyle" : "createStyle",
        ...(editingStyleId ? { styleId: editingStyleId } : {}),
        label: styleLabel,
        seedPrompt: styleSeedPrompt,
        negativePrompt: styleNegativePrompt,
      });
      if (json.style) {
        setSelectedStyleId(json.style.id);
        setEditingStyleId(null);
        setStyleLabel("");
        setStyleSeedPrompt("");
        setStyleNegativePrompt("");
        setStatus(editingStyleId ? `Saved ${json.style.label}.` : `Created ${json.style.label}.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save music style.");
    } finally {
      setBusy(null);
    }
  }

  function editCustomStyle(style: RadioStyle) {
    setEditingStyleId(style.id);
    setStyleLabel(style.label);
    setStyleSeedPrompt(style.seedPrompt);
    setStyleNegativePrompt(style.negativePrompt);
    setStatus(`Editing ${style.label}.`);
  }

  function cancelStyleEdit() {
    setEditingStyleId(null);
    setStyleLabel("");
    setStyleSeedPrompt("");
    setStyleNegativePrompt("");
  }

  async function deleteCustomStyle(style: RadioStyle) {
    if (!window.confirm(`Delete ${style.label}? Existing generated songs are kept, but this style will be removed from the station menu.`)) return;
    setBusy("style");
    setStatus(`Deleting ${style.label}...`);
    try {
      await postRadio({ action: "deleteStyle", styleId: style.id });
      if (editingStyleId === style.id) cancelStyleEdit();
      setStatus(`Deleted ${style.label}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete music style.");
    } finally {
      setBusy(null);
    }
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

  function changeUnlikedTrackExpirationHours(hoursInput: string) {
    const hours = normalizeRadioUnlikedTrackExpirationHours(hoursInput);
    setUnlikedTrackExpirationHours(hours);
    void saveConfiguration({ nextUnlikedTrackExpirationHours: hours });
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
    void loadState({ includePromptModels: false });
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
            <h1 className="mt-1 text-3xl font-light tracking-[-0.04em] text-white sm:mt-2 sm:text-5xl">Pardora</h1>
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
                {availableStyles.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
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

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
              <button type="button" onClick={() => void assessCurrentTrack()} disabled={!!busy || !currentTrack} aria-label="Assess current song" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-sky-200/30 bg-sky-300/12 px-3 py-3 text-sm font-bold text-sky-50 disabled:opacity-45">
                <SparklesIcon className="h-5 w-5" />
                <span>{busy === "assess" ? "Assessing" : "Assess"}</span>
              </button>
            </div>
          </div>
          <RadioAssessmentPanel assessment={currentAssessment} error={currentAssessmentError} loading={busy === "assess"} />
          <AssessmentQueueStatusPanel queue={radioState?.assessmentQueue} />
          <div aria-label="Station stats" className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Songs generated" value={radioStats ? formatStatNumber(radioStats.generatedSongCount) : "--"} />
            <StatTile label="Thumbs up" value={radioStats ? formatStatNumber(radioStats.thumbsUpCount) : "--"} />
            <StatTile label="Thumbs down" value={radioStats ? formatStatNumber(radioStats.thumbsDownCount) : "--"} />
            <StatTile label="Audio on disk" value={radioStats ? formatAudioBytes(radioStats.audioDiskBytes) : "--"} />
          </div>
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(320px,410px)_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-[2rem] border border-white/10 bg-black/24 p-4">
            <div>
              <h2 className="text-lg font-semibold">Music style</h2>
              <div className="mt-3 grid gap-2">
                {availableStyles.map((style) => (
                  <div
                    key={style.id}
                    className={clsx(
                      "rounded-2xl border p-3 transition",
                      selectedStyleId === style.id ? "border-emerald-200/45 bg-emerald-200/15" : "border-white/10 bg-white/[0.04]",
                    )}
                  >
                    <button type="button" onClick={() => changeStyle(style.id)} className="block w-full text-left">
                      <div className="font-semibold text-white/88">{style.label}</div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{style.seedPrompt}</div>
                    </button>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => editCustomStyle(style)} disabled={!!busy} aria-label={`Edit ${style.label}`} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/72 hover:bg-white/[0.1] disabled:opacity-45">
                        <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button type="button" onClick={() => void deleteCustomStyle(style)} disabled={!!busy} aria-label={`Delete ${style.label}`} className="inline-flex items-center gap-2 rounded-full border border-rose-200/20 bg-rose-400/10 px-3 py-2 text-xs font-bold text-rose-100/80 hover:bg-rose-400/18 disabled:opacity-45">
                        <TrashIcon className="h-4 w-4" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form
              className="space-y-3 rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.05] p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void saveCustomStyle();
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white/78">{editingStyleId ? "Edit music style" : "New music style"}</h3>
                {editingStyleId ? (
                  <button type="button" onClick={cancelStyleEdit} aria-label="Cancel style edit" className="rounded-full border border-white/15 bg-white/[0.06] p-2 text-white/70 hover:bg-white/[0.1]">
                    <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <label className="block text-xs font-semibold text-white/55">
                Describe style
                <textarea value={styleRequest} onChange={(event) => setStyleRequest(event.target.value)} rows={2} className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/45 p-3 text-sm leading-5 text-white outline-none" />
              </label>
              <button type="button" onClick={() => void draftCustomStyleWithCodex()} disabled={!!busy || styleRequest.trim().length < 3} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-200/30 bg-cyan-300/12 px-4 py-3 text-sm font-bold text-cyan-50 transition hover:bg-cyan-300/20 disabled:opacity-45">
                <SparklesIcon className="h-4 w-4" aria-hidden="true" />
                <span>{busy === "styleDraft" ? "Generating style prompts..." : "Generate style prompts with Codex"}</span>
              </button>
              <label className="block text-xs font-semibold text-white/55">
                Style name
                <input value={styleLabel} onChange={(event) => setStyleLabel(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/45 p-3 text-sm font-semibold text-white outline-none" />
              </label>
              <label className="block text-xs font-semibold text-white/55">
                Style prompt
                <textarea value={styleSeedPrompt} onChange={(event) => setStyleSeedPrompt(event.target.value)} rows={3} className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/45 p-3 text-sm leading-5 text-white outline-none" />
              </label>
              <label className="block text-xs font-semibold text-white/55">
                Style negative prompt
                <textarea value={styleNegativePrompt} onChange={(event) => setStyleNegativePrompt(event.target.value)} rows={2} className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/45 p-3 text-sm leading-5 text-white outline-none" />
              </label>
              <button type="submit" disabled={!!busy || !styleLabel.trim() || !styleSeedPrompt.trim()} className="w-full rounded-xl border border-emerald-200/35 bg-emerald-200/15 px-4 py-3 text-sm font-bold text-emerald-50 transition hover:bg-emerald-200/22 disabled:opacity-45">
                {busy === "style" ? (editingStyleId ? "Saving..." : "Creating...") : editingStyleId ? "Save music style" : "Create music style"}
              </button>
            </form>

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

            <label className="block rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/65">
              Unliked song expiration
              <select value={unlikedTrackExpirationHours} onChange={(event) => changeUnlikedTrackExpirationHours(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 p-3 text-white outline-none" aria-label="Unliked song expiration">
                {radioUnlikedTrackExpirationHourOptions.map((hours) => (
                  <option key={hours} value={hours}>{hours} hour{hours === 1 ? "" : "s"}</option>
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
                  <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/18 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.14em] text-white/58">
                      <input
                        type="checkbox"
                        checked={allQueueTracksSelected}
                        onChange={(event) => toggleAllQueueTrackSelection(event.currentTarget.checked)}
                        aria-label={`Select all ${selectedStyle.label} queue songs`}
                        disabled={busy === "delete"}
                        className="h-4 w-4 accent-rose-300"
                      />
                      <span>{selectedQueueCount ? `${selectedQueueCount} selected` : "Select queue songs"}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => void deleteSelectedLineupTracks()}
                      disabled={selectedQueueCount === 0 || busy === "delete"}
                      className="touch-manipulation rounded-full border border-rose-200/25 bg-rose-400/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-rose-100/85 transition hover:border-rose-200/45 hover:bg-rose-400/18 hover:text-rose-50 disabled:cursor-default disabled:opacity-45"
                    >
                      {busy === "delete" && selectedQueueCount ? "Removing..." : `Remove selected (${selectedQueueCount})`}
                    </button>
                  </div>
                  {selectedStyleQueue.map((track) => {
                    const isCurrentTrack = track.filename === currentTrack?.filename;
                    const trackLiked = isRadioTrackLiked(track, radioState);
                    const trackDisliked = isRadioTrackDisliked(track, radioState);
                    const trackSelected = selectedQueueTrackIds.has(track.id);
                    return (
                      <div
                        key={track.id}
                        aria-current={isCurrentTrack ? "true" : undefined}
                        className={clsx(
                          "min-w-0 rounded-2xl border p-3 transition",
                          trackSelected ? "border-rose-200/35 bg-rose-300/[0.08]" : isCurrentTrack ? "border-emerald-200/35 bg-emerald-200/[0.08]" : "border-white/10 bg-white/[0.035]",
                        )}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <input
                              type="checkbox"
                              checked={trackSelected}
                              onChange={(event) => toggleQueueTrackSelection(track.id, event.currentTarget.checked)}
                              aria-label={`Select ${track.title}`}
                              disabled={busy === "delete"}
                              className="mt-1 h-4 w-4 shrink-0 accent-rose-300"
                            />
                            <div className="min-w-0">
                              <div className="min-w-0 truncate font-semibold text-white/82">{isCurrentTrack ? "Now playing: " : ""}{track.title}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.14em] text-white/35">{trackProvenanceLabel(track)}</div>
                              <QueueTrackMetadata track={track} />
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void rateLineupTrack(track, "up")}
                              disabled={busy === "rating" || busy === "delete"}
                              aria-label={`Thumbs up ${track.title}`}
                              aria-pressed={trackLiked}
                              className={clsx(
                                "touch-manipulation rounded-full border p-2 transition disabled:cursor-default disabled:opacity-45",
                                trackLiked ? "border-amber-200/45 bg-amber-200/18 text-amber-100" : "border-white/15 bg-white/[0.07] text-white/65 hover:border-amber-200/35 hover:bg-amber-200/12 hover:text-amber-50",
                              )}
                            >
                              <HandThumbUpIcon className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void rateLineupTrack(track, "down")}
                              disabled={busy === "rating" || busy === "delete"}
                              aria-label={`Thumbs down ${track.title}`}
                              aria-pressed={trackDisliked}
                              className={clsx(
                                "touch-manipulation rounded-full border p-2 transition disabled:cursor-default disabled:opacity-45",
                                trackDisliked ? "border-pink-200/45 bg-pink-400/18 text-pink-100" : "border-white/15 bg-white/[0.07] text-white/65 hover:border-pink-200/35 hover:bg-pink-400/12 hover:text-pink-50",
                              )}
                            >
                              <HandThumbDownIcon className="h-4 w-4" aria-hidden="true" />
                            </button>
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
                        <QueueTrackMetadata track={track} />
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
                <PreferenceList title="Likes" items={preferenceLikeItems} />
                <PreferenceList title="Dislikes" items={preferenceDislikeItems} />
              </div>
            </Panel>
          </section>
        </section>
      </div>
    </main>
  );
}

function RadioAssessmentPanel({ assessment, error, loading }: { assessment: AudioAssessment | null; error: string; loading: boolean }) {
  if (!assessment && !error && !loading) return null;
  const attrs = assessment?.attributes ?? {};
  const details = [
    attrs.tempoBpm ? `${attrs.tempoBpm} BPM` : undefined,
    attrs.key,
    attrs.rhythm,
    attrs.genre?.join(", "),
  ].filter(Boolean);
  return (
    <div className="mt-3 rounded-2xl border border-sky-200/15 bg-sky-300/[0.06] p-3">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100/70">Model assessment</div>
      {loading ? <p className="mt-2 text-sm leading-6 text-white/72">Listening and assessing the current song...</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm leading-6 text-rose-100">{error}</p> : null}
      {assessment?.summary ? <p className="mt-2 text-sm leading-6 text-white/72">{assessment.summary}</p> : null}
      {details.length ? <div className="mt-2 text-xs font-semibold text-sky-100/70">{details.join(" / ")}</div> : null}
      {attrs.instruments?.length ? <div className="mt-2 text-xs text-white/48">Instruments: {attrs.instruments.join(", ")}</div> : null}
      {attrs.mood?.length ? <div className="mt-1 text-xs text-white/48">Mood: {attrs.mood.join(", ")}</div> : null}
    </div>
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

function QueueTrackMetadata({ track }: { track: RadioTrackRecord }) {
  const createdAtText = formatTrackCreatedAt(track.createdAt);
  const ageText = formatTrackAge(track.createdAt);
  const fileSizeText = formatBytes(track.fileSizeBytes);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/38">
      <span>
        Created <time dateTime={track.createdAt}>{createdAtText}</time>
      </span>
      <span aria-hidden="true">•</span>
      <span>{ageText}</span>
      {fileSizeText ? (
        <>
          <span aria-hidden="true">•</span>
          <span>{fileSizeText}</span>
        </>
      ) : null}
    </div>
  );
}

function formatTrackCreatedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatTrackAge(value: string, nowMs = Date.now()) {
  const createdMs = Date.parse(value);
  if (!Number.isFinite(createdMs)) return "age unknown";
  const elapsedMs = Math.max(0, nowMs - createdMs);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (elapsedMs < minuteMs) return "just now";
  if (elapsedMs < hourMs) {
    const minutes = Math.floor(elapsedMs / minuteMs);
    return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
  }
  if (elapsedMs < dayMs) {
    const hours = Math.floor(elapsedMs / hourMs);
    return `${hours} hour${hours === 1 ? "" : "s"} old`;
  }
  const days = Math.floor(elapsedMs / dayMs);
  return `${days} day${days === 1 ? "" : "s"} old`;
}

function formatBytes(bytes: number | undefined) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${Math.round(value)} ${units[unitIndex]}`;
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision).replace(/\.0$/, "")} ${units[unitIndex]}`;
}

function isRadioTrackLiked(track: RadioTrackRecord | undefined, state: RadioStreamState | null) {
  if (!track) return false;
  if (track.rating === "up") return true;
  return state?.preferences[track.styleId]?.likes.includes(track.prompt) ?? false;
}

function isRadioTrackDisliked(track: RadioTrackRecord | undefined, state: RadioStreamState | null) {
  if (!track) return false;
  if (track.rating === "down") return true;
  return state?.preferences[track.styleId]?.dislikes.includes(track.prompt) ?? false;
}

function hasRadioTrackFeedback(track: RadioTrackRecord, state: RadioStreamState | null) {
  if (track.rating === "up" || track.rating === "down") return true;
  const preference = state?.preferences[track.styleId];
  return !!preference && (preference.likes.includes(track.prompt) || preference.dislikes.includes(track.prompt));
}

function formatStatNumber(value: number) {
  return Math.max(0, value).toLocaleString("en-US");
}

function formatAudioBytes(bytes: number) {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes < 1024) return `${safeBytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = safeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatPercent(value: number | undefined) {
  return `${Math.round(Math.max(0, value ?? 0) * 100)}%`;
}

function AssessmentQueueStatusPanel({ queue }: { queue: RadioStreamState["assessmentQueue"] | undefined }) {
  const status = queue?.status ?? "idle";
  const pendingCount = queue?.pendingCount ?? 0;
  const nextText = queue?.nextFilename
    ? `Next: ${queue.nextFilename}${queue.nextRating !== undefined ? ` (${queue.nextRating})` : ""}`
    : "Next: none";
  return (
    <div aria-label="Assessment queue status" className="mt-3 rounded-2xl border border-sky-200/15 bg-sky-300/[0.07] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-sky-100/60">Assessment queue</div>
          <div className="mt-1 text-sm font-semibold text-sky-50">{formatAssessmentQueueStatus(status)}</div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-lg font-semibold tracking-[-0.02em] text-white">{pendingCount} pending</div>
          <div className="text-xs font-semibold text-sky-100/68">Load {formatPercent(queue?.loadRatio)} / limit {formatPercent(queue?.loadThreshold)}</div>
        </div>
      </div>
      <div className="mt-2 truncate text-xs font-semibold text-white/50">{nextText}</div>
    </div>
  );
}

function formatAssessmentQueueStatus(status: NonNullable<RadioStreamState["assessmentQueue"]>["status"]) {
  if (status === "paused") return "Paused for load";
  if (status === "queued") return "Ready below load limit";
  return "Idle";
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/42">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-white">{value}</div>
    </div>
  );
}

function Panel({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={clsx("min-w-0 rounded-3xl border border-white/10 bg-black/25 p-4", className)}>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-white/45">{title}</h2>
      {children}
    </section>
  );
}

function PreferenceList({ title, items }: { title: string; items: PreferenceMemoryItem[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <div className="mb-2 text-sm font-semibold text-white/70">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-white/38">No feedback recorded yet.</div>
      ) : (
        <ul className="space-y-2 text-sm leading-5 text-white/62">
          {items.slice().reverse().map((item) => (
            <li key={item.phrase} className="rounded-xl border border-white/10 bg-black/20 p-2">
              <div>{item.phrase}</div>
              <PreferenceAssessmentSummary assessment={item.assessment} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PreferenceAssessmentSummary({ assessment }: { assessment: AudioAssessment | undefined }) {
  if (!assessment) return null;
  const attrs = assessment.attributes ?? {};
  const details = [
    attrs.tempoBpm ? `${attrs.tempoBpm} BPM` : undefined,
    attrs.key,
    attrs.rhythm,
    attrs.genre?.join(", "),
  ].filter(Boolean);
  return (
    <div className="mt-2 rounded-xl border border-sky-200/12 bg-sky-300/[0.05] p-2 text-xs leading-5 text-white/50">
      <div className="font-bold uppercase tracking-[0.14em] text-sky-100/60">Assessment</div>
      {assessment.summary ? <div className="mt-1 text-white/62">{assessment.summary}</div> : null}
      {details.length ? <div className="mt-1 font-semibold text-sky-100/70">{details.join(" / ")}</div> : null}
      {attrs.instruments?.length ? <div className="mt-1">Instruments: {attrs.instruments.join(", ")}</div> : null}
      {attrs.mood?.length ? <div className="mt-1">Mood: {attrs.mood.join(", ")}</div> : null}
    </div>
  );
}

function buildPreferenceMemoryItems(state: RadioStreamState | null, styleId: RadioStyleId, rating: "up" | "down"): PreferenceMemoryItem[] {
  const preference = state?.preferences[styleId];
  const preferencePhrases = rating === "up" ? preference?.likes ?? [] : preference?.dislikes ?? [];
  const tracks = state?.history.filter((track) => track.styleId === styleId) ?? [];
  const ratedPhrases = tracks.filter((track) => track.rating === rating).map((track) => track.prompt);
  return uniqueStrings([...preferencePhrases, ...ratedPhrases]).map((phrase) => ({
    phrase,
    assessment: tracks.find((track) => track.prompt === phrase && track.rating === rating && track.latestAssessment)?.latestAssessment
      ?? tracks.find((track) => track.prompt === phrase && track.latestAssessment)?.latestAssessment,
  }));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
