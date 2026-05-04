"""
Build transcribe.py thành standalone exe bằng PyInstaller
Chạy: python build_transcribe.py
"""
import PyInstaller.__main__
import sys

PyInstaller.__main__.run([
    'transcribe.py',
    '--onefile',
    '--noconsole',
    '--name=transcribe',
    '--hidden-import=faster_whisper',
    '--hidden-import=soundcard',
    '--hidden-import=webrtcvad',
    '--hidden-import=scipy',
    '--hidden-import=numpy',
    '--collect-all=faster_whisper',
    '--collect-all=ctranslate2',
])

print("\n✅ Build xong! File: dist/transcribe.exe")
