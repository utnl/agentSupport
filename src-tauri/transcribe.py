#!/usr/bin/env python3
"""
Dual-Track Realtime Transcription Pipeline
- Track 1 (Draft): Fast preview using Whisper Tiny (every 2s)
- Track 2 (Final): Accurate result using Whisper Small (on sentence end via VAD)
"""
import sys
import json
import soundcard as sc
import numpy as np
from faster_whisper import WhisperModel
import webrtcvad
import collections
import threading
import time
import uuid

# Dual models for dual-track pipeline
model_tiny = WhisperModel("tiny", device="cpu", compute_type="int8")   # Fast draft
model_small = WhisperModel("small", device="cpu", compute_type="int8") # Accurate final

def emit_event(event_type, data):
    """Gửi event về Tauri qua stdout"""
    print(json.dumps({"type": event_type, "data": data}), flush=True)

class DualTrackRecorder:
    """
    Dual-Track Recording with VAD
    - Track 1: Quick preview every 2s (draft)
    - Track 2: Complete sentence when VAD detects silence (final)
    """
    def __init__(self, sample_rate=16000, language="en"):
        self.sample_rate = sample_rate
        self.language = language
        
        # VAD setup
        self.vad = webrtcvad.Vad(2)  # Aggressiveness 0-3
        self.frame_duration_ms = 30
        self.frame_size = int(sample_rate * self.frame_duration_ms / 1000)
        
        # Silence detection (1 second = ~33 frames of 30ms)
        self.silence_frames_threshold = 33
        self.ring_buffer = collections.deque(maxlen=self.silence_frames_threshold)
        
        # Audio buffers
        self.current_sentence_buffer = []  # Full sentence buffer
        self.draft_buffer = []             # 2-second draft buffer
        self.triggered = False
        
        # Timing
        self.last_draft_time = time.time()
        self.draft_interval = 2.0  # Send draft every 2 seconds
        self.max_sentence_duration = 15.0  # Force finalize after 15s
        self.sentence_start_time = None
        
        # Tracking
        self.current_draft_id = None
        
    def process_frame(self, frame):
        """
        Process one audio frame (30ms)
        Returns: (event_type, data) or (None, None)
        """
        # Convert to int16 for VAD
        frame_int16 = (frame * 32767).astype(np.int16).tobytes()
        is_speech = self.vad.is_speech(frame_int16, self.sample_rate)
        
        current_time = time.time()
        
        if not self.triggered:
            # Waiting for speech to start
            self.ring_buffer.append((frame, is_speech))
            num_voiced = len([f for f, speech in self.ring_buffer if speech])
            
            if num_voiced > 0.7 * self.ring_buffer.maxlen:
                # Speech detected - start recording
                self.triggered = True
                self.current_sentence_buffer = [f for f, _ in self.ring_buffer]
                self.draft_buffer = list(self.current_sentence_buffer)
                self.ring_buffer.clear()
                self.sentence_start_time = current_time
                self.last_draft_time = current_time
                self.current_draft_id = str(uuid.uuid4())[:8]
                emit_event("debug", f"Speech started (draft_id={self.current_draft_id})")
        else:
            # Currently recording speech
            self.current_sentence_buffer.append(frame)
            self.draft_buffer.append(frame)
            self.ring_buffer.append((frame, is_speech))
            
            # Check for draft emission (every 2 seconds)
            if current_time - self.last_draft_time >= self.draft_interval:
                if len(self.draft_buffer) > 0:
                    # Send only the NEW accumulated draft buffer (since last draft)
                    audio_chunk = np.concatenate(self.draft_buffer)
                    draft_id = self.current_draft_id
                    self.draft_buffer = []  # Clear draft buffer after sending
                    self.last_draft_time = current_time
                    return ("draft", {"audio": audio_chunk, "draft_id": draft_id})
            
            # Check for sentence end (silence detected)
            num_unvoiced = len([f for f, speech in self.ring_buffer if not speech])
            sentence_duration = current_time - self.sentence_start_time
            
            if num_unvoiced > 0.85 * self.ring_buffer.maxlen or sentence_duration > self.max_sentence_duration:
                # Sentence ended - finalize
                self.triggered = False
                audio_chunk = np.concatenate(self.current_sentence_buffer)
                draft_id = self.current_draft_id
                
                # Reset buffers
                self.current_sentence_buffer = []
                self.draft_buffer = []
                self.ring_buffer.clear()
                self.current_draft_id = None
                
                emit_event("debug", f"Sentence ended (duration: {sentence_duration:.1f}s, draft_id={draft_id})")
                return ("final", {"audio": audio_chunk, "draft_id": draft_id})
        
        return (None, None)

