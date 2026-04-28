"""
Transcription + Translation Backend for Assistant TDC
Uses faster-whisper for transcription and Google Translate for translation
"""

import json
import sys
import threading
from faster_whisper import WhisperModel
from googletrans import Translator
import numpy as np

# Global model - load once
model = None
translator = None
model_loaded = False

def load_model(size="base", device="cpu"):
    """Load faster-whisper model"""
    global model, translator, model_loaded
    
    try:
        print(f"Loading {size} model on {device}...", file=sys.stderr)
        # base = 74MB, small = 244MB, medium = 769MB
        compute_type = "int8" if device == "cpu" else "float16"
        model = WhisperModel(size, device=device, compute_type=compute_type)
        translator = Translator()
        model_loaded = True
        print("Model loaded successfully!", file=sys.stderr)
        return True
    except Exception as e:
        print(f"Error loading model: {e}", file=sys.stderr)
        return False

def translate_text(text, dest="vi"):
    """Translate text to target language"""
    if not translator or not text:
        return text
    
    try:
        result = translator.translate(text, dest=dest)
        return result.text if result else text
    except Exception as e:
        print(f"Translation error: {e}", file=sys.stderr)
        return text

def transcribe_audio(audio_path, translate_to_vi=True, callback=None):
    """
    Transcribe audio file with optional translation
    
    Args:
        audio_path: Path to audio file
        translate_to_vi: Whether to translate to Vietnamese
        callback: Function to call with each segment
    
    Returns:
        List of transcribed segments with optional translation
    """
    global model
    
    if not model_loaded:
        if not load_model():
            return [{"error": "Failed to load model"}]
    
    try:
        segments, info = model.transcribe(
            audio_path,
            language="en",  # Assume English for meeting/video
            beam_size=5,
            vad_filter=True
        )
        
        results = []
        print(f"Transcribing: {info.language} ({info.language_probability:.2f})", file=sys.stderr)
        
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            
            result = {
                "start": segment.start,
                "end": segment.end,
                "text": text,
            }
            
            # Translate if requested
            if translate_to_vi:
                result["text_vi"] = translate_text(text, "vi")
            
            results.append(result)
            
            # Callback for realtime display
            if callback:
                callback(result)
        
        return results
    
    except Exception as e:
        print(f"Transcription error: {e}", file=sys.stderr)
        return [{"error": str(e)}]

def transcribe_stream(audio_data, translate_to_vi=True):
    """
    Transcribe streaming audio data
    For realtime transcription
    """
    global model
    
    if not model_loaded:
        if not load_model():
            return {"error": "Failed to load model"}
    
    try:
        # For streaming, we'd need to accumulate audio chunks
        # This is a simplified version
        segments, info = model.transcribe(
            audio_data,
            language="en",
            beam_size=5
        )
        
        results = []
        for segment in segments:
            text = segment.text.strip()
            if text:
                result = {
                    "text": text,
                    "start": segment.start,
                    "end": segment.end,
                }
                if translate_to_vi:
                    result["text_vi"] = translate_text(text, "vi")
                results.append(result)
        
        return results
    
    except Exception as e:
        return {"error": str(e)}

# CLI interface
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Transcribe audio with translation")
    parser.add_argument("audio_file", help="Path to audio file")
    parser.add_argument("--size", default="base", choices=["tiny", "base", "small", "medium", "large"], help="Model size")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="Device to use")
    parser.add_argument("--no-translate", action="store_true", help="Disable translation")
    
    args = parser.parse_args()
    
    # Load model
    if not load_model(args.size, args.device):
        print(json.dumps({"error": "Failed to load model"}))
        sys.exit(1)
    
    # Transcribe
    results = transcribe_audio(
        args.audio_file, 
        translate_to_vi=not args.no_translate
    )
    
    # Output as JSON
    print(json.dumps(results, ensure_ascii=False, indent=2))