// ICY/MP3 byte-level streaming for the radio station.
//
// Owns `streamCurrentTrack` (the per-listener ReadableStream that paces audio
// chunks, interleaves ICY metadata, advances station state on track end, and
// falls back to a starred library track on starvation) plus its segment
// helpers and the playback-synchronized read. Extracted verbatim from
// `app/api/radio/route.ts`; behavior is unchanged.
//
// State reads use `readSynchronizedRadioState` (which writes back the
// playback-clock sync inside the state lock) and advancements go through
// `mutateRadioState` — no direct `fs` touches of the state file.
//
// ── Design assumption: single-listener / single-household LAN ───────────────
// The streaming model assumes ONE concurrent listener (or a small handful on a
// trusted LAN). Two consequences flow from that assumption and are acceptable
// for the LAN/Pardora use case but become problems at scale on the public
// stream (`radio.pardev.net`):
//
//   1. Per-listener memory. Each listener's `pull()` reads an entire segment
//      (the announcement + track, transcoded to a single MP3 via ffmpeg concat)
//      into a single `Uint8Array` (`activeAudio`) and then slices+paces it at
//      `RADIO_STREAM_BYTES_PER_SECOND`. A typical 2-minute track at ~128 kbps
//      is ~2 MB, so each connected listener holds roughly that much in memory
//      for the duration of the track. For 1–3 LAN listeners this is trivial;
//      for dozens of public listeners it adds up. Replacing the full-buffer
//      read with an `fs.createReadStream`-based pipe would lower this, but the
//      pacing, ICY-metadata byte-interleaving, and mid-track resume-offset
//      logic are all coupled to having the full buffer (`activeAudio.length`,
//      slicing, offset math), and the multi-segment path must buffer ffmpeg's
//      concat output regardless — so it is a non-trivial redesign left as a
//      future item.
//
//   2. Listener-driven state advancement. Each listener advances the GLOBAL
//      station state on its own track end (`advanceStreamStateAfterTrack` →
//      `mutateRadioState` guarded by `completedTrackFilename`). The locked
//      mutator makes this race-safe, but with many simultaneous listeners each
//      one independently drives advancement, so listeners started at different
//      times can disagree about what "now playing" means and the station
//      advances at the pace of the fastest listener. The robust fix is a
//      single station "ticker" that owns advancement while listeners become
//      read-only subscribers — a behavior-changing redesign explicitly deferred
//      (tracked as ARC-012 / future work).
//
// Until those two items land, treat public multi-listener streaming as
// best-effort: fine for a single household and a couple of devices, not built
// for many simultaneous remote listeners.

import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  advanceRadioCurrentTrack,
  buildRadioTrackPlaybackFilenames,
  getRadioPlaybackElapsedSeconds,
  normalizeRadioState,
  normalizeRadioStyleUrlParam,
  replaceRadioTrackInLineup,
  synchronizeRadioPlayback,
  type RadioState,
  type RadioTrackRecord,
} from "@/lib/radio";
import { isSafeAudioFilename, outputPathForAudio } from "@/lib/library";
import { mutateRadioState, readRadioState } from "./radio-state-store";
import { registerStarredLibraryFallbackTrack, startRadioQueueMaintenance, writeTrackRadioMetadata } from "./radio-queue-service";
import { createAnnouncementIfEnabled } from "./radio-tts";
import { spawnProcess } from "./subprocess";
import { ffmpegBin, RADIO_STREAM_BITRATE_KBPS } from "./config";

const outputDir = () => path.join(process.cwd(), "public", "outputs");
const RADIO_STREAM_IDLE_WAIT_MS = 1200;
// Pacing derived from the shared bitrate constant so the sleep and resume
// offset match the actual ffmpeg transcode byte rate (QA-011).
const RADIO_STREAM_BYTES_PER_SECOND = (RADIO_STREAM_BITRATE_KBPS * 1000) / 8; // 16,000 B/s
const RADIO_STREAM_CHUNK_BYTES = 24_000;
const RADIO_STREAM_ICY_META_INTERVAL = RADIO_STREAM_CHUNK_BYTES;

