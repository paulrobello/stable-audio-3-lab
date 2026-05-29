import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import audio_assessor_qwen_omni as assessor  # noqa: E402


class QwenOmniAssessorTests(unittest.TestCase):
    def test_assess_audio_normalizes_qwen_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / "song.wav"
            audio_path.write_bytes(b"RIFF")
            qwen_output = json.dumps({
                "summary": "Driving synthwave with tight drums.",
                "genre": ["synthwave"],
                "instruments": ["analog bass", "drum machine"],
                "rhythm": "four on the floor",
                "tempoBpm": 118,
                "key": "A minor",
                "mood": ["driving"],
                "production": ["wide stereo image"],
                "positives": ["clear groove"],
                "negatives": ["repetitive lead"],
            })

            with patch.dict(os.environ, {"QWEN_OMNI_MAX_AUDIO_SECONDS": "0"}), \
                    patch("audio_assessor_qwen_omni.run_qwen_omni", return_value=qwen_output):
                result = assessor.assess_audio({
                    "audioPath": str(audio_path),
                    "source": {"title": "Test Song", "prompt": "synthwave"},
                    "prompt": "Assess the audio.",
                })

        self.assertEqual(result["provider"], "local-qwen-omni")
        self.assertEqual(result["model"], "Qwen/Qwen2.5-Omni-7B")
        self.assertEqual(result["summary"], "Driving synthwave with tight drums.")
        self.assertEqual(result["instruments"], ["analog bass", "drum machine"])
        self.assertEqual(result["tempoBpm"], 118)

    def test_parse_json_object_accepts_code_fence(self):
        parsed = assessor.parse_json_object('```json\n{"summary": "ok"}\n```')
        self.assertEqual(parsed, {"summary": "ok"})

    def test_parse_json_object_accepts_first_object_with_trailing_content(self):
        parsed = assessor.parse_json_object('{"summary": "ok"}\n{"ignored": true}')
        self.assertEqual(parsed, {"summary": "ok"})

    def test_build_user_prompt_does_not_embed_placeholder_json_values(self):
        prompt = assessor.build_user_prompt({})

        self.assertNotIn("one concise sentence about the audible result", prompt)
        self.assertNotIn("audible instruments or sound sources", prompt)
        self.assertIn("Never copy field descriptions", prompt)

    def test_trim_generated_ids_removes_prompt_tokens(self):
        class FakeInputIds:
            shape = (1, 3)

        class FakeGeneratedIds:
            shape = (1, 5)

            def __getitem__(self, key):
                if key == (slice(None), slice(3, None)):
                    return "trimmed ids"
                raise AssertionError(f"unexpected slice: {key!r}")

        trimmed = assessor.trim_generated_ids({"input_ids": FakeInputIds()}, FakeGeneratedIds())

        self.assertEqual(trimmed, "trimmed ids")

    def test_missing_audio_path_fails_before_model_load(self):
        with self.assertRaisesRegex(FileNotFoundError, "Audio file not found"):
            assessor.assess_audio({"audioPath": "/tmp/definitely-missing-audio.wav"})

    def test_run_qwen_omni_uses_multimodal_audio_processor_path(self):
        calls = {}

        class FakeTorch:
            float16 = "float16"
            bfloat16 = "bfloat16"
            float32 = "float32"

            class inference_mode:
                def __enter__(self):
                    return None

                def __exit__(self, _exc_type, _exc, _traceback):
                    return None

        class FakeInputs(dict):
            def to(self, device):
                calls["inputs_device"] = device
                return self

        class FakeInputIds:
            shape = (1, 2)

        class FakePrefixComparison:
            def all(self):
                return self

            def item(self):
                return True

        class FakePrefix:
            def __eq__(self, _other):
                return FakePrefixComparison()

        class FakeGeneratedIds:
            shape = (1, 4)

            def __getitem__(self, key):
                calls["generated_slice"] = key
                if key == (slice(None), slice(None, 2)):
                    return FakePrefix()
                return "trimmed ids"

        class FakeProcessor:
            @classmethod
            def from_pretrained(cls, model_id):
                calls["processor_model_id"] = model_id
                return cls()

            def apply_chat_template(self, conversation, **kwargs):
                calls["conversation"] = conversation
                calls["chat_template_kwargs"] = kwargs
                return "templated prompt"

            def __call__(self, **kwargs):
                calls["processor_call"] = kwargs
                return FakeInputs({"input_ids": FakeInputIds()})

            def batch_decode(self, generated_ids, **kwargs):
                calls["decoded_ids"] = generated_ids
                calls["decode_kwargs"] = kwargs
                return ['{"summary": "ok"}']

        class FakeModel:
            device = "cpu"

            @classmethod
            def from_pretrained(cls, model_id, **kwargs):
                calls["model_id"] = model_id
                calls["model_kwargs"] = kwargs
                return cls()

            def disable_talker(self):
                calls["disabled_talker"] = True

            def generate(self, **kwargs):
                calls["generate_kwargs"] = kwargs
                return FakeGeneratedIds()

        def fake_process_mm_info(conversation, **kwargs):
            calls["process_conversation"] = conversation
            calls["process_kwargs"] = kwargs
            return ["audio samples"], [], []

        fake_transformers = types.ModuleType("transformers")
        fake_transformers.Qwen2_5OmniForConditionalGeneration = FakeModel
        fake_transformers.Qwen2_5OmniProcessor = FakeProcessor
        fake_qwen_utils = types.ModuleType("qwen_omni_utils")
        fake_qwen_utils.process_mm_info = fake_process_mm_info

        modules = {
            "torch": FakeTorch(),
            "transformers": fake_transformers,
            "qwen_omni_utils": fake_qwen_utils,
        }
        with patch.dict(sys.modules, modules), patch.dict(os.environ, {"QWEN_OMNI_MAX_NEW_TOKENS": "42"}):
            result = assessor.run_qwen_omni("model-id", Path("/tmp/song.wav"), "Describe it.")

        self.assertEqual(result, '{"summary": "ok"}')
        self.assertEqual(calls["processor_model_id"], "model-id")
        self.assertEqual(calls["model_id"], "model-id")
        self.assertEqual(calls["chat_template_kwargs"]["tokenize"], False)
        self.assertEqual(calls["process_kwargs"], {"use_audio_in_video": False})
        self.assertEqual(calls["processor_call"]["text"], "templated prompt")
        self.assertEqual(calls["processor_call"]["audio"], ["audio samples"])
        self.assertEqual(calls["processor_call"]["images"], [])
        self.assertEqual(calls["processor_call"]["videos"], [])
        self.assertEqual(calls["processor_call"]["use_audio_in_video"], False)
        self.assertEqual(calls["inputs_device"], "cpu")
        self.assertEqual(calls["generate_kwargs"]["max_new_tokens"], 42)
        self.assertEqual(calls["generate_kwargs"]["return_audio"], False)
        self.assertEqual(calls["decoded_ids"], "trimmed ids")
        self.assertEqual(calls["generated_slice"], (slice(None), slice(2, None)))
        self.assertTrue(calls["disabled_talker"])
        audio_item = calls["conversation"][1]["content"][0]
        self.assertEqual(audio_item, {"type": "audio", "audio": "/tmp/song.wav"})


if __name__ == "__main__":
    unittest.main()
