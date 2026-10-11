"""Download fixed local models once; Docker bakes these into its image."""
import hashlib
import os
from pathlib import Path
import urllib.request

KOKORO_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
WHISPER_REPO = "Systran/faster-whisper-small.en"
WHISPER_REVISION = "d1d751a5f8271d482d14ca55d9e2deeebbae577f"
FILES = (
    ("kokoro-v1.0.onnx", KOKORO_RELEASE + "kokoro-v1.0.onnx", 325532387, "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5"),
    ("voices-v1.0.bin", KOKORO_RELEASE + "voices-v1.0.bin", 28214398, "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"),
    ("whisper-small.en/model.bin", f"https://huggingface.co/{WHISPER_REPO}/resolve/{WHISPER_REVISION}/model.bin", 483545366, "62b2a45b05ee59acb4a5341b33ee35e041395d378d418a18acfe4c9e768ee37a"),
)
WHISPER_TEXT_FILES = {"config.json": (2657, "ced3fd5bbb3e9f7664658065d2d36164712cf1d5"), "tokenizer.json": (2128466, "15d7bdf9ba25718ca2504eec6a8f02bc55af0a6a"), "vocabulary.txt": (422309, "ee695b8d3e3c10d488304e04468efec4ca27554a")}


def valid_file(path, size, expected_hash, git_blob=False):
    if not path.is_file() or path.stat().st_size != size:
        return False
    digest = hashlib.sha1() if git_blob else hashlib.sha256()
    if git_blob:
        digest.update(f"blob {size}\0".encode())
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest() == expected_hash


def download(url, destination, size, expected_hash, git_blob=False):
    if destination.is_file():
        if valid_file(destination, size, expected_hash, git_blob):
            return
        raise ValueError(f"Cached model failed its integrity check: {destination.name}. Remove it and rebuild.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    try:
        with urllib.request.urlopen(url, timeout=300) as response, temporary.open("wb") as target:
            received = 0
            while chunk := response.read(1024 * 1024):
                received += len(chunk)
                if received > size:
                    raise ValueError("The model download exceeded its pinned size.")
                target.write(chunk)
        if not valid_file(temporary, size, expected_hash, git_blob):
            raise ValueError("The model download failed its integrity check.")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def ensure_models(models):
    models = Path(models)
    kokoro, voices = models / "kokoro-v1.0.onnx", models / "voices-v1.0.bin"
    for name, url, size, digest in FILES:
        download(url, models / name, size, digest)
    whisper = models / "whisper-small.en"
    for name, (size, digest) in WHISPER_TEXT_FILES.items():
        download(f"https://huggingface.co/{WHISPER_REPO}/resolve/{WHISPER_REVISION}/{name}", whisper / name, size, digest, git_blob=True)
    return whisper, kokoro, voices


if __name__ == "__main__":
    ensure_models(Path(os.environ.get("MODELS_DIR", "/models")))
