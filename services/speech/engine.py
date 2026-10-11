"""Pipecat's public local STT/TTS services, isolated from the HTTP event loop."""
import asyncio
from contextlib import aclosing
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import sys
import uuid

from service import MAX_SPEECH_BYTES, SpeechError, VOICES, encode_wav


class SpeechEngine:
    def __init__(self):
        # Applied before any model imports; no CUDA or hosted speech API is used.
        models = Path(os.environ.get("MODELS_DIR", "/models"))
        os.environ.setdefault("HF_HOME", str(models / "huggingface"))
        os.environ.setdefault("ONNX_PROVIDER", "CPUExecutionProvider")
        os.environ.setdefault("OMP_NUM_THREADS", "4")
        os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
        from loguru import logger
        logger.remove()
        logger.add(sys.stderr, level="WARNING")
        from pipecat.clocks.system_clock import SystemClock
        from pipecat.frames.frames import ErrorFrame, TTSAudioRawFrame, TranscriptionFrame, TTSUpdateSettingsFrame
        from pipecat.processors.frame_processor import FrameDirection, FrameProcessorSetup
        from pipecat.services.kokoro.tts import KokoroTTSService
        from pipecat.services.whisper.stt import WhisperSTTService
        from pipecat.transcriptions.language import Language
        from pipecat.utils.asyncio.task_manager import TaskManager
        from download_models import ensure_models

        whisper_path, kokoro_path, voices_path = ensure_models(models)
        self.loop = asyncio.new_event_loop()
        self.loop.set_default_executor(ThreadPoolExecutor(max_workers=1, thread_name_prefix="model"))
        asyncio.set_event_loop(self.loop)
        self.ErrorFrame, self.AudioFrame, self.TranscriptionFrame = ErrorFrame, TTSAudioRawFrame, TranscriptionFrame
        self.UpdateFrame, self.Direction, self.Language = TTSUpdateSettingsFrame, FrameDirection, Language
        self.tts = KokoroTTSService(model_path=str(kokoro_path), voices_path=str(voices_path), sample_rate=24000, settings=KokoroTTSService.Settings(voice=VOICES[0], language=Language.EN_US, speed=1.0))
        self.stt = WhisperSTTService(device="cpu", compute_type="int8", sample_rate=16000, settings=WhisperSTTService.Settings(model=str(whisper_path), language=Language.EN, no_speech_prob=0.6, hotwords=None, initial_prompt=None))
        clock = SystemClock()
        clock.start()
        setup = FrameProcessorSetup(clock=clock, task_manager=TaskManager(loop=self.loop), pipeline_worker=None, audio_in_sample_rate=16000, audio_out_sample_rate=24000)

        async def prepare():
            await self.tts.setup(setup)
            await self.stt.setup(setup)
        self.loop.run_until_complete(prepare())
        # Readiness means both models can actually execute, not just import.
        self.speech("Speech is ready.", VOICES[0])
        self.transcribe(b"\x00\x00" * 16000)

    def transcribe(self, pcm):
        async def recognize():
            parts = []
            async with aclosing(self.stt.run_stt(pcm)) as frames:
                async for frame in frames:
                    if isinstance(frame, self.ErrorFrame):
                        raise SpeechError(502, "Transcription failed.", "transcription_failed")
                    if isinstance(frame, self.TranscriptionFrame):
                        parts.append(frame.text.strip())
            return " ".join(parts)
        return self.loop.run_until_complete(recognize())

    def speech(self, text, voice):
        async def synthesize():
            language = self.Language.EN_GB if voice.startswith("b") else self.Language.EN_US
            await self.tts.process_frame(self.UpdateFrame(delta=self.tts.Settings(voice=voice, language=language)), self.Direction.DOWNSTREAM)
            chunks, size = [], 0
            async with aclosing(self.tts.run_tts(text, str(uuid.uuid4()))) as frames:
                async for frame in frames:
                    if isinstance(frame, self.ErrorFrame):
                        raise SpeechError(502, "Speech synthesis failed.", "speech_failed")
                    if isinstance(frame, self.AudioFrame):
                        if frame.sample_rate != 24000 or frame.num_channels != 1:
                            raise SpeechError(502, "Speech returned an unsupported format.", "speech_format")
                        size += len(frame.audio)
                        if size + 44 > MAX_SPEECH_BYTES:
                            raise SpeechError(502, "Speech exceeded its audio limit.", "speech_audio_limit")
                        chunks.append(frame.audio)
            return encode_wav(b"".join(chunks))
        return self.loop.run_until_complete(synthesize())

    def close(self):
        async def cleanup():
            await self.stt.cleanup()
            await self.tts.cleanup()
        self.loop.run_until_complete(cleanup())
        self.loop.run_until_complete(self.loop.shutdown_asyncgens())
        self.loop.run_until_complete(self.loop.shutdown_default_executor())
        self.loop.close()
