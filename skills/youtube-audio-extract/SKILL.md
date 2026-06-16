---
name: youtube-audio-extract
description: Use when the user wants to extract, download, or rip audio from a YouTube video (or any yt-dlp-supported site) and save it locally as MP3 or another audio format. Triggers: "extract audio from YouTube", "download YouTube audio", "convert this video to MP3", "save the audio from this link", "rip the song from this video".
---

# YouTube Audio Extraction

Extract audio from a YouTube video (or any of the 1000+ sites `yt-dlp` supports) and save it locally as MP3 or another format, using `yt-dlp` + `ffmpeg`.

## Prerequisites

Requires `yt-dlp` and `ffmpeg`. Auto-install if missing:

```bash
which yt-dlp >/dev/null 2>&1 || brew install yt-dlp
which ffmpeg >/dev/null 2>&1 || brew install ffmpeg
```

If `ffmpeg` is installed but `yt-dlp` can't find it (conversion fails), pass `--ffmpeg-location` pointing at ffmpeg's bin dir, e.g. `--ffmpeg-location /opt/homebrew/opt/ffmpeg-full/bin`.

## Core command

```bash
yt-dlp -x --audio-format mp3 --audio-quality 0 --no-playlist \
  -o "<output-dir>/<name>.%(ext)s" "<URL>"
```

Flags:
- `-x` — extract audio (omit it and you get the video file)
- `--audio-format mp3` — target format: `mp3`, `m4a`, `aac`, `flac`, `wav`, `opus`, `vorbis`, `alac`
- `--audio-quality 0` — best VBR quality. Use a bitrate like `192K` for smaller files.
- `--no-playlist` — grab only the one video even if the URL is part of a playlist
- `-o "...%(ext)s"` — let yt-dlp finalize the extension; don't hardcode `.mp3`

Default output dir: `~/Downloads` unless the user specifies elsewhere.

## Worked example

Save a video's audio to Downloads as MP3, best quality:

```bash
yt-dlp -x --audio-format mp3 --audio-quality 0 --no-playlist \
  -o "$HOME/Downloads/arcane-sucker.%(ext)s" \
  "https://www.youtube.com/watch?v=8sekyV_o2pM"
```

## Verify the result

```bash
ls -lh "<output-dir>/<name>.mp3"
ffprobe -v error -show_entries format=duration,bit_rate,format_name \
  -of default=noprint_wrappers=1 "<output-dir>/<name>.mp3"
```

## Variations

| Goal | Add / change |
|---|---|
| Smaller file | `--audio-quality 192K` (or `128K`) |
| Lossless | `--audio-format flac` or `wav` |
| Only a clip | `--download-sections "*00:30-01:00"` (start-end, `HH:MM:SS` ok) |
| Whole playlist | drop `--no-playlist`; use `-o "%(playlist_index)s-%(title)s.%(ext)s"` |
| Embed cover art + tags | `--embed-thumbnail --embed-metadata` |
| Faster downloads | `--downloader aria2c` (requires `aria2` installed) |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `yt-dlp: command not found` | `brew install yt-dlp` |
| conversion fails / `ffmpeg not found` | add `--ffmpeg-location` pointing at ffmpeg's bin dir |
| `Sign in to confirm you're not a bot` / HTTP 403 | `brew upgrade yt-dlp` first; if still failing, pass `--cookies-from-browser chrome` (or `--cookies cookies.txt`) |
| Video unavailable / private / members-only | cannot be downloaded — surface the error to the user |
| Download is slow / stalls | try `-f bestaudio` or `--downloader aria2c` |
| Got a `.webm`/`.m4a` instead of `.mp3` | you forgot `-x --audio-format mp3` |

## Notes

- `yt-dlp` is actively updated; YouTube breakages are almost always fixed by `brew upgrade yt-dlp`. Upgrade first when a previously-working URL starts failing.
- Only download content you have the rights to; respect YouTube's Terms of Service and applicable copyright.
