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


if __name__ == "__main__":
    unittest.main()
