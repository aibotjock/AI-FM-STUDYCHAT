import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import io

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from download_models import download, valid_file


class DownloadTests(unittest.TestCase):
    def test_valid_cached_file_needs_no_network_and_corrupt_cache_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "model"
            data = b"a small model fixture"
            target.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            with patch("urllib.request.urlopen") as network:
                download("https://publisher.invalid/model", target, len(data), digest)
                network.assert_not_called()
                target.write_bytes(b"corrupt")
                with self.assertRaises(ValueError):
                    download("https://publisher.invalid/model", target, len(data), digest)
                network.assert_not_called()

    def test_download_is_verified_and_atomic(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "model"
            data = b"model bytes"
            digest = hashlib.sha256(data).hexdigest()
            with patch("urllib.request.urlopen", return_value=io.BytesIO(data)):
                download("https://publisher.invalid/model", target, len(data), digest)
            self.assertEqual(target.read_bytes(), data)
            self.assertFalse(target.with_suffix(".partial").exists())

    def test_wrong_hash_or_size_leaves_no_partial_model(self):
        for response in (b"bad", b"too many bytes for our model"):
            with tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / "model"
                with patch("urllib.request.urlopen", return_value=io.BytesIO(response)):
                    with self.assertRaises(ValueError):
                        download("https://publisher.invalid/model", target, 5, "0" * 64)
                self.assertFalse(target.exists())
                self.assertFalse(target.with_suffix(".partial").exists())


if __name__ == "__main__":
    unittest.main()
