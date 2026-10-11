"""Explicit CPU model smoke test. No provider API, real microphone, or LLM calls."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave

parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True)
parser.add_argument("--audio-dir", required=True)
parser.add_argument("--skip-long", action="store_true")
args = parser.parse_args()
directory = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(directory))
from service import VOICES

token_path = Path(os.environ.get("SPEECH_TEST_TOKEN_FILE", "/workspace/scratch/f8d789875308/speech-service-test-token.txt"))
token = token_path.read_text().strip()
environment = dict(os.environ, SPEECH_SERVICE_TOKEN=token, HOST="127.0.0.1", PORT="8081", OMP_NUM_THREADS="2")
audio_dir = Path(args.audio_dir)
audio_dir.mkdir(parents=True, exist_ok=True)
started = time.monotonic()
metrics_directory = tempfile.TemporaryDirectory(prefix="speech-metrics-")
metrics_path = Path(metrics_directory.name) / "metrics.json"
environment["SPEECH_TEST_METRICS_FILE"] = str(metrics_path)
child_code = '''
import json,os,resource,runpy,threading,time
from pathlib import Path
def monitor():
    target=Path(os.environ["SPEECH_TEST_METRICS_FILE"])
    while True:
        data={}
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith(("VmRSS:","VmHWM:","Threads:")):
                key,value=line.split(":",1); data[key]=int(value.strip().split()[0])
        usage=resource.getrusage(resource.RUSAGE_SELF)
        data["cpuSeconds"]=round(usage.ru_utime+usage.ru_stime,3)
        temporary=target.with_suffix(".tmp")
        temporary.write_text(json.dumps(data)); temporary.replace(target)
        time.sleep(.1)
threading.Thread(target=monitor,daemon=True).start()
runpy.run_path("service.py",run_name="__main__")
'''
process = subprocess.Popen([sys.executable, "-c", child_code], cwd=directory, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
report = {"testedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "software": "Pipecat1.12.0 / faster-whisper1.2.1 / kokoro-onnx0.6.1", "fixture": "synthetic speech, not a clinical accuracy benchmark", "cpuAffinity": sorted(os.sched_getaffinity(0)), "voices": []}


def stats():
    # The child reports /proc/self; managed execution can wrap subprocess PIDs.
    return json.loads(metrics_path.read_text())


def request(path, payload=None, content_type="application/json"):
    begin = time.monotonic()
    if isinstance(payload, dict):
        payload = json.dumps(payload).encode()
    req = urllib.request.Request("http://127.0.0.1:8081" + path, data=payload, headers={"Authorization": "Bearer " + token, "Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=120) as response:
        body = response.read()
        return response.status, body, round((time.monotonic() - begin) * 1000)


try:
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("The model service exited before readiness.")
        try:
            _, body, _ = request("/health")
            if json.loads(body)["ready"]:
                break
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(.25)
    else:
        raise TimeoutError("Models did not become ready within 180 seconds.")
    report["startupMs"] = round((time.monotonic() - started) * 1000)
    report["readyMemory"] = stats()
    text = "Hello. Let us review hypertension and diabetes. What would you like to study today?"
    clips = {}
    for voice in VOICES:
        status, body, latency = request("/speech", {"text": text, "voice": voice})
        with wave.open(io.BytesIO(body), "rb") as audio:
            assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (24000, 1, 2)
            duration = audio.getnframes() / audio.getframerate()
            pcm = audio.readframes(audio.getnframes())
        assert any(pcm)
        clips[voice] = body
        (audio_dir / f"{voice}.wav").write_bytes(body)
        report["voices"].append({"voice": voice, "status": status, "bytes": len(body), "speechMs": latency, "audioSeconds": round(duration, 3), "sha256": hashlib.sha256(body).hexdigest()})

    # Repeat synthesis for determinism, then exercise actual Whisper recognition.
    _, repeated, repeat_latency = request("/speech", {"text": text, "voice": VOICES[0]})
    report["repeatVoice"] = {"sameBytes": repeated == clips[VOICES[0]], "speechMs": repeat_latency}
    import soxr
    import numpy as np
    with wave.open(io.BytesIO(clips[VOICES[0]]), "rb") as audio:
        source = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2")
    pcm = np.rint(soxr.resample(source.astype(np.float32), 24000, 16000)).clip(-32768, 32767).astype("<i2").tobytes()
    def make_wav(raw):
        output = io.BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setframerate(16000)
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.writeframes(raw)
        return output.getvalue()
    status, body, latency = request("/transcribe", make_wav(pcm), "audio/wav")
    report["transcription"] = {"status": status, "latencyMs": latency, "result": json.loads(body)}
    assert "hypertension" in json.loads(body)["text"].lower()
    if not args.skip_long:
        long_pcm = (pcm * (1920000 // len(pcm) + 1))[:1920000]
        status, body, latency = request("/transcribe", make_wav(long_pcm), "audio/wav")
        report["sixtySecondTranscription"] = {"status": status, "latencyMs": latency, "characters": len(json.loads(body)["text"])}
        long_text = ("A focused study session starts with one clear learning objective. Review the main idea, explain it in your own words, and then answer a practice question. " * 8).strip()
        status, body, latency = request("/speech", {"text": long_text, "voice": VOICES[0]})
        with wave.open(io.BytesIO(body), "rb") as audio:
            duration = audio.getnframes() / audio.getframerate()
        report["longReply"] = {"characters": len(long_text), "status": status, "speechMs": latency, "bytes": len(body), "audioSeconds": round(duration, 3)}
    report["finalMemory"] = stats()
    Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
finally:
    process.terminate()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    metrics_directory.cleanup()
