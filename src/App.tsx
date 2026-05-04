import { useState, useEffect, useRef } from "react";
import bananaImg from "./assets/banana.png";
import "./App.css";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("Chạy bằng 'npm run tauri dev' nhé!");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// ── Notify popup ──────────────────────────────────────────────
function NotifyView({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (isTauri) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        getCurrentWindow().close();
      }
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  async function close() {
    if (isTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      getCurrentWindow().close();
    } else setVisible(false);
  }

  if (!visible) return null;
  return (
    <div className="notify-overlay">
      <div className="notify-card">
        <img src={bananaImg} alt="Banana Cat" className="notify-avatar" />
        <div className="notify-content">
          <div className="notify-title">⏰ Banana Cat nhắc bạn!</div>
          <div className="notify-msg">{message}</div>
        </div>
        <button className="notify-close" onClick={close}>✕</button>
        <div className="notify-progress" />
      </div>
    </div>
  );
}

// ── Transcribe tab ────────────────────────────────────────────
interface TranscriptItem {
  id: string;
  text: string;
  type: "draft" | "final";
  draftId?: string;
}

function TranscribeTab({ pythonReady }: { pythonReady: boolean | null }) {
  const [isRecording, setIsRecording] = useState(false);
  const [language, setLanguage] = useState("en");
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      
      // Listen for draft transcripts (fast preview - incremental)
      const u1 = await listen<{ text: string; draft_id: string; lang: string; is_incremental?: boolean }>("transcribe-draft", (e) => {
        const { text, draft_id } = e.payload;
        setTranscript((prev) => {
          const existingIndex = prev.findIndex(t => t.draftId === draft_id && t.type === "draft");
          
          if (existingIndex >= 0) {
            // Append to existing draft
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              text: updated[existingIndex].text + " " + text
            };
            return updated;
          } else {
            // Create new draft entry
            return [...prev, { id: draft_id, text, type: "draft", draftId: draft_id }];
          }
        });
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      });
      
      // Listen for final transcripts (accurate result - replaces draft)
      const u2 = await listen<{ text: string; draft_id: string; lang: string }>("transcribe-final", (e) => {
        const { text, draft_id } = e.payload;
        setTranscript((prev) => {
          // Check if this exact text already exists as final (deduplication)
          const duplicateFinal = prev.find(t => t.type === "final" && t.text === text);
          if (duplicateFinal) {
            console.log("[Dedup] Skipping duplicate final:", text.substring(0, 50));
            return prev; // Skip duplicate
          }
          
          // Find and replace the draft with final
          const existingIndex = prev.findIndex(t => t.draftId === draft_id);
          if (existingIndex >= 0) {
            // Replace draft with final
            const updated = [...prev];
            updated[existingIndex] = { id: draft_id + "-final", text, type: "final" };
            return updated;
          } else {
            // No draft found, just add final (shouldn't happen normally)
            return [...prev, { id: draft_id + "-final", text, type: "final" }];
          }
        });
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      });
      
      const u3 = await listen<string>("transcribe-error", (e) => {
        setError(e.payload);
        setIsRecording(false);
      });
      
      const u4 = await listen<string>("transcribe-status", (e) => {
        if (e.payload === "idle") setIsRecording(false);
      });
      
      // Optional: debug events
      const u5 = await listen<string>("transcribe-debug", (e) => {
        console.log("[Transcribe Debug]", e.payload);
      });
      
      unlisten = () => { u1(); u2(); u3(); u4(); u5(); };
    })();
    return () => unlisten?.();
  }, []);

  async function handleToggle() {
    if (isRecording) {
      // Stop recording
      setIsRecording(false);
      try {
        await safeInvoke("stop_transcribe");
      } catch (e) {
        console.error("Stop error:", e);
      }
    } else {
      // Start recording (vô thời hạn, 1 giờ max)
      setError("");
      setTranscript([]);
      setIsRecording(true);
      await safeInvoke("start_transcribe", { durationSecs: 3600, language }).catch((e) => {
        setError(String(e));
        setIsRecording(false);
      });
    }
  }

  if (pythonReady === null) return <div className="t-loading">Đang kiểm tra Python...</div>;

  if (!pythonReady) return (
    <div className="t-setup">
      <div className="t-setup-icon">🐍</div>
      <div className="t-setup-title">Cần cài Python + dependencies</div>
      <div className="t-setup-desc">
        1. Cài Python 3.10+ từ <a href="https://python.org" target="_blank">python.org</a><br/>
        2. Mở terminal, chạy:<br/>
        <code>pip install faster-whisper soundcard webrtcvad scipy numpy</code>
      </div>
      <button className="action-btn" onClick={() => window.location.reload()}>
        ✅ Đã cài xong, kiểm tra lại
      </button>
      {error && <div className="t-error">{error}</div>}
    </div>
  );

  return (
    <div className="t-panel">
      <div className="t-controls">
        <div className="t-duration">
          <span>Ngôn ngữ</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={isRecording}>
            <option value="auto">Tự động</option>
            <option value="en">🇬🇧 English</option>
            <option value="vi">🇻🇳 Tiếng Việt</option>
            <option value="zh">🇨🇳 中文</option>
            <option value="ja">🇯🇵 日本語</option>
            <option value="ko">🇰🇷 한국어</option>
          </select>
        </div>
        <button
          className={`record-btn ${isRecording ? "recording" : ""}`}
          onClick={handleToggle}
        >
          {isRecording ? "⏹ Dừng" : "🎙️ Bắt đầu"}
        </button>
        {transcript.length > 0 && (
          <button className="preset-btn" onClick={() => setTranscript([])}>🗑️</button>
        )}
      </div>

      {error && <div className="t-error">{error}</div>}

      <div className="t-transcript-single">
        <div className="t-col-header">
          📝 Transcript 
          <span className="t-legend">
            <span className="t-legend-draft">⚡ Draft</span>
            <span className="t-legend-final">✓ Final</span>
          </span>
        </div>
        <div className="t-col-content">
          {transcript.map((t) => (
            <div key={t.id} className={`t-line t-line-${t.type}`}>
              {t.type === "draft" && <span className="t-badge">⚡</span>}
              {t.type === "final" && <span className="t-badge">✓</span>}
              {t.text}
            </div>
          ))}
          {transcript.length === 0 && (
            <div className="t-empty">
              Transcript sẽ hiện realtime...<br/>
              <small>⚡ Draft = preview nhanh | ✓ Final = kết quả chuẩn</small>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {transcript.length > 0 && (
        <button
          className="preset-btn copy-btn"
          onClick={() => {
            // Only copy final transcripts
            const finalTexts = transcript
              .filter(t => t.type === "final")
              .map(t => t.text)
              .join("\n\n");
            navigator.clipboard.writeText(finalTexts);
          }}
        >
          📋 Copy (chỉ Final)
        </button>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
const PRESETS = [
  { label: "5 phút", seconds: 5 * 60 },
  { label: "10 phút", seconds: 10 * 60 },
  { label: "15 phút", seconds: 15 * 60 },
  { label: "30 phút", seconds: 30 * 60 },
  { label: "1 giờ", seconds: 60 * 60 },
];

interface Reminder { id: number; message: string; fireAt: Date; }
let nextId = 1;

const IDLE_QUOTES = [
  "Bạn cần nhắc gì không? 🍌",
  "Mình đang trực 24/7 nè! 😺",
  "Đặt lịch đi, mình nhớ hộ cho!",
  "Plink plink plink... 🎹",
  "Có việc gì cứ bảo mình nhé!",
  "Ghi âm meeting đi nào! 🎙️",
];

type Tab = "schedule" | "transcribe";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("notify") === "1") {
    const msg = decodeURIComponent(params.get("msg") || "Đến giờ rồi! 🍌");
    return <NotifyView message={msg} />;
  }

  // Cache Python check globally
  const [pythonReady, setPythonReady] = useState<boolean | null>(null);
  
  useEffect(() => {
    if (pythonReady === null) {
      safeInvoke<boolean>("check_python").then(setPythonReady).catch(() => setPythonReady(false));
    }
  }, [pythonReady]);

  const [tab, setTab] = useState<Tab>("schedule");
  const [message, setMessage] = useState("");
  const [customMinutes, setCustomMinutes] = useState("");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [bubble, setBubble] = useState(IDLE_QUOTES[0]);
  const [showScheduler, setShowScheduler] = useState(false);

  function randomQuote() {
    setBubble(IDLE_QUOTES[Math.floor(Math.random() * IDLE_QUOTES.length)]);
  }

  async function scheduleReminder(delaySeconds: number) {
    const msg = message.trim() || "Đến giờ rồi! 🍌";
    try {
      await safeInvoke("schedule_reminder", { delaySeconds, message: msg });
      const fireAt = new Date(Date.now() + delaySeconds * 1000);
      setReminders((prev) => [{ id: nextId++, message: msg, fireAt }, ...prev]);
      setBubble(`✅ Nhắc lúc ${fireAt.toLocaleTimeString("vi-VN")} nha!`);
      setShowScheduler(false);
      setMessage("");
    } catch (e) { setBubble(`❌ ${e}`); }
  }

  function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mins = parseFloat(customMinutes);
    if (isNaN(mins) || mins <= 0) { setBubble("⚠️ Nhập số phút hợp lệ nha!"); return; }
    scheduleReminder(Math.round(mins * 60));
    setCustomMinutes("");
  }

  return (
    <div className="app">
      {/* Header */}
      <div className="character-row">
        <img src={bananaImg} alt="Banana Cat" className="banana-cat" onClick={randomQuote} title="Click mình nè!" />
        <div className="speech-bubble"><span>{bubble}</span></div>
        <button className="close-main-btn" onClick={async () => {
          if (isTauri) {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            getCurrentWindow().hide();
          }
        }}>✕</button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab-btn ${tab === "schedule" ? "active" : ""}`} onClick={() => setTab("schedule")}>
          ⏰ Lịch nhắc
        </button>
        <button className={`tab-btn ${tab === "transcribe" ? "active" : ""}`} onClick={() => setTab("transcribe")}>
          🎙️ Ghi âm
        </button>
      </div>

      {/* Tab content */}
      {tab === "schedule" && (
        <>
          <div className="quick-actions">
            <button className={`action-btn ${showScheduler ? "active" : ""}`} onClick={() => setShowScheduler((v) => !v)}>
              ⏰ Đặt lịch
            </button>
          </div>
          {showScheduler && (
            <div className="scheduler">
              <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Nhắc tôi..." />
              <div className="presets">
                {PRESETS.map((p) => (
                  <button key={p.label} className="preset-btn" onClick={() => scheduleReminder(p.seconds)}>{p.label}</button>
                ))}
              </div>
              <form className="custom-row" onSubmit={handleCustomSubmit}>
                <input type="number" min="1" step="any" value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} placeholder="Số phút..." />
                <button type="submit" className="preset-btn">Đặt</button>
              </form>
            </div>
          )}
          {reminders.length > 0 && (
            <ul className="reminder-list">
              {reminders.map((r) => (
                <li key={r.id}>
                  <span className="rt">{r.fireAt.toLocaleTimeString("vi-VN")}</span>
                  <span className="rm">{r.message}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "transcribe" && <TranscribeTab pythonReady={pythonReady} />}
    </div>
  );
}
