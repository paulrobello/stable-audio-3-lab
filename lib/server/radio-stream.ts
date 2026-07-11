// ICY/MP3 byte-level streaming for the radio station.
//
// Owns `streamCurrentTrack` — the per-listener ReadableStream. Each listener
// paces audio chunks, interleaves ICY metadata, falls back to a starred library
// track on starvation, and joins an in-progress track at the shared wall-clock
// byte offset. Extracted from `app/api/radio/route.ts`.
//
// ── ARC-012: listeners are read-only subscribers; a single station ticker
//    owns advancement ──────────────────────────────────────────────────────
// A listener NO LONGER advances station state when its segment is exhausted.
// Advancement is owned solely by the wall-clock ticker in `./radio-ticker.ts`,
// which calls `synchronizeRadioPlayback` (advance `currentTrack` while
// `now - currentTrackStartedAt >= duration`) inside the locked state store.
// Each listener registers with the ticker on `start` and releases on teardown
// (cancel / deadline / error); with zero listeners the ticker stops, so a plain
// `GET /api/radio` state poll — which never registers a listener — can never
// advance playback. Per-pull state reads use plain `readRadioState` (read-only).
//
// When a listener finishes a segment it cannot advance the track itself; it
// records the just-played filename and idle-waits (~200 ms) until the ticker's
// next tick advances `currentTrack`, then re-reads and builds the new segment.
//
// ── Deferred: per-listener memory ─────────────────────────────────────────
// Each listener's `pull()` still reads an entire segment (announcement + track,
// transcoded to a single MP3 via ffmpeg concat) into one `Uint8Array`
// (`activeAudio`) and slices+paces it at `RADIO_STREAM_BYTES_PER_SECOND`. A
// typical 2-minute track at ~128 kbps is ~2 MB held per listener for the
// duration of the track. Fine for 1–3 LAN listeners; replacing the full-buffer
// read with an `fs.createReadStream`-based pipe is a non-trivial redesign
// (pacing, ICY byte-interleaving, and mid-track resume-offset are all coupled
// to having the full buffer) and remains deferred. The advancement-model fix
// above is the deliverable here.

import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildRadioTrackPlaybackFilenames,
  getRadioPlaybackElapsedSeconds,
  normalizeRadioState,
  normalizeRadioStyleUrlParam,
  replaceRadioTrackInLineup,
  type RadioState,
  type RadioTrackRecord,
} from "@/lib/radio";
import { isSafeAudioFilename, outputPathForAudio } from "@/lib/library";
import { mutateRadioState, readRadioState } from "./radio-state-store";
import { registerStarredLibraryFallbackTrack, writeTrackRadioMetadata } from "./radio-queue-service";
import { createAnnouncementIfEnabled } from "./radio-tts";
import { registerRadioStreamListener, releaseRadioStreamListener } from "./radio-ticker";
import { spawnProcess } from "./subprocess";
import { logWarn } from "./logger";
import { ffmpegBin, RADIO_STREAM_BITRATE_KBPS } from "./config";

