#!/usr/bin/env python3
"""Stable Audio 3 generator bridge for the Next.js UI.

Mock mode intentionally uses only Python stdlib so the UI can be tested before
heavy ML dependencies and gated Hugging Face access are configured.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import signal
import shutil
import struct
import subprocess
import sys
import wave
from pathlib import Path
from types import SimpleNamespace

# Hugging Face repo name for the torch path (StableAudioModel.from_pretrained).
# Python is authoritative for the torch repo name; the MLX DiT/decoder routing
# is NOT mapped here anymore — it is resolved by the TS bridge
# (lib/generator-backend.ts::stableAudioModelToMlx) and passed as explicit
# --dit / --decoder args so the model->MLX mapping exists in only one place
# (ARC-008).
MODEL_MAP = {
    "small-sfx": "small-sfx",
    "small-music": "small-music",
    "medium": "medium",
}


def normalize_backend(value: str | None) -> str:
    return value if value in {"mlx", "torch"} else "mlx"


def write_mock_wav(path: Path, prompt: str, mode: str, duration: float, seed: int | None) -> None:
    rng = random.Random(seed if seed is not None else abs(hash((prompt, mode))) % (2**31))
    sample_rate = 44100
    frames = int(sample_rate * duration)
    path.parent.mkdir(parents=True, exist_ok=True)
    base = 55 if mode == "music" else 110
    words = [w for w in prompt.lower().replace(',', ' ').split() if w]
    freqs = []
    for i, word in enumerate(words[:8] or ["stable", "audio", "three"]):
        freqs.append(base * (1 + (sum(map(ord, word)) % 24) / 12) * (1 + i * 0.07))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        # Batch all frames into a single writeframes call instead of per-frame
        # writes (~500K calls for a 12s clip). Output is byte-identical (QA-020).
        sample_bytes = bytearray()
        for n in range(frames):
            t = n / sample_rate
            env = min(1.0, t / 0.03) * min(1.0, max(0.0, (duration - t) / 0.25))
            if mode == "sfx":
                sweep = math.sin(2 * math.pi * (freqs[0] + 900 * t / max(duration, 0.1)) * t)
                noise = (rng.random() * 2 - 1) * math.exp(-2.8 * t / max(duration, 0.1))
                sample = 0.35 * env * (0.65 * sweep + 0.35 * noise)
            else:
                sample = sum(math.sin(2 * math.pi * f * t) for f in freqs[:5]) / max(1, min(5, len(freqs)))
                wobble = 0.75 + 0.25 * math.sin(2 * math.pi * 0.18 * t)
                beat = 0.65 + 0.35 * (math.sin(2 * math.pi * 2 * t) > 0.82)
                sample = 0.28 * env * sample * wobble * beat
            val = int(max(-1, min(1, sample)) * 32767)
            sample_bytes.extend(struct.pack("<hh", val, val))
        wav.writeframes(bytes(sample_bytes))


def generate_real(args: argparse.Namespace) -> None:
    if args.backend == "mlx":
        generate_mlx(args)
        return

    try:
        from stable_audio_3 import StableAudioModel  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on external install
        raise RuntimeError(
            "stable_audio_3 is not installed in this Python environment. "
            "Create a venv and install Stability-AI/stable-audio-3, or enable mock mode."
        ) from exc

    model_name = MODEL_MAP[args.model]
    model = StableAudioModel.from_pretrained(model_name)
    audio = model.generate(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt or None,
        duration=args.duration,
        steps=args.steps,
        cfg_scale=args.cfg_scale,
        seed=args.seed if args.seed is not None else -1,
    )

    # The official library API may return an object with a save/export method, a
    # torch tensor, or numpy-like audio as it evolves. Handle the obvious shapes
    # and fail loudly otherwise.
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if hasattr(audio, "save"):
        audio.save(str(out))
        return
    if hasattr(audio, "export"):
        audio.export(str(out), format="wav")
        return
    try:
        import torch
        import torchaudio
        tensor = audio.detach().cpu() if isinstance(audio, torch.Tensor) else torch.tensor(audio)
        # stable-audio-3 returns [batch, channels, samples]; torchaudio wants [channels, samples].
        if tensor.ndim == 3:
            tensor = tensor[0]
        if tensor.ndim == 1:
            tensor = tensor.unsqueeze(0)
        sample_rate = int(getattr(getattr(model, "model", None), "sample_rate", 44100))
        torchaudio.save(str(out), tensor.float().cpu(), sample_rate)
        return
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"Could not save generated audio object of type {type(audio)!r}") from exc


def generate_mlx(args: argparse.Namespace) -> None:
    project_root = Path(__file__).resolve().parent.parent
    mlx_dir = Path(os.environ.get("STABLE_AUDIO_MLX_DIR", project_root / "vendor" / "stable-audio-3" / "optimized" / "mlx"))
    sa3 = mlx_dir / "sa3"
    if not sa3.exists():
        raise RuntimeError(f"Stable Audio 3 MLX wrapper not found at {sa3}. Run vendor/stable-audio-3/optimized/mlx/install.sh first.")

    if not args.dit or not args.decoder:
        raise RuntimeError(
            "MLX backend requires --dit and --decoder. The TS bridge passes these "
            "explicitly (lib/generator-backend.ts is the authoritative model->MLX "
            "mapping); Python no longer keeps a duplicate map (ARC-008)."
        )
    dit, decoder = args.dit, args.decoder
    command = [
        str(sa3),
        "--prompt", args.prompt,
        "--dit", dit,
        "--decoder", decoder,
        "--seconds", str(args.duration),
        "--steps", str(args.steps),
        "--cfg", str(args.cfg_scale),
        "--out", str(args.out),
    ]
    if args.negative_prompt:
        command.extend(["--negative-prompt", args.negative_prompt])
    if args.seed is not None:
        command.extend(["--seed", str(args.seed)])

    result = run_process_tree(command, cwd=mlx_dir, timeout_seconds=mlx_timeout_seconds())
    if result.returncode != 0:
        raise RuntimeError(
            "MLX Stable Audio generation failed\n"
            f"command: {' '.join(command)}\n"
            f"stdout:\n{result.stdout[-4000:]}\n"
            f"stderr:\n{result.stderr[-4000:]}"
        )


def mlx_timeout_seconds() -> float:
    raw = os.environ.get("STABLE_AUDIO_MLX_TIMEOUT_MS") or os.environ.get("STABLE_AUDIO_TIMEOUT_MS") or "900000"
    try:
        return max(1.0, float(raw) / 1000.0)
    except ValueError:
        return 900.0


def run_process_tree(command: list[str], cwd: Path, timeout_seconds: float):
    """Run a child command and clean up its whole process group on timeout/SIGTERM."""
    process: subprocess.Popen[str] | None = None
    previous_handlers: dict[int, object] = {}

    def terminate_process_group(signum: int, _frame: object) -> None:
        if process:
            terminate_process_tree(process, grace_seconds=2)
        raise SystemExit(128 + signum)

    for signum in (signal.SIGTERM, signal.SIGINT):
        previous_handlers[signum] = signal.getsignal(signum)
        signal.signal(signum, terminate_process_group)

    try:
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(timeout=timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            stdout, stderr = terminate_process_tree(process, grace_seconds=10)
            raise RuntimeError(
                f"Timed out after {timeout_seconds:.1f}s running {' '.join(command)}\n"
                f"stdout:\n{stdout[-4000:]}\n"
                f"stderr:\n{stderr[-4000:]}"
            ) from exc
        return SimpleNamespace(returncode=process.returncode, stdout=stdout, stderr=stderr)
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)  # type: ignore[arg-type]


def terminate_process_tree(process: subprocess.Popen[str], grace_seconds: float) -> tuple[str, str]:
    if process.poll() is not None:
        return process.communicate()

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return process.communicate()

    try:
        return process.communicate(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return process.communicate(timeout=5)


def convert_to_mp3(wav_path: Path, mp3_path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(wav_path),
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "192k",
                str(mp3_path),
            ],
            check=True,
        )
        return
    afconvert = shutil.which("afconvert")
    if afconvert:
        subprocess.run([afconvert, "-f", "MPG3", "-d", ".mp3", str(wav_path), str(mp3_path)], check=True)
        return
    raise RuntimeError("MP3 output requested but neither ffmpeg nor afconvert is available")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--negative-prompt", default="")
    parser.add_argument("--mode", choices=["music", "sfx"], required=True)
    parser.add_argument("--model", choices=sorted(MODEL_MAP), default="small-music")
    # MLX routing is resolved authoritatively by the TS bridge and passed
    # explicitly; required only for the MLX backend (ARC-008).
    parser.add_argument("--dit", help="MLX DiT model id (e.g. sm-music). Required for the mlx backend.")
    parser.add_argument("--decoder", help="MLX decoder id (e.g. same-s). Required for the mlx backend.")
    parser.add_argument("--duration", type=float, default=8)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--cfg-scale", type=float, default=1.0)
    parser.add_argument("--format", choices=["mp3", "wav"], default="mp3")
    parser.add_argument("--backend", choices=["mlx", "torch"], default=os.environ.get("STABLE_AUDIO_BACKEND", "mlx"))
    parser.add_argument("--seed", type=int)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mock", action="store_true")
    args = parser.parse_args()
    args.backend = normalize_backend(args.backend)

    out = Path(args.out)
    render_path = out if args.format == "wav" else out.with_suffix(".tmp.wav")
    args.out = str(render_path)
    if args.mock:
        write_mock_wav(render_path, args.prompt, args.mode, args.duration, args.seed)
    else:
        generate_real(args)
    if args.format == "mp3":
        convert_to_mp3(render_path, out)
        try:
            render_path.unlink()
        except OSError:
            pass
    print(json.dumps({"out": str(out), "bytes": out.stat().st_size, "mock": args.mock, "format": args.format, "backend": args.backend}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
