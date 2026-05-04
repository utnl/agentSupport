# 🚀 Hướng dẫn Build File .EXE

## ⚡ **Quick Build (1 lệnh)**

```powershell
.\build-portable.ps1
```

**Thời gian:** ~10-15 phút  
**Kết quả:** `src-tauri\target\release\bundle\nsis\assistant-tdc_0.1.0_x64-setup.exe`

---

## 🔧 **Build từng bước (nếu script lỗi)**

### **Bước 1: Build Python script → transcribe.exe**

```powershell
cd src-tauri
python build_transcribe.py
```

**Thời gian:** ~5-8 phút  
**Kết quả:** `src-tauri\dist\transcribe.exe` (~12 MB)

**Nếu lỗi:**
- Kiểm tra: `pip show pyinstaller`
- Cài lại: `pip install --upgrade pyinstaller`

---

### **Bước 2: Copy transcribe.exe vào resources**

```powershell
Copy-Item dist\transcribe.exe transcribe.exe -Force
```

---

### **Bước 3: Build Tauri app**

```powershell
cd ..
npm install
npm run tauri build
```

**Thời gian:** ~5-7 phút  
**Kết quả:** 
- Installer: `src-tauri\target\release\bundle\nsis\assistant-tdc_0.1.0_x64-setup.exe`
- Portable: `src-tauri\target\release\assistant-tdc.exe`

---

## 📦 **Các file output**

```
src-tauri/target/release/
├── assistant-tdc.exe              # Portable EXE (~15 MB)
└── bundle/
    ├── nsis/
    │   └── assistant-tdc_0.1.0_x64-setup.exe  # Installer (~20 MB)
    └── msi/
        └── assistant-tdc_0.1.0_x64_en-US.msi  # MSI Installer
```

---

## 🧪 **Test nhanh (không cần build full)**

### **Option 1: Dev mode**

```powershell
npm run tauri dev
```

- Hot reload
- Không cần build
- Python chạy trực tiếp

### **Option 2: Build debug (nhanh hơn)**

```powershell
npm run tauri build -- --debug
```

- Không optimize
- Build nhanh (~3 phút)
- File lớn hơn (~50 MB)

---

## ⚠️ **Troubleshooting**

### **Lỗi 1: PyInstaller timeout**

```powershell
# Build thủ công với verbose
cd src-tauri
pyinstaller transcribe.spec --clean
```

### **Lỗi 2: Rust compile error**

```powershell
# Clean và rebuild
cd src-tauri
cargo clean
cd ..
npm run tauri build
```

### **Lỗi 3: Node modules lỗi**

```powershell
# Xóa và cài lại
Remove-Item node_modules -Recurse -Force
Remove-Item package-lock.json
npm install
```

---

## 🎯 **Build cho production (optimize)**

### **Bước 1: Optimize Python**

```python
# src-tauri/build_transcribe.py

PyInstaller.__main__.run([
    'transcribe.py',
    '--onefile',
    '--noconsole',
    '--name=transcribe',
    '--optimize=2',  # ← Thêm optimize
    '--strip',       # ← Remove debug symbols
    # ... rest of config
])
```

### **Bước 2: Optimize Rust**

```toml
# src-tauri/Cargo.toml

[profile.release]
opt-level = "z"     # Optimize for size
lto = true          # Link-time optimization
codegen-units = 1   # Better optimization
strip = true        # Remove debug symbols
```

### **Bước 3: Build**

```powershell
npm run tauri build -- --release
```

**Kết quả:** File nhỏ hơn ~30%

---

## 📊 **Kích thước file dự kiến**

| File | Kích thước | Ghi chú |
|------|------------|---------|
| `transcribe.exe` | ~12 MB | Python + dependencies |
| `assistant-tdc.exe` | ~15 MB | Tauri app |
| `setup.exe` (installer) | ~20 MB | Nén + installer logic |
| **Total installed** | ~30 MB | Không bao gồm Whisper models |

**Lưu ý:** Whisper models (~600 MB) sẽ tự động download lần đầu chạy.

---

## 🚀 **Phân phối cho user**

### **Option 1: Installer (Khuyến nghị)**

```
assistant-tdc_0.1.0_x64-setup.exe  (~20 MB)
```

- User double-click → cài đặt
- Tự động tạo shortcut
- Có uninstaller

### **Option 2: Portable ZIP**

```
assistant-tdc-portable.zip  (~30 MB)
├── assistant-tdc.exe
├── transcribe.exe
└── README.txt
```

- Giải nén → chạy ngay
- Không cần cài đặt
- Bỏ USB được

---

## 💡 **Tips**

1. **Build lần đầu lâu** (~15 phút) - lần sau nhanh hơn (~3 phút)
2. **Dùng SSD** - build nhanh hơn 3x
3. **Tắt antivirus** - tránh false positive
4. **Clean build** nếu lỗi lạ: `cargo clean && npm run tauri build`

---

## 📝 **Checklist trước khi phân phối**

- [ ] Test trên máy sạch (không có Python, Node)
- [ ] Test tất cả tính năng (reminder, transcribe, tray)
- [ ] Test với nhiều ngôn ngữ (EN, VI, ZH, JA, KO)
- [ ] Kiểm tra icon hiển thị đúng
- [ ] Kiểm tra notification hoạt động
- [ ] Test Stop button
- [ ] Test Copy transcript
- [ ] Scan virus (VirusTotal.com)

---

## 🎉 **Done!**

File .exe đã sẵn sàng để gửi cho user test!