const outputDir = () => path.join(process.cwd(), "public", "outputs");
// Short re-read wait when a listener has finished its segment but the ticker
// has not yet advanced `currentTrack` (within one tick). Keeps the loop from
// spinning while yielding back to the runtime so the ticker can run.
const RADIO_STREAM_RE_READ_WAIT_MS = 200;
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
  // The filename just played to byte-exhaustion, awaiting the wall-clock
  // ticker to advance `currentTrack` before we can build the next segment.
  let awaitingAdvanceFilename: string | undefined;
  let icyBytesUntilMetadata = RADIO_STREAM_ICY_META_INTERVAL;

  // Safety net: enforce a max stream lifetime to prevent resource exhaustion
  const RADIO_STREAM_MAX_LIFETIME_MS = 6 * 60 * 60 * 1000; // 6 hours
  const streamDeadline = Date.now() + RADIO_STREAM_MAX_LIFETIME_MS;
  let streamAborted = false;

  // Listener-gated ticker registration (ARC-012). Register exactly once per
  // stream and release on every teardown path (cancel / deadline / error). The
  // flag makes release idempotent and safe even if called without register.
  let listenerRegistered = false;
  const ensureRegistered = () => {
    if (listenerRegistered) return;
    registerRadioStreamListener();
    listenerRegistered = true;
  };
  const ensureReleased = () => {
    if (!listenerRegistered) return;
    releaseRadioStreamListener();
    listenerRegistered = false;
  };

  const stream = new ReadableStream<Uint8Array>({
    start() {
      ensureRegistered();
    },
    cancel() {
      streamAborted = true;
      ensureReleased();
    },
    async pull(controller) {
      try {
        while (true) {
          if (streamAborted || signal?.aborted) return;
          if (Date.now() > streamDeadline) {
            ensureReleased();
            controller.close();
            return;
          }

          // Phase A — pace and emit bytes from the active segment.
          if (activeAudio && activeFilename) {
            // ARC-012: read-only. If the station's current track changed
            // (skip / select / ticker advance) mid-segment, drop this segment
            // and re-read fresh state so the listener follows the station.
            if (pendingTrack) {
              const latestState = resolveStreamStyleState(await readRadioState(), options.styleId);
              if (latestState.currentTrack?.filename !== pendingTrack.filename) {
                streamState = latestState;
                pendingFilenames = [];
                pendingTrack = undefined;
                activeAudio = undefined;
                activeAudioOffset = 0;
                activeFilename = undefined;
                activeFileStarted = false;
                awaitingAdvanceFilename = undefined;
                continue;
              }
            }
            const chunkSize = icyMetadataEnabled ? Math.min(RADIO_STREAM_CHUNK_BYTES, icyBytesUntilMetadata) : RADIO_STREAM_CHUNK_BYTES;
            const chunk = activeAudio.slice(activeAudioOffset, activeAudioOffset + chunkSize);
            activeAudioOffset += chunk.length;
            if (activeFileStarted) await sleep(Math.round(chunk.length / RADIO_STREAM_BYTES_PER_SECOND * 1000));
            activeFileStarted = true;
            const metadataTitle = pendingTrack?.title;
            if (activeAudioOffset >= activeAudio.length) {
              // Segment exhausted. ARC-012: the listener does NOT advance
              // station state — it records the played filename and lets the
              // wall-clock ticker advance `currentTrack`, then re-reads below.
              awaitingAdvanceFilename = pendingTrack?.filename ?? activeFilename;
              activeAudio = undefined;
              activeAudioOffset = 0;
              activeFilename = undefined;
              activeFileStarted = false;
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

          // Phase B — no active segment: re-read state and build the next one.
          streamState = resolveStreamStyleState(await readRadioState(), options.styleId);
          // Just finished a segment but the ticker hasn't advanced the current
          // track yet (within a tick). Idle-wait briefly and re-read rather
          // than spinning or re-streaming the same track's bytes.
          if (awaitingAdvanceFilename && streamState.currentTrack?.filename === awaitingAdvanceFilename) {
            await sleep(RADIO_STREAM_RE_READ_WAIT_MS);
            continue;
          }
          awaitingAdvanceFilename = undefined;

          const track = streamState.currentTrack;
          if (!track || !isSafeAudioFilename(track.filename) || !track.filename.toLowerCase().endsWith(".mp3")) {
            const fallback = await registerStarredLibraryFallbackTrack(streamState, "stream_starvation");
            if (fallback) {
              streamState = fallback.state;
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
          // Per-listener memory optimization (fs.createReadStream pipe) is
          // deferred; the segment is still read as a full buffer (ARC-012
          // deferred item — see module header).
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
      } catch (error) {
        ensureReleased();
        throw error;
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
  } catch (error) {
    // Behavior-changing fallback: ffmpeg concat failed, so the announcement +
    // track are spliced as raw bytes without a re-transcode. This can produce a
    // slightly discontinuous seam (and skips the shared ID3 strip-and-concat
    // normalization). Warn so a broken/absent ffmpeg is diagnosable rather
    // than silently degrading every announcement join (QA-006).
    logWarn("Radio stream ffmpeg concat failed; falling back to raw byte concatenation", {
      error: error instanceof Error ? error.message : String(error),
      segmentCount: filePaths.length,
    });
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