export async function streamCurrentTrack(state: RadioState, options: { icyMetadataEnabled?: boolean; metadataOnly?: boolean; skipAnnouncement?: boolean; styleId?: ReturnType<typeof normalizeRadioStyleUrlParam>; signal?: AbortSignal } = {}) {
  const icyMetadataEnabled = options.icyMetadataEnabled ?? false;
  const clientSkipsAnnouncementAudio = options.skipAnnouncement || options.metadataOnly;
  const signal = options.signal;
  let streamState = resolveStreamStyleState(state, options.styleId);
  let pendingFilenames: string[] = [];
  let pendingTrack: RadioTrackRecord | undefined;
  let activeAudio: Uint8Array | undefined;
  let activeAudioOffset = 0;
  let activeFilename: string | undefined;
  let activeFileStarted = false;
  let completedTrackFilename: string | undefined;
  let icyBytesUntilMetadata = RADIO_STREAM_ICY_META_INTERVAL;

  // Safety net: enforce a max stream lifetime to prevent resource exhaustion
  const RADIO_STREAM_MAX_LIFETIME_MS = 6 * 60 * 60 * 1000; // 6 hours
  const streamDeadline = Date.now() + RADIO_STREAM_MAX_LIFETIME_MS;
  let streamAborted = false;

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      streamAborted = true;
    },
    async pull(controller) {
      while (true) {
        if (streamAborted || signal?.aborted) return;
        if (Date.now() > streamDeadline) {
          controller.close();
          return;
        }
        if (activeAudio && activeFilename) {
          if (pendingTrack) {
            const latestState = resolveStreamStyleState(await readSynchronizedRadioState(), options.styleId);
            if (latestState.currentTrack?.filename !== pendingTrack.filename) {
              streamState = latestState;
              pendingFilenames = [];
              pendingTrack = undefined;
              activeAudio = undefined;
              activeAudioOffset = 0;
              activeFilename = undefined;
              activeFileStarted = false;
              completedTrackFilename = undefined;
              continue;
            }
          }
          const chunkSize = icyMetadataEnabled ? Math.min(RADIO_STREAM_CHUNK_BYTES, icyBytesUntilMetadata) : RADIO_STREAM_CHUNK_BYTES;
          const chunk = activeAudio.slice(activeAudioOffset, activeAudioOffset + chunkSize);
          activeAudioOffset += chunk.length;
          if (activeFileStarted) await sleep(Math.round(chunk.length / RADIO_STREAM_BYTES_PER_SECOND * 1000));
          activeFileStarted = true;
          const finishedFilename = activeAudioOffset >= activeAudio.length ? activeFilename : undefined;
          const metadataTitle = pendingTrack?.title;
          if (activeAudioOffset >= activeAudio.length) {
            activeAudio = undefined;
            activeAudioOffset = 0;
            activeFilename = undefined;
            activeFileStarted = false;
          }
          if (finishedFilename && pendingTrack && finishedFilename === pendingTrack.filename && pendingFilenames.length === 0) {
            streamState = await advanceStreamStateAfterTrack(pendingTrack, options.styleId);
            completedTrackFilename = streamState.currentTrack?.filename === pendingTrack.filename ? pendingTrack.filename : undefined;
            pendingTrack = undefined;
          }
          let outputChunk = chunk;
          if (icyMetadataEnabled) {
            icyBytesUntilMetadata -= chunk.length;
            if (icyBytesUntilMetadata <= 0) {
              outputChunk = concatenateBytes(chunk, buildIcyMetadataBlock(metadataTitle));
              icyBytesUntilMetadata = RADIO_STREAM_ICY_META_INTERVAL;
            }
          }
          controller.enqueue(outputChunk);
          return;
        }

        if (!pendingFilenames.length) {
          if (pendingTrack) {
            streamState = await advanceStreamStateAfterTrack(pendingTrack, options.styleId);
            completedTrackFilename = streamState.currentTrack?.filename === pendingTrack.filename ? pendingTrack.filename : undefined;
            pendingTrack = undefined;
          }

          streamState = resolveStreamStyleState(await readSynchronizedRadioState(), options.styleId);
          if (completedTrackFilename && streamState.currentTrack?.filename === completedTrackFilename) {
            const advanced = await mutateRadioState((s) => {
              if (s.currentTrack?.filename !== completedTrackFilename) return s;
              const next = advanceRadioCurrentTrack(s);
              return next.currentTrack?.filename !== s.currentTrack?.filename ? next : s;
            });
            if (advanced.currentTrack?.filename !== streamState.currentTrack?.filename) {
              streamState = advanced;
              completedTrackFilename = undefined;
            }
          }

          const track = streamState.currentTrack;
          if (!track || !isSafeAudioFilename(track.filename) || !track.filename.toLowerCase().endsWith(".mp3") || track.filename === completedTrackFilename) {
            const fallback = await registerStarredLibraryFallbackTrack(streamState, "stream_starvation");
            if (fallback) {
              streamState = fallback.state;
              completedTrackFilename = undefined;
              continue;
            }
            await sleep(RADIO_STREAM_IDLE_WAIT_MS);
            continue;
          }

          const skipAnnouncementAudio = clientSkipsAnnouncementAudio || !streamState.announceEnabled;
          const playableTrack = skipAnnouncementAudio ? track : await prepareTrackForStreamPlayback(track, streamState);
          if (playableTrack !== track) {
            streamState = replaceRadioTrackInLineup(streamState, playableTrack);
            await writeTrackRadioMetadata(playableTrack, streamState);
            streamState = await mutateRadioState((s) => replaceRadioTrackInLineup(s, playableTrack));
          }

          pendingTrack = playableTrack;
          pendingFilenames = buildRadioTrackPlaybackFilenames(playableTrack, { skipAnnouncement: skipAnnouncementAudio })
            .filter((filename) => isSafeAudioFilename(filename) && filename.toLowerCase().endsWith(".mp3"));
          if (!pendingFilenames.length) continue;
        }

        const segmentFilenames = pendingFilenames.splice(0);
        if (!segmentFilenames.length) continue;
        const segmentFiles: { filename: string; filePath: string }[] = [];
        for (const segmentFilename of segmentFilenames) {
          const filePath = outputPathForAudio(outputDir(), segmentFilename);
          try {
            // Verify existence with stat BEFORE queueing the segment so a
            // missing announcement is skipped, not queued to fail later (QA-004).
            // stat avoids loading the whole file just to probe.
            await stat(filePath);
            segmentFiles.push({ filename: segmentFilename, filePath });
          } catch (error) {
            if (segmentFilename !== pendingTrack?.filename && isNotFoundError(error)) continue;
            throw error;
          }
        }
        if (!segmentFiles.length) continue;
        activeAudio = await readRadioStreamSegment(segmentFiles.map((file) => file.filePath));
        activeFilename = pendingTrack?.filename ?? segmentFiles.at(-1)?.filename;
        const startsWithCurrentTrackAudio = segmentFiles[0]?.filename === pendingTrack?.filename;
        const sharedOffset = startsWithCurrentTrackAudio && pendingTrack?.filename === streamState.currentTrack?.filename
          ? Math.floor(getRadioPlaybackElapsedSeconds(streamState) * RADIO_STREAM_BYTES_PER_SECOND)
          : 0;
        activeAudioOffset = Math.min(sharedOffset, Math.max(0, activeAudio.length - 1));
        activeFileStarted = false;
        continue;
      }
    },
  });
  const headers: Record<string, string> = {
    "content-type": "audio/mpeg",
    "cache-control": "no-store",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
    "icy-name": "Stable Audio 3 Lab Radio",
    "icy-description": streamState.currentTrack?.title ?? "AI-generated local radio",
  };
  if (icyMetadataEnabled) headers["icy-metaint"] = String(RADIO_STREAM_ICY_META_INTERVAL);

  return new NextResponse(stream, {
    headers,
  });
}

