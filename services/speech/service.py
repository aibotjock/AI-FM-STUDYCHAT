"""Bounded private HTTP adapter for the local Pipecat speech models."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import hmac
import io
import json
import logging
import os
import struct
import wave

from aiohttp import web

VOICES = ("af_heart", "af_bella", "af_nicole", "am_michael", "bf_emma")
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MAX_SPEECH_BYTES = 8 * 1024 * 1024
MAX_TEXT_CHARACTERS = 4096
MAX_RECORDING_SECONDS = 60
MAX_JSON_BYTES = 32 * 1024
RUNTIME = web.AppKey("runtime", object)


class SpeechError(Exception):
    def __init__(self, status, message, code):
        super().__init__(message)
        self.status, self.code = status, code


def parse_wav(data):
    """Require an honest RIFF size, exactly one PCM format and data chunk."""
    invalid = lambda: SpeechError(400, "Use mono PCM16 WAV at 16 kHz.", "invalid_audio")
    if len(data) > MAX_AUDIO_BYTES:
        raise SpeechError(413, "The recording is too large.", "audio_limit")
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise invalid()
    if struct.unpack_from("<I", data, 4)[0] != len(data) - 8:
        raise invalid()
    offset, format_seen, pcm = 12, False, None
    while offset < len(data):
        if offset + 8 > len(data):
            raise invalid()
        kind, size = data[offset:offset + 4], struct.unpack_from("<I", data, offset + 4)[0]
        start, end = offset + 8, offset + 8 + size
        if end > len(data):
            raise invalid()
        if kind == b"fmt ":
            if format_seen or size != 16 or struct.unpack_from("<HHIIHH", data, start) != (1, 1, 16000, 32000, 2, 16):
                raise invalid()
            format_seen = True
        elif kind == b"data":
            if pcm is not None or not size or size % 2:
                raise invalid()
            pcm = data[start:end]
        offset = end + (size % 2)
    if offset != len(data) or not format_seen or pcm is None:
        raise invalid()
    if len(pcm) < 3840:
        raise SpeechError(400, "The recording is too short.", "audio_duration")
    if len(pcm) > 32000 * MAX_RECORDING_SECONDS:
        raise SpeechError(413, "Recordings must be at most 60 seconds.", "audio_duration")
    return pcm


def encode_wav(pcm, sample_rate=24000):
    if not pcm or len(pcm) % 2 or len(pcm) + 44 > MAX_SPEECH_BYTES:
        raise SpeechError(502, "Speech exceeded its audio limit.", "speech_audio_limit")
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(pcm)
    return output.getvalue()


class Runtime:
    """One native inference job; a disconnected client cannot create overlap."""
    def __init__(self, factory):
        self.factory = factory
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="speech")
        self.engine = None
        self.pending = None
        self.state = "loading"
        self.closing = False
        self.startup = None

    async def start(self):
        self.startup = asyncio.create_task(self._load())

    async def _load(self):
        try:
            self.engine = await asyncio.get_running_loop().run_in_executor(self.executor, self.factory)
            self.state = "ready"
        except Exception as error:
            self.state = "failed"
            logging.error("Speech model initialization failed (%s).", type(error).__name__)

    async def run(self, method, *args):
        if self.closing or self.state != "ready":
            raise SpeechError(503, "Speech models are not ready. Continue with typed chat.", "speech_unavailable")
        if self.pending and not self.pending.done():
            raise SpeechError(503, "Speech is busy. Try a new recording after this turn.", "speech_busy")
        self.pending = asyncio.get_running_loop().run_in_executor(self.executor, getattr(self.engine, method), *args)
        # Observe exceptions even when an HTTP timeout or disconnect drops the waiter.
        self.pending.add_done_callback(lambda future: future.exception() if not future.cancelled() else None)
        try:
            return await asyncio.wait_for(asyncio.shield(self.pending), 90)
        except TimeoutError:
            raise SpeechError(504, "Speech preparation timed out. Continue with typed chat.", "speech_timeout") from None

    async def close(self):
        self.closing = True
        if self.startup:
            await asyncio.shield(self.startup)
        if self.pending:
            try:
                await asyncio.shield(self.pending)
            except Exception:
                pass
        if self.engine:
            await asyncio.get_running_loop().run_in_executor(self.executor, self.engine.close)
        self.executor.shutdown(wait=True, cancel_futures=True)


async def limited_body(request, limit):
    if request.content_length is not None and request.content_length > limit:
        raise SpeechError(413, "The request is too large.", "request_limit")
    pieces, size = [], 0
    async for chunk in request.content.iter_chunked(16384):
        size += len(chunk)
        if size > limit:
            raise SpeechError(413, "The request is too large.", "request_limit")
        pieces.append(chunk)
    return b"".join(pieces)


def create_app(token, engine_factory):
    if not isinstance(token, str) or len(token) < 32 or len(token) > 512 or any(c.isspace() for c in token):
        raise ValueError("SPEECH_SERVICE_TOKEN must contain 32–512 characters without whitespace.")

    @web.middleware
    async def protection(request, handler):
        try:
            if request.path != "/health":
                supplied = request.headers.get("Authorization", "")
                if not hmac.compare_digest(supplied.encode("utf-8"), ("Bearer " + token).encode("utf-8")):
                    raise SpeechError(401, "Speech authentication required.", "speech_authentication_required")
            response = await handler(request)
        except SpeechError as error:
            response = web.json_response({"error": {"message": str(error), "code": error.code}}, status=error.status)
            if error.code == "speech_busy":
                response.headers["Retry-After"] = "2"
        except web.HTTPException:
            raise
        except Exception as error:
            logging.error("Speech operation failed (%s).", type(error).__name__)
            response = web.json_response({"error": {"message": "Speech failed. Continue with typed chat.", "code": "speech_failed"}}, status=502)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    app = web.Application(middlewares=[protection], client_max_size=MAX_AUDIO_BYTES)
    runtime = Runtime(engine_factory)
    app[RUNTIME] = runtime

    async def health(request):
        return web.json_response({"ready": runtime.state == "ready" and not runtime.closing, "provider": "self-hosted", "transcriptionModel": "small.en", "speechModel": "kokoro-v1.0", "voices": list(VOICES)}, status=200 if runtime.state == "ready" and not runtime.closing else 503)

    async def transcribe(request):
        if request.content_type != "audio/wav":
            raise SpeechError(415, "Send audio/wav.", "audio_content_type")
        pcm = parse_wav(await limited_body(request, MAX_AUDIO_BYTES))
        text = await runtime.run("transcribe", pcm)
        if not isinstance(text, str) or not text.strip():
            raise SpeechError(422, "No speech was recognized. Make a new recording or type your message.", "voice_empty_transcript")
        return web.json_response({"text": text.strip(), "language": "en", "model": "small.en", "provider": "self-hosted"})

    async def speech(request):
        if request.content_type != "application/json":
            raise SpeechError(415, "Send application/json.", "speech_content_type")
        try:
            payload = json.loads(await limited_body(request, MAX_JSON_BYTES))
        except (ValueError, UnicodeError):
            raise SpeechError(400, "Send valid JSON.", "invalid_json") from None
        if not isinstance(payload, dict) or set(payload) - {"text", "voice"}:
            raise SpeechError(400, "Use text and voice fields only.", "invalid_speech")
        text, voice = payload.get("text"), payload.get("voice")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARACTERS or "\x00" in text:
            raise SpeechError(400, "Speech needs 1–4096 text characters.", "speech_text_limit")
        if voice not in VOICES:
            raise SpeechError(400, "Choose a supported voice.", "invalid_voice")
        audio = await runtime.run("speech", text, voice)
        if not isinstance(audio, bytes) or len(audio) > MAX_SPEECH_BYTES or audio[:4] != b"RIFF":
            raise SpeechError(502, "Speech returned unusable audio.", "speech_format")
        return web.Response(body=audio, content_type="audio/wav")

    async def startup(application):
        await runtime.start()

    async def cleanup(application):
        await runtime.close()

    app.on_startup.append(startup)
    app.on_cleanup.append(cleanup)
    app.router.add_get("/health", health)
    app.router.add_post("/transcribe", transcribe)
    app.router.add_post("/speech", speech)
    return app


if __name__ == "__main__":
    from engine import SpeechEngine
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    app = create_app(os.environ.get("SPEECH_SERVICE_TOKEN", ""), SpeechEngine)
    web.run_app(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8081")), access_log=None, handler_cancellation=True, shutdown_timeout=10)
