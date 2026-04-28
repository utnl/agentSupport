# Build portable app (1-click exe)
Write-Host "🔨 Building Banana Cat Assistant (Portable)" -ForegroundColor Yellow

# 1. Check Python
Write-Host "`n📦 Checking Python..." -ForegroundColor Cyan
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Python not found! Install from https://python.org" -ForegroundColor Red
    exit 1
}

# 2. Install Python deps
Write-Host "`n📦 Installing Python dependencies..." -ForegroundColor Cyan
Set-Location src-tauri
python -m pip install -r requirements.txt --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to install Python deps" -ForegroundColor Red
    exit 1
}

# 3. Build transcribe.exe
Write-Host "`n🐍 Building transcribe.exe..." -ForegroundColor Cyan
python build_transcribe.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to build transcribe.exe" -ForegroundColor Red
    exit 1
}

# 4. Copy exe to resources
Write-Host "`n📋 Copying transcribe.exe..." -ForegroundColor Cyan
Copy-Item dist\transcribe.exe transcribe.exe -Force

# 5. Build Tauri app
Write-Host "`n🦀 Building Tauri app..." -ForegroundColor Cyan
Set-Location ..
npm install
npm run tauri build

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Build thành công!" -ForegroundColor Green
    Write-Host "📦 File exe: src-tauri\target\release\bundle\nsis\" -ForegroundColor Green
} else {
    Write-Host "`n❌ Build failed" -ForegroundColor Red
    exit 1
}