export function resolveStreamStyleState(state: RadioState, styleId: ReturnType<typeof normalizeRadioStyleUrlParam>) {
  return styleId ? normalizeRadioState({ ...state, selectedStyleId: styleId }) : state;
}

// Synchronize playback inside the state lock so concurrent POST writers and
// the background queue loop can't be clobbered. When nothing changed the
// mutator returns the same reference it was handed and the store skips the
// write (matching the previous conditional-write behavior).
export async function readSynchronizedRadioState(): Promise<RadioState> {
  return mutateRadioState((state) => {
    const synchronized = synchronizeRadioPlayback(state);
    const changed = synchronized.currentTrack?.filename !== state.currentTrack?.filename
      || synchronized.currentTrackStartedAt !== state.currentTrackStartedAt;
    return changed ? synchronized : state;
  });
}

async function advanceStreamStateAfterTrack(track: RadioTrackRecord, styleId: ReturnType<typeof normalizeRadioStyleUrlParam>) {
  const latestState = resolveStreamStyleState(await readRadioState(), styleId);
  if (latestState.currentTrack?.filename !== track.filename) return latestState;
  const advanced = advanceRadioCurrentTrack(latestState);
  if (advanced.currentTrack?.filename !== latestState.currentTrack?.filename) {
    // Re-apply the advance inside the lock against the freshest state so a
    // concurrent POST (rating/taste/select) isn't clobbered.
    await mutateRadioState((s) => {
      if (s.currentTrack?.filename !== track.filename) return s;
      const next = advanceRadioCurrentTrack(s);
      return next.currentTrack?.filename !== s.currentTrack?.filename ? next : s;
    });
  }
  startRadioQueueMaintenance(advanced);
  return advanced;
}

