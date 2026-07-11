#!/usr/bin/env python3
"""Qwen2.5-Omni audio assessor for Stable Audio 3 Lab.

The Next.js `/api/assess` route sends one JSON payload on stdin. This script
loads Qwen2.5-Omni, asks it to describe the audio in the lab's assessment
schema, and writes one JSON object to stdout.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

DEFAULT_MODEL = "Qwen/Qwen2.5-Omni-7B"
SYSTEM_PROMPT = (
    "You are a strict music audio analyst. Listen to the provided audio and "
    "return only valid JSON. Do not include markdown, commentary, or code fences."
)


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = assess_audio(payload)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        sys.stderr.write(f"{exc}\n")
        return 1


def assess_audio(payload: dict[str, Any]) -> dict[str, Any]:
    audio_path = Path(read_required_string(payload, "audioPath"))
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    model_id = os.environ.get("QWEN_OMNI_MODEL", DEFAULT_MODEL)
    with PreparedAudioPath(audio_path) as qwen_audio_path:
        text = run_qwen_omni(model_id, qwen_audio_path, build_user_prompt(payload))
    parsed = parse_json_object(text)
    if not isinstance(parsed, dict):
        parsed = {"summary": text.strip()}
    return normalize_assessment(parsed, model_id, text)


def run_qwen_omni(model_id: str, audio_path: Path, prompt: str) -> str:
    try:
        import torch
        from qwen_omni_utils import process_mm_info
        from transformers import Qwen2_5OmniForConditionalGeneration, Qwen2_5OmniProcessor
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Missing Qwen2.5-Omni dependencies. Run through the configured uv command "
            "or install: torch torchvision transformers accelerate soundfile librosa qwen-omni-utils"
        ) from exc

    dtype = read_torch_dtype(torch, os.environ.get("QWEN_OMNI_DTYPE", "auto"))
    model_kwargs: dict[str, Any] = {
        "device_map": os.environ.get("QWEN_OMNI_DEVICE_MAP", "auto"),
    }
    if dtype != "auto":
        model_kwargs["torch_dtype"] = dtype

    processor = Qwen2_5OmniProcessor.from_pretrained(model_id)
    model = Qwen2_5OmniForConditionalGeneration.from_pretrained(model_id, **model_kwargs)
    if hasattr(model, "disable_talker"):
        model.disable_talker()
    conversation = [
        {"role": "system", "content": [{"type": "text", "text": SYSTEM_PROMPT}]},
        {
            "role": "user",
            "content": [
                {"type": "audio", "audio": str(audio_path)},
                {"type": "text", "text": prompt},
            ],
        },
    ]
    text = processor.apply_chat_template(
        conversation,
        add_generation_prompt=True,
        tokenize=False,
    )
    audios, images, videos = process_mm_info(conversation, use_audio_in_video=False)
    inputs = processor(
        text=text,
        audio=audios,
        images=images,
        videos=videos,
        return_tensors="pt",
        padding=True,
        use_audio_in_video=False,
    )
    model_device = getattr(model, "device", None)
    if model_device is not None:
        inputs = inputs.to(model_device)

    max_new_tokens = int(os.environ.get("QWEN_OMNI_MAX_NEW_TOKENS", "768"))
    with torch.inference_mode():
        generated_ids = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            use_audio_in_video=False,
            return_audio=False,
        )
    if isinstance(generated_ids, tuple):
        generated_ids = generated_ids[0]
    generated_ids = trim_generated_ids(inputs, generated_ids)
    decoded = processor.batch_decode(generated_ids, skip_special_tokens=True, clean_up_tokenization_spaces=False)
    return decoded[0] if decoded else ""


def trim_generated_ids(inputs: Any, generated_ids: Any) -> Any:
    """Strip the prompt token prefix from ``generated_ids`` when the model echoes it, returning the suffix-only completion."""
    input_ids = inputs.get("input_ids") if isinstance(inputs, dict) else getattr(inputs, "input_ids", None)
    prompt_length = read_token_length(input_ids)
    generated_length = read_token_length(generated_ids)
    if prompt_length is None or generated_length is None or generated_length <= prompt_length:
        return generated_ids

    has_prompt_prefix = sequence_has_prompt_prefix(input_ids, generated_ids, prompt_length)
    if has_prompt_prefix is False:
        return generated_ids
    try:
        return generated_ids[:, prompt_length:]
    except (AttributeError, IndexError, TypeError):
        return generated_ids


def read_token_length(value: Any) -> int | None:
    shape = getattr(value, "shape", None)
    if shape is not None:
        try:
            return int(shape[-1])
        except (TypeError, ValueError, IndexError):
            return None
    return None


def sequence_has_prompt_prefix(input_ids: Any, generated_ids: Any, prompt_length: int) -> bool | None:
    """Return whether ``generated_ids`` begins with the full ``input_ids`` prompt sequence, or ``None`` when undecidable."""
    try:
        comparison = generated_ids[:, :prompt_length] == input_ids
        if hasattr(comparison, "all"):
            comparison = comparison.all()
        if hasattr(comparison, "item"):
            comparison = comparison.item()
        if isinstance(comparison, bool):
            return comparison
    except Exception:
        return None
    return None


def build_user_prompt(payload: dict[str, Any]) -> str:
    route_prompt = payload.get("prompt")
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    source_prompt = source.get("prompt") if isinstance(source, dict) else None
    title = source.get("title") if isinstance(source, dict) else None
    rating = source.get("rating") if isinstance(source, dict) else None
    context = [
        "Assess this generated song for preference learning across different seeds.",
        route_prompt if isinstance(route_prompt, str) else None,
        f"Title: {title}" if isinstance(title, str) and title else None,
        f"Original generation prompt: {source_prompt}" if isinstance(source_prompt, str) and source_prompt else None,
        f"Known user rating: {rating}" if rating is not None else None,
        "Return one JSON object with keys: summary, genre, instruments, rhythm, tempoBpm, key, mood, production, positives, negatives.",
        "Never copy field descriptions. Fill values from audible evidence only.",
        "Use arrays of short strings for genre, instruments, mood, production, positives, and negatives.",
        "Use a number or null for tempoBpm. Use an empty string for key when uncertain.",
    ]
    return "\n".join(item for item in context if item)


class PreparedAudioPath:
    """Convert compressed audio to wav when ffmpeg is available."""

    def __init__(self, audio_path: Path) -> None:
        self.audio_path = audio_path
        self.temp_dir: tempfile.TemporaryDirectory[str] | None = None
        self.output_path = audio_path

    def __enter__(self) -> Path:
        max_seconds = os.environ.get("QWEN_OMNI_MAX_AUDIO_SECONDS", "120").strip()
        ffmpeg = shutil.which("ffmpeg")
        needs_wav = self.audio_path.suffix.lower() != ".wav"
        should_trim = max_seconds not in {"", "0", "0.0"}
        if not ffmpeg or (not needs_wav and not should_trim):
            return self.audio_path
        self.temp_dir = tempfile.TemporaryDirectory(prefix="qwen-omni-audio-")
        self.output_path = Path(self.temp_dir.name) / "input.wav"
        command = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(self.audio_path)]
        if should_trim:
            command.extend(["-t", max_seconds])
        command.extend(["-ac", "1", "-ar", "16000", str(self.output_path)])
        subprocess.run(command, check=True)
        return self.output_path

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        if self.temp_dir:
            self.temp_dir.cleanup()


def parse_json_object(text: str) -> Any:
    stripped = strip_code_fence(text.strip())
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        if start >= 0:
            decoder = json.JSONDecoder()
            try:
                parsed, _end = decoder.raw_decode(stripped[start:])
                return parsed
            except json.JSONDecodeError:
                return None
        return None


def normalize_assessment(data: dict[str, Any], model_id: str, raw_text: str) -> dict[str, Any]:
    """Coerce parsed assessment JSON into the canonical sidecar shape, filling alternative field names and falling back to ``raw_text``."""
    return {
        "provider": "local-qwen-omni",
        "model": model_id,
        "summary": read_string(data.get("summary")) or read_string(data.get("description")) or raw_text.strip(),
        "genre": read_string_array(data.get("genre")),
        "instruments": read_string_array(data.get("instruments")),
        "rhythm": read_string(data.get("rhythm")) or read_string(data.get("beat")) or "",
        "tempoBpm": read_number(data.get("tempoBpm")) or read_number(data.get("bpm")),
        "key": read_string(data.get("key")) or "",
        "mood": read_string_array(data.get("mood")),
        "production": read_string_array(data.get("production")),
        "positives": read_string_array(data.get("positives")),
        "negatives": read_string_array(data.get("negatives")),
        "rawText": raw_text,
    }


def strip_code_fence(text: str) -> str:
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def read_torch_dtype(torch_module: Any, value: str) -> Any:
    if value == "float16":
        return torch_module.float16
    if value == "bfloat16":
        return torch_module.bfloat16
    if value == "float32":
        return torch_module.float32
    return "auto"


def read_required_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing required string payload field: {key}")
    return value


def read_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def read_number(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def read_string_array(value: Any) -> list[str]:
    if isinstance(value, list):
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]
    single = read_string(value)
    return [single] if single else []


if __name__ == "__main__":
    raise SystemExit(main())
