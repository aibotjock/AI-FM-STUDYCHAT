"""Exercise public Pipecat calls without loading models or accessing a network."""
import asyncio
from dataclasses import dataclass
import io
from pathlib import Path
import sys
import unittest
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import SpeechEngine
from service import SpeechError, VOICES
from pipecat.frames.frames import ErrorFrame, TTSAudioRawFrame, TranscriptionFrame, TTSUpdateSettingsFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.kokoro.tts import KokoroTTSService
from pipecat.transcriptions.language import Language


class FakeSTT:
    def __init__(self):
        self.pcm = None
        self.fail = False

    async def run_stt(self, pcm):
        self.pcm = pcm
        if self.fail:
            yield ErrorFrame(error="private model details")
        else:
            yield TranscriptionFrame(" Hello. ", "test", "2026-10-10")


class FakeTTS:
    Settings = KokoroTTSService.Settings

    def __init__(self):
        self.updates = []
        self.text = None
        self.fail = False

    async def process_frame(self, frame, direction):
        self.updates.append((frame, direction))

    async def run_tts(self, text, context_id):
        self.text = text
        if self.fail:
            yield ErrorFrame(error="private model details")
        else:
            yield TTSAudioRawFrame(audio=b"\x01\x00" * 2400, sample_rate=24000, num_channels=1, context_id=context_id)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.engine = SpeechEngine.__new__(SpeechEngine)
        self.engine.loop = asyncio.new_event_loop()
        self.engine.tts, self.engine.stt = FakeTTS(), FakeSTT()
        self.engine.ErrorFrame, self.engine.AudioFrame, self.engine.TranscriptionFrame = ErrorFrame, TTSAudioRawFrame, TranscriptionFrame
        self.engine.UpdateFrame, self.engine.Direction, self.engine.Language = TTSUpdateSettingsFrame, FrameDirection, Language

    def tearDown(self):
        self.engine.loop.run_until_complete(self.engine.loop.shutdown_asyncgens())
        self.engine.loop.close()

    def test_pcm_goes_to_public_run_stt_and_text_is_trimmed(self):
        self.assertEqual(self.engine.transcribe(b"\x00\x00" * 16000), "Hello.")
        self.assertEqual(self.engine.stt.pcm, b"\x00\x00" * 16000)

    def test_voice_settings_include_the_correct_locale_before_synthesis(self):
        for voice in VOICES:
            output = self.engine.speech("A saved answer.", voice)
            frame, direction = self.engine.tts.updates[-1]
            self.assertIsInstance(frame, TTSUpdateSettingsFrame)
            self.assertEqual(frame.delta.voice, voice)
            self.assertEqual(frame.delta.language, Language.EN_GB if voice == "bf_emma" else Language.EN_US)
            self.assertEqual(direction, FrameDirection.DOWNSTREAM)
            self.assertEqual(self.engine.tts.text, "A saved answer.")
            with wave.open(io.BytesIO(output), "rb") as audio:
                self.assertEqual((audio.getframerate(), audio.getnchannels(), audio.getsampwidth()), (24000, 1, 2))

    def test_provider_errors_are_sanitized(self):
        self.engine.tts.fail = self.engine.stt.fail = True
        for operation in (lambda: self.engine.transcribe(b"\x00\x00"), lambda: self.engine.speech("Hello.", VOICES[0])):
            with self.assertRaises(SpeechError) as raised:
                operation()
            self.assertNotIn("private", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
