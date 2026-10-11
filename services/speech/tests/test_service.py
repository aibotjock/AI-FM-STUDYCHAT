import asyncio
import io
import json
import struct
import sys
import threading
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aiohttp.test_utils import TestClient, TestServer
from service import (MAX_AUDIO_BYTES, MAX_SPEECH_BYTES, MAX_TEXT_CHARACTERS, RUNTIME,
                     SpeechError, VOICES, create_app, encode_wav, parse_wav)

TOKEN = "unit-test-token-is-not-a-secret-0123456789"


def wav(seconds=1, sample_rate=16000, channels=1):
    result = io.BytesIO()
    with wave.open(result, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(b"\x01\x00" * int(sample_rate * seconds) * channels)
    return result.getvalue()


class FakeEngine:
    def __init__(self):
        self.calls = []
        self.closed = False
        self.release = threading.Event()
        self.block = False

    def transcribe(self, pcm):
        self.calls.append(("transcribe", len(pcm)))
        return "What is hypertension?"

    def speech(self, text, voice):
        self.calls.append(("speech", text, voice))
        if self.block:
            self.release.wait(5)
        return encode_wav(b"\x01\x00" * 2400)

    def close(self):
        self.closed = True


class WavTests(unittest.TestCase):
    def test_extracts_only_pcm(self):
        self.assertEqual(parse_wav(wav()), b"\x01\x00" * 16000)
        self.assertEqual(len(parse_wav(wav(60))), 1920000)

    def test_rejects_lies_and_unsupported_formats(self):
        cases = [b"bad", wav()[:-2], wav() + b"hidden", wav(sample_rate=24000), wav(channels=2), wav(.1), wav(60.1)]
        altered = bytearray(wav())
        struct.pack_into("<I", altered, 40, 32000 + 20)
        cases.append(bytes(altered))
        duplicate = wav() + wav()[12:36]
        duplicate = duplicate[:4] + struct.pack("<I", len(duplicate) - 8) + duplicate[8:]
        cases.append(duplicate)
        for body in cases:
            with self.subTest(size=len(body)), self.assertRaises(SpeechError):
                parse_wav(body)

    def test_output_is_24khz_pcm16_mono_and_bounded(self):
        body = encode_wav(b"\x01\x00" * 2400)
        with wave.open(io.BytesIO(body), "rb") as audio:
            self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()), (1, 2, 24000, 2400))
        for pcm in (b"", b"a", b"0" * MAX_SPEECH_BYTES):
            with self.assertRaises(SpeechError):
                encode_wav(pcm)


class HttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = FakeEngine()
        self.app = create_app(TOKEN, lambda: self.engine)
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()
        await self.app[RUNTIME].startup
        self.headers = {"Authorization": "Bearer " + TOKEN}

    async def asyncTearDown(self):
        self.engine.release.set()
        await self.client.close()
        self.assertTrue(self.engine.closed)

    async def test_health_does_not_need_token_and_post_auth_does(self):
        response = await self.client.get("/health")
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["voices"], list(VOICES))
        for path in ("/transcribe", "/speech"):
            response = await self.client.post(path, data=b"bad")
            self.assertEqual(response.status, 401)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(self.engine.calls, [])

    async def test_transcribe_receives_pcm_and_returns_safe_metadata(self):
        response = await self.client.post("/transcribe", data=wav(), headers={**self.headers, "Content-Type": "audio/wav"})
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.json(), {"text": "What is hypertension?", "language": "en", "model": "small.en", "provider": "self-hosted"})
        self.assertEqual(self.engine.calls, [("transcribe", 32000)])

    async def test_all_five_voice_ids_are_passed_exactly(self):
        for voice in VOICES:
            response = await self.client.post("/speech", json={"text": "Hello.", "voice": voice}, headers=self.headers)
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "audio/wav")
            self.assertEqual((await response.read())[:4], b"RIFF")
        self.assertEqual([call[2] for call in self.engine.calls], list(VOICES))

    async def test_invalid_speech_does_not_reach_inference(self):
        payloads = [None, [], {"text": "", "voice": VOICES[0]}, {"text": "a" * (MAX_TEXT_CHARACTERS + 1), "voice": VOICES[0]}, {"text": "\x00", "voice": VOICES[0]}, {"text": "hello", "voice": "marin"}, {"text": "hello", "voice": VOICES[0], "model": "paid"}, {"text": "hello", "voice": []}]
        for payload in payloads:
            response = await self.client.post("/speech", data=json.dumps(payload), headers={**self.headers, "Content-Type": "application/json"})
            self.assertEqual(response.status, 400)
        self.assertEqual(self.engine.calls, [])

    async def test_bounds_and_content_type_precede_inference(self):
        for body, content_type, expected in [(wav(), "application/octet-stream", 415), (b"bad", "audio/wav", 400), (b"0" * (MAX_AUDIO_BYTES + 1), "audio/wav", 413)]:
            response = await self.client.post("/transcribe", data=io.BytesIO(body), headers={**self.headers, "Content-Type": content_type})
            self.assertEqual(response.status, expected)
        response = await self.client.post("/speech", data=b"0" * 33000, headers={**self.headers, "Content-Type": "application/json"})
        self.assertEqual(response.status, 413)
        self.assertEqual(self.engine.calls, [])

    async def test_parallel_requests_are_rejected_without_queue(self):
        self.engine.block = True
        task = asyncio.create_task(self.client.post("/speech", json={"text": "First.", "voice": VOICES[0]}, headers=self.headers))
        for _ in range(100):
            if self.engine.calls:
                break
            await asyncio.sleep(.001)
        response = await self.client.post("/speech", json={"text": "Second.", "voice": VOICES[1]}, headers=self.headers)
        self.assertEqual(response.status, 503)
        self.assertEqual((await response.json())["error"]["code"], "speech_busy")
        self.assertEqual(len(self.engine.calls), 1)
        self.engine.release.set()
        self.assertEqual((await task).status, 200)

    async def test_cancelled_waiter_keeps_native_worker_occupied(self):
        self.engine.block = True
        runtime = self.app[RUNTIME]
        task = asyncio.create_task(runtime.run("speech", "First.", VOICES[0]))
        for _ in range(100):
            if self.engine.calls:
                break
            await asyncio.sleep(.001)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        with self.assertRaises(SpeechError) as error:
            await runtime.run("speech", "Second.", VOICES[1])
        self.assertEqual(error.exception.code, "speech_busy")
        self.engine.release.set()
        await asyncio.shield(runtime.pending)
        await runtime.run("speech", "Third.", VOICES[2])
        self.assertEqual(len(self.engine.calls), 2)


class ConfigTests(unittest.TestCase):
    def test_missing_short_or_whitespace_secret_refused(self):
        for token in (None, "", "short", "a" * 513, "a" * 32 + "\n"):
            with self.assertRaises(ValueError):
                create_app(token, FakeEngine)


if __name__ == "__main__":
    unittest.main()