def transcribe_draft(audio_chunk, language, draft_id):
    """Track 1: Fast draft transcription (Whisper Tiny) - INCREMENTAL only"""
    try:
        if len(audio_chunk) < 8000:  # Min 0.5s
            return
        
        segments, _ = model_tiny.transcribe(
            audio_chunk,
            language=language if language != "auto" else None,
            beam_size=1,  # Fast mode
            vad_filter=False
        )
        
        text_parts = []
        for segment in segments:
            text = segment.text.strip()
            if text:
                text_parts.append(text)
        
        if text_parts:
            # Only send the NEW chunk, not accumulated
            full_text = " ".join(text_parts)
            emit_event("transcript-draft", {
                "text": full_text,
                "draft_id": draft_id,
                "lang": language,
                "is_incremental": True  # Flag to indicate this is a chunk
            })
    except Exception as e:
        emit_event("debug", f"Draft error: {str(e)}")

def transcribe_final(audio_chunk, language, draft_id):
    """Track 2: Accurate final transcription (Whisper Small)"""
    try:
        if len(audio_chunk) < 8000:  # Min 0.5s
            return
        
        segments, _ = model_small.transcribe(
            audio_chunk,
            language=language if language != "auto" else None,
            beam_size=5,  # Accurate mode
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200
            )
        )
        
        text_parts = []
        for segment in segments:
            text = segment.text.strip()
            if text:
                text_parts.append(text)
        
        if text_parts:
            full_text = " ".join(text_parts)
            
            # Deduplication: check if we already sent this exact text
            if not hasattr(transcribe_final, '_last_texts'):
                transcribe_final._last_texts = []
            
            if full_text in transcribe_final._last_texts:
                emit_event("debug", f"Skipping duplicate final: {full_text[:50]}...")
                return
            
            # Keep only last 5 texts for comparison
            transcribe_final._last_texts.append(full_text)
            if len(transcribe_final._last_texts) > 5:
                transcribe_final._last_texts.pop(0)
            
            emit_event("transcript-final", {
                "text": full_text,
                "draft_id": draft_id,
                "lang": language
            })
    except Exception as e:
        emit_event("debug", f"Final error: {str(e)}")

def record_dual_track(duration_secs, language):
    """Main recording loop with dual-track processing"""
    emit_event("status", "recording")
    
    try:
        speakers = sc.default_speaker()
        loopback = sc.get_microphone(id=str(speakers.name), include_loopback=True)
        emit_event("debug", f"Recording from: {speakers.name}")
        
        recorder = DualTrackRecorder(sample_rate=16000, language=language)
        start_time = time.time()
        
        with loopback.recorder(samplerate=16000, channels=1) as mic:
            while time.time() - start_time < duration_secs:
                # Read one frame (30ms)
                frame = mic.record(numframes=recorder.frame_size).flatten()
                
                # Process frame
                event_type, data = recorder.process_frame(frame)
                
                if event_type == "draft":
                    # Emit draft in background thread
                    threading.Thread(
                        target=transcribe_draft,
                        args=(data["audio"], language, data["draft_id"]),
                        daemon=True
                    ).start()
                
                elif event_type == "final":
                    # Emit final in background thread
                    threading.Thread(
                        target=transcribe_final,
                        args=(data["audio"], language, data["draft_id"]),
                        daemon=True
                    ).start()
        
        # Process remaining buffer
        if recorder.current_sentence_buffer:
            audio_chunk = np.concatenate(recorder.current_sentence_buffer)
            transcribe_final(audio_chunk, language, recorder.current_draft_id)
        
        emit_event("status", "idle")
    
    except Exception as e:
        emit_event("error", f"Recording error: {str(e)}")
        emit_event("status", "idle")

def main():
    if len(sys.argv) < 3:
        emit_event("error", "Usage: transcribe.py <duration_secs> <language>")
        sys.exit(1)
    
    try:
        duration = int(sys.argv[1])
        language = sys.argv[2]
        
        emit_event("debug", f"Starting Dual-Track transcription: {duration}s, lang={language}")
        record_dual_track(duration, language)
    except Exception as e:
        emit_event("error", str(e))
        sys.exit(1)

if __name__ == "__main__":
    main()
