import { useCallback, useEffect, useState } from "react";
import { apiJson, authHeaders } from "../api";
import type { MusicJob } from "../types";

interface MusicTabProps {
  onStatus: (msg: string) => void;
}

const STYLE_PRESETS = [
  "upbeat synthwave, warm analog pads, punchy electronic drums, 118 BPM",
  "lo-fi chillhop, dusty Rhodes piano, soft vinyl crackle, 82 BPM",
  "acoustic indie folk, fingerpicked guitar, warm intimate male vocal, 95 BPM",
  "cinematic orchestral ambient, sweeping strings, deep sub bass, 70 BPM",
];

export function MusicTab({ onStatus }: MusicTabProps) {
  const [style, setStyle] = useState(STYLE_PRESETS[0]);
  const [lyrics, setLyrics] = useState("[Verse]\nNeon lights reflect across the midnight rain\n\n[Chorus]\nDriving through the quiet city lane");
  const [cot, setCot] = useState<"full" | "melody" | "off">("full");
  const [seed, setSeed] = useState("");
  const [jobs, setJobs] = useState<MusicJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [scores, setScores] = useState<Record<string, string>>({});

  const loadJobs = useCallback(async () => {
    const res = await apiJson<{ jobs?: MusicJob[] }>("/api/music/jobs?limit=20");
    if (res.ok && res.data.jobs) {
      setJobs(res.data.jobs);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    const timer = setInterval(loadJobs, 4000);
    return () => clearInterval(timer);
  }, [loadJobs]);

  const handleGenerate = async () => {
    if (!style.trim()) {
      onStatus("Enter a style description first.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { style: style.trim(), lyrics, cot };
      if (seed.trim() && !Number.isNaN(Number(seed))) {
        payload.seed = Number(seed);
      }
      const res = await apiJson<MusicJob>("/api/music/jobs", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onStatus(`Queued YuE2 music job ${res.data.id}. Local GPU LLM will pause automatically during generation.`);
        loadJobs();
      } else {
        onStatus(`YuE2 submit failed (${res.status}): ${res.data.error || "Check yue2-gateway"}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleScore = async (jobId: string) => {
    if (scores[jobId]) {
      setScores((prev) => {
        const copy = { ...prev };
        delete copy[jobId];
        return copy;
      });
      return;
    }
    const r = await fetch(`/api/music/jobs/${encodeURIComponent(jobId)}/score`);
    if (r.ok) {
      const txt = await r.text();
      setScores((prev) => ({ ...prev, [jobId]: txt }));
    }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px", maxWidth: 1180, width: "100%", margin: "0 auto" }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>YuE2 Music Studio</div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
          Generate full local songs via yue2-gateway (:8021). Automatically unloads llama-cpp over HTTP to protect 8 GB VRAM.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 18, alignItems: "start" }}>
        {/* Generator Form */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="section-title">Compose New Track</div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {STYLE_PRESETS.map((p, idx) => (
              <button key={idx} className="btn btn-sm" onClick={() => setStyle(p)}>
                Preset {idx + 1}
              </button>
            ))}
          </div>

          <label className="field-label">
            Style, Genre &amp; Instruments
            <textarea className="textarea" rows={2} value={style} onChange={(e) => setStyle(e.target.value)} />
          </label>

          <label className="field-label">
            Lyrics (use [Verse], [Chorus], [Bridge] tags)
            <textarea className="textarea" rows={6} value={lyrics} onChange={(e) => setLyrics(e.target.value)} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label className="field-label">
              Planning Route (CoT)
              <select className="select" value={cot} onChange={(e) => setCot(e.target.value as "full" | "melody" | "off")}>
                <option value="full">full (best quality)</option>
                <option value="melody">melody</option>
                <option value="off">off (fastest)</option>
              </select>
            </label>
            <label className="field-label">
              Seed (optional)
              <input className="input" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="random" />
            </label>
          </div>

          <button className="btn btn-emerald" disabled={submitting} onClick={handleGenerate}>
            {submitting ? "Submitting..." : "Generate Track"}
          </button>
        </div>

        {/* Job History & Player */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="section-title">Generated Tracks ({jobs.length})</span>
            <button className="btn btn-sm" onClick={loadJobs}>Refresh</button>
          </div>

          {jobs.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "18px 0" }}>
              No YuE2 jobs yet. Fill in style and lyrics on the left and click Generate Track.
            </div>
          ) : (
            jobs.map((j) => (
              <div
                key={j.id}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--bg-canvas)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{j.request?.style?.slice(0, 60) || j.id}</span>
                  <span
                    className={`pill ${
                      j.status === "succeeded"
                        ? "pill-ok"
                        : j.status === "failed"
                          ? "pill-err"
                          : "pill-warn"
                    }`}
                  >
                    {j.status}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  ID: {j.id.slice(0, 12)} {j.request?.seed ? `· seed ${j.request.seed}` : ""}
                </div>
                {j.error && <div style={{ fontSize: 11.5, color: "#fca5a5" }}>{j.error}</div>}
                {j.artifacts?.audio && (
                  <audio controls style={{ width: "100%", height: 34 }} src={`/api/music/jobs/${encodeURIComponent(j.id)}/audio`} />
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  {j.artifacts?.audio && (
                    <a
                      className="btn btn-sm"
                      href={`/api/music/jobs/${encodeURIComponent(j.id)}/audio`}
                      download={`${j.id}.${j.artifacts.audio.format || "flac"}`}
                      style={{ textDecoration: "none" }}
                    >
                      Download Audio
                    </a>
                  )}
                  {j.artifacts?.score && (
                    <button className="btn btn-sm" onClick={() => toggleScore(j.id)}>
                      {scores[j.id] ? "Hide ABC Score" : "View ABC Score"}
                    </button>
                  )}
                </div>
                {scores[j.id] && <pre className="mono-pre" style={{ maxHeight: 160, overflowY: "auto" }}>{scores[j.id]}</pre>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