async function prepareTrackForStreamPlayback(track: RadioTrackRecord, state: RadioState) {
  if (!state.announceEnabled && !track.announce) return track;
  const announcementFilename = await createAnnouncementIfEnabled({ ...track, announce: true }, state);
  if (!announcementFilename) return track;
  if (announcementFilename === track.announcementFilename && track.announce) return track;
  return { ...track, announce: true, announcementFilename };
}

function buildIcyMetadataBlock(title: string | undefined) {
  const metadata = Buffer.from(`StreamTitle='${cleanIcyMetadataValue(title ?? "Stable Audio 3 Lab Radio")}';`, "utf8").subarray(0, 4080);
  const blockCount = Math.ceil(metadata.length / 16);
  const block = new Uint8Array(1 + blockCount * 16);
  block[0] = blockCount;
  block.set(metadata, 1);
  return block;
}

function cleanIcyMetadataValue(value: string) {
  return value.replace(/[\0\r\n;]/g, " ").replace(/'/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function concatenateBytes(first: Uint8Array, second: Uint8Array) {
  const output = new Uint8Array(first.length + second.length);
  output.set(first);
  output.set(second, first.length);
  return output;
}

function stripLeadingId3Tag(bytes: Uint8Array) {
  if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 3)) !== "ID3") return bytes;
  const tagSize = (bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f);
  const footerSize = (bytes[5] & 0x10) === 0x10 ? 10 : 0;
  const offset = 10 + tagSize + footerSize;
  return offset > 10 && offset < bytes.length ? bytes.slice(offset) : bytes;
}

async function readRadioStreamSegment(filePaths: string[]) {
  if (filePaths.length === 1) return stripLeadingId3Tag(new Uint8Array(await readFile(filePaths[0])));
  try {
    return stripLeadingId3Tag(await transcodeFilesToRadioMp3(filePaths));
  } catch {
    const chunks = await Promise.all(filePaths.map(async (filePath) => stripLeadingId3Tag(new Uint8Array(await readFile(filePath)))));
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

async function transcodeFilesToRadioMp3(filePaths: string[]) {
  const ffmpeg = ffmpegBin();
  const inputArgs = filePaths.flatMap((filePath) => ["-i", filePath]);
  const concatInputs = filePaths.map((_, index) => `[${index}:a]`).join("");
  const child = spawnProcess(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputArgs,
    "-filter_complex",
    `${concatInputs}concat=n=${filePaths.length}:v=0:a=1[a]`,
    "-map",
    "[a]",
    "-vn",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    `${RADIO_STREAM_BITRATE_KBPS}k`,
    "-f",
    "mp3",
    "pipe:1",
  ]);
  return new Promise<Buffer>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`ffmpeg radio segment conversion failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end();
  });
}

function isNotFoundError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
