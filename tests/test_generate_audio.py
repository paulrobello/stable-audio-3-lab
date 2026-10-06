import signal
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import generate_audio  # noqa: E402


class MlxProcessTreeTests(unittest.TestCase):
    def test_mlx_process_runs_in_own_session_for_cleanup(self):
        process = Mock()
        process.communicate.return_value = ("ok", "")
        process.returncode = 0
        process.poll.return_value = 0

        with patch("generate_audio.subprocess.Popen", return_value=process) as popen:
            result = generate_audio.run_process_tree(["/bin/echo", "ok"], cwd=PROJECT_ROOT, timeout_seconds=1)

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "ok")
        popen.assert_called_once()
        self.assertTrue(popen.call_args.kwargs["start_new_session"])

    def test_mlx_process_timeout_kills_process_group(self):
        process = Mock()
        process.pid = 12345
        process.communicate.side_effect = [subprocess.TimeoutExpired(["sa3"], 0.01), ("", "timed out")]
        process.poll.return_value = None

        with patch("generate_audio.subprocess.Popen", return_value=process), patch("generate_audio.os.killpg") as killpg:
            with self.assertRaisesRegex(RuntimeError, "Timed out"):
                generate_audio.run_process_tree(["sa3"], cwd=PROJECT_ROOT, timeout_seconds=0.01)

        killpg.assert_called_with(12345, signal.SIGTERM)

    def test_mlx_process_timeout_escalates_to_sigkill_when_child_ignores_sigterm(self):
        process = Mock()
        process.pid = 12345
        process.communicate.side_effect = [
            subprocess.TimeoutExpired(["sa3"], 0.01),
            subprocess.TimeoutExpired(["sa3"], 10),
            ("", "ignored term"),
        ]
        process.poll.return_value = None

        with patch("generate_audio.subprocess.Popen", return_value=process), patch("generate_audio.os.killpg") as killpg:
            with self.assertRaisesRegex(RuntimeError, "Timed out"):
                generate_audio.run_process_tree(["sa3"], cwd=PROJECT_ROOT, timeout_seconds=0.01)

        killpg.assert_any_call(12345, signal.SIGTERM)
        killpg.assert_any_call(12345, signal.SIGKILL)
    def test_invalid_backend_env_defaults_to_mlx(self):
        self.assertEqual(generate_audio.normalize_backend("bogus"), "mlx")
        self.assertEqual(generate_audio.normalize_backend("torch"), "torch")
        self.assertEqual(generate_audio.normalize_backend("mlx"), "mlx")


class FractionalDurationTests(unittest.TestCase):
    """Fractional durations are conditioned at whole seconds, then trimmed (NaN fix)."""

    def test_conditioning_seconds_rounds_up_to_whole_seconds(self):
        self.assertEqual(generate_audio.conditioning_seconds(1.5), 2.0)
        self.assertEqual(generate_audio.conditioning_seconds(1.6), 2.0)
        self.assertEqual(generate_audio.conditioning_seconds(0.5), 1.0)
        self.assertEqual(generate_audio.conditioning_seconds(2.0), 2.0)
        self.assertEqual(generate_audio.conditioning_seconds(1.0000000001), 1.0)

    def _run_mlx(self, duration: float) -> tuple[list[str], int]:
        import tempfile
        import wave

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "sa3").write_text("")
            out = tmp_path / "out.wav"
            seen: list[list[str]] = []

            def fake_sa3(command, cwd, timeout_seconds):
                seen.append(command)
                seconds = float(command[command.index("--seconds") + 1])
                generate_audio.write_mock_wav(Path(command[command.index("--out") + 1]), "x", "sfx", seconds, 1)
                return Mock(returncode=0, stdout="", stderr="")

            args = Mock(
                dit="sm-sfx", decoder="same-s", prompt="pop", negative_prompt="", duration=duration,
                steps=30, cfg_scale=5.0, seed=1100, out=str(out),
            )
            with patch.dict("os.environ", {"STABLE_AUDIO_MLX_DIR": tmp}), \
                    patch.object(generate_audio, "run_process_tree", side_effect=fake_sa3):
                generate_audio.generate_mlx(args)
            with wave.open(str(out), "rb") as wav:
                return seen[0], wav.getnframes()

    def test_fractional_duration_conditions_whole_second_and_trims(self):
        command, frames = self._run_mlx(1.5)
        self.assertEqual(command[command.index("--seconds") + 1], "2.0")
        self.assertEqual(frames, 66150)

    def test_whole_second_duration_is_unchanged(self):
        command, frames = self._run_mlx(2.0)
        self.assertEqual(command[command.index("--seconds") + 1], "2.0")
        self.assertEqual(frames, 88200)


if __name__ == "__main__":
    unittest.main()
