# Build Hướng Dẫn

## Yêu cầu
- Python 3.10+
- Node.js 18+
- Rust (via rustup)

## Build Portable App (1-click exe)

### 1. Cài Python dependencies
```bash
cd src-tauri
pip install -r requirements.txt
```

### 2. Build transcribe.exe
```bash
python build_transcribe.py
```
→ Tạo file `dist/transcribe.exe` (~200MB)

### 3. Copy transcribe.exe vào Tauri resources
```bash
# Windows PowerShell
Copy-Item dist\transcribe.exe ..\src-tauri\transcribe.exe

# hoặc thủ công: copy dist/transcribe.exe sang src-tauri/
```

### 4. Build Tauri app
```bash
cd ..
npm install
npm run tauri build
```

→ File exe cuối cùng ở `src-tauri/target/release/bundle/nsis/`

## Kết quả
- App portable, không cần cài Python
- User chỉ cần double-click exe là chạy
- Transcription hoạt động offline hoàn toàn
