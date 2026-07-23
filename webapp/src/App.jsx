import { useState, useEffect, useMemo } from "react";
import {
  Heart, AlertTriangle, CheckCircle2, Camera, Activity, Baby,
  ChevronRight, ArrowLeft, TrendingUp, Moon, Utensils, Stethoscope,
  ShieldAlert, ClipboardList, Users, LogOut, ExternalLink
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

/* ---------- design tokens ----------
  ink:        #14231F   near-black, green-tinted, primary text
  paper:      #F4F6F1   clinical soft white (patient bg)
  deep:       #0F2A2E   ultrasound-dark teal (provider bg / header)
  teal:       #2F6E68   primary accent
  rose:       #B5566B   warm secondary accent
  amber:      #C08A2E   "monitor" tier
  alert:      #B23A2E   "urgent" tier — reserved for real alerts only
  sage:       #4B8B6F   "normal" tier / success
------------------------------------ */

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
`;

const TODAY = new Date("2026-07-22T09:00:00");
const dayISO = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

/* ---------- clinical thresholds (from flowchart evidence basis) ---------- */
function evalBP(sys, dia) {
  if (sys >= 160 || dia >= 110) return { tier: "urgent", note: "≥160/110 — severe pre-eclampsia range, medical emergency", source: "ACOG" };
  if (sys >= 140 || dia >= 90) return { tier: "monitor", note: "≥140/90 — monitor for pre-eclampsia; confirm with repeat reading 4+ hrs apart", source: "ACOG" };
  return { tier: "normal", note: "Within expected range", source: "ACOG" };
}
function evalEPDS(score) {
  if (score >= 10) return { tier: "monitor", note: "EPDS ≥10 — positive screen for depression/anxiety risk", source: "Edinburgh Postnatal Depression Scale" };
  return { tier: "normal", note: "Below screening threshold", source: "Edinburgh Postnatal Depression Scale" };
}
function evalWound(symptoms) {
  const flags = ["redness", "discharge", "warmth", "fever"].filter((s) => symptoms.includes(s));
  if (flags.length >= 2) return { tier: "urgent", note: "Multiple wound-infection signs present", source: "Cleveland Clinic" };
  if (flags.length === 1) return { tier: "monitor", note: "One wound-infection sign present — track closely", source: "Cleveland Clinic" };
  return { tier: "normal", note: "No infection signs reported", source: "Cleveland Clinic" };
}
function evalVTE(symptoms) {
  if (symptoms.includes("chestPain")) return { tier: "urgent", note: "Chest pain reported — possible pulmonary embolism, emergency", source: "American Heart Association" };
  if (symptoms.includes("calfPain")) return { tier: "monitor", note: "Calf pain/swelling reported — monitor for DVT", source: "American Heart Association" };
  return { tier: "normal", note: "No VTE symptoms reported", source: "American Heart Association" };
}

const TIER_COLOR = { normal: "#4B8B6F", monitor: "#C08A2E", urgent: "#B23A2E" };
const TIER_LABEL = { normal: "Normal", monitor: "Monitor", urgent: "Urgent" };
function worstTier(tiers) {
  if (tiers.includes("urgent")) return "urgent";
  if (tiers.includes("monitor")) return "monitor";
  return "normal";
}

/* ---------- seed demo data ---------- */
function seedData() {
  const patients = [
    { id: "p1", name: "Maria Alvarez", phase: "pre-term", weekOrDay: 32, deliveryType: null, dueDate: dayISO(addDays(TODAY, 56)) },
    { id: "p2", name: "Jade Whitfield", phase: "post-term", weekOrDay: 6, deliveryType: "C-section", dueDate: dayISO(addDays(TODAY, -42)) },
    { id: "p3", name: "Priya Nair", phase: "pre-term", weekOrDay: 38, deliveryType: null, dueDate: dayISO(addDays(TODAY, 14)) },
    { id: "p4", name: "Sam Okafor", phase: "post-term", weekOrDay: 35, deliveryType: "Vaginal", dueDate: dayISO(addDays(TODAY, -245)) },
  ];

  const checkins = {
    p1: Array.from({ length: 8 }).map((_, i) => {
      const sys = 118 + i * 5 + (i > 5 ? 10 : 0);
      const dia = 76 + i * 2 + (i > 5 ? 6 : 0);
      return {
        date: dayISO(addDays(TODAY, -14 + i * 2)),
        bp: { sys, dia }, weight: 152 + i * 0.4, kickCount: 12 - (i > 5 ? 3 : 0),
        symptoms: i > 5 ? ["swelling", "visualDisturbance"] : [],
      };
    }),
    p2: Array.from({ length: 6 }).map((_, i) => ({
      date: dayISO(addDays(TODAY, -10 + i * 2)),
      wound: { symptoms: i >= 4 ? ["redness", "warmth"] : [] , painScale: i >= 4 ? 6 : 2 },
      vte: { symptoms: [] },
      epds: i === 5 ? { score: 12, date: dayISO(addDays(TODAY, -1)) } : null,
    })),
    p3: Array.from({ length: 5 }).map((_, i) => ({
      date: dayISO(addDays(TODAY, -8 + i * 2)),
      bp: { sys: 122 + i, dia: 78 + i }, weight: 165 + i * 0.3, kickCount: 10,
      symptoms: [],
    })),
    p4: Array.from({ length: 5 }).map((_, i) => ({
      date: dayISO(addDays(TODAY, -8 + i * 2)),
      wound: { symptoms: [], painScale: 1 },
      vte: { symptoms: i === 4 ? ["calfPain"] : [] },
      epds: i === 2 ? { score: 6, date: dayISO(addDays(TODAY, -30)) } : null,
    })),
  };
  return { patients, checkins };
}

async function loadDemoData() {
  try {
    const r = await window.storage.get("obgyn-demo-data", true);
    if (r?.value) return JSON.parse(r.value);
  } catch (e) { /* not found yet */ }
  const seeded = seedData();
  try { await window.storage.set("obgyn-demo-data", JSON.stringify(seeded), true); } catch (e) {}
  return seeded;
}
async function saveDemoData(data) {
  try { await window.storage.set("obgyn-demo-data", JSON.stringify(data), true); } catch (e) {}
}

/* ---------- gestational ruler (signature element) ---------- */
function GestationalRuler({ phase, weekOrDay, alerts = [] }) {
  // scale: week 20 -> week 42 (term gate) -> day 90 postpartum
  const totalSpan = 22 + 90; // weeks 20-42 mapped 1:1, then 90 postpartum days
  const termGatePct = (22 / totalSpan) * 100;
  let posPct;
  if (phase === "pre-term") {
    posPct = ((weekOrDay - 20) / totalSpan) * 100;
  } else {
    posPct = ((22 + weekOrDay) / totalSpan) * 100;
  }
  posPct = Math.max(2, Math.min(98, posPct));

  return (
    <div style={{ padding: "18px 4px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#5b6b64", marginBottom: 6 }}>
        <span>WK 20</span>
        <span>TERM (40wk)</span>
        <span>DAY 90 PP</span>
      </div>
      <div style={{ position: "relative", height: 10, borderRadius: 6, background: "linear-gradient(90deg, #cfe0d6 0%, #9fc7b3 55%, #e7d3b8 60%, #e7d3b8 100%)" }}>
        <div style={{ position: "absolute", left: `${termGatePct}%`, top: -4, bottom: -4, width: 2, background: "#14231F" }} />
        {alerts.map((a, idx) => (
          <div key={idx} title={a.note} style={{ position: "absolute", left: `${a.pct}%`, top: -6, width: 3, height: 22, background: TIER_COLOR[a.tier], borderRadius: 2 }} />
        ))}
        <div style={{
          position: "absolute", left: `calc(${posPct}% - 9px)`, top: -9, width: 18, height: 18,
          borderRadius: "50%", background: "#2F6E68", border: "3px solid #F4F6F1", boxShadow: "0 0 0 2px #2F6E68"
        }} />
      </div>
      <div style={{ marginTop: 10, fontFamily: "Fraunces, serif", fontSize: 15, color: "#14231F" }}>
        {phase === "pre-term" ? `Week ${weekOrDay} of pregnancy` : `Day ${weekOrDay} postpartum`}
      </div>
    </div>
  );
}

/* ---------- shared bits ---------- */
function TierBadge({ tier }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999,
      fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, color: "#fff", background: TIER_COLOR[tier]
    }}>
      {tier === "urgent" ? <AlertTriangle size={12} /> : tier === "monitor" ? <ShieldAlert size={12} /> : <CheckCircle2 size={12} />}
      {TIER_LABEL[tier]}
    </span>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 1px 3px rgba(20,35,31,0.08)", border: "1px solid #e7ece7", ...style }}>
      {children}
    </div>
  );
}

/* ---------- PATIENT VIEW ---------- */
function PatientView({ patient, checkins, onSubmitCheckin, onSwitch }) {
  const [bp, setBp] = useState({ sys: "", dia: "" });
  const [symptoms, setSymptoms] = useState([]);
  const [kick, setKick] = useState("");
  const [wound, setWound] = useState([]);
  const [pain, setPain] = useState(0);
  const [vte, setVte] = useState([]);
  const [submitted, setSubmitted] = useState(false);

  const isPostSection = patient.phase === "post-term" && patient.deliveryType === "C-section";
  const daysSince = patient.phase === "post-term" ? patient.weekOrDay : null;
  const showEPDS = daysSince && [30, 60, 180].some((d) => Math.abs(d - daysSince) <= 3);

  const bpResult = bp.sys && bp.dia ? evalBP(Number(bp.sys), Number(bp.dia)) : null;
  const woundResult = wound.length ? evalWound(wound) : null;
  const vteResult = vte.length ? evalVTE(vte) : null;

  const chartData = (checkins || []).filter((c) => c.bp).map((c) => ({
    date: fmtDate(c.date), sys: c.bp.sys, dia: c.bp.dia,
  }));

  function toggle(list, setList, key) {
    setList(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);
  }

  function submit() {
    const entry = {
      date: dayISO(TODAY),
      ...(bp.sys && bp.dia ? { bp: { sys: Number(bp.sys), dia: Number(bp.dia) } } : {}),
      ...(kick ? { kickCount: Number(kick) } : {}),
      ...(symptoms.length ? { symptoms } : {}),
      ...(isPostSection ? { wound: { symptoms: wound, painScale: pain } } : {}),
      ...(isPostSection ? { vte: { symptoms: vte } } : {}),
    };
    onSubmitCheckin(entry);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2600);
  }

  const worst = worstTier([bpResult?.tier, woundResult?.tier, vteResult?.tier].filter(Boolean));

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F1", fontFamily: "Inter, sans-serif", color: "#14231F" }}>
      <style>{FONTS}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Heart size={20} color="#B5566B" fill="#B5566B" />
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600 }}>{patient.name}</span>
          </div>
          <button onClick={onSwitch} style={{ border: "none", background: "none", color: "#5b6b64", display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
            <LogOut size={14} /> Switch view
          </button>
        </div>

        <Card style={{ marginTop: 14 }}>
          <GestationalRuler phase={patient.phase} weekOrDay={patient.weekOrDay} />
        </Card>

        {worst !== "normal" && (
          <div style={{
            marginTop: 14, padding: "12px 14px", borderRadius: 12, display: "flex", gap: 10, alignItems: "flex-start",
            background: worst === "urgent" ? "#fbeae7" : "#faf1de", border: `1px solid ${TIER_COLOR[worst]}33`
          }}>
            <AlertTriangle size={18} color={TIER_COLOR[worst]} style={{ marginTop: 1 }} />
            <div style={{ fontSize: 13.5, lineHeight: 1.4 }}>
              {worst === "urgent"
                ? "Some of what you've entered needs attention now. Please contact your care team or seek care."
                : "We're keeping an eye on a couple of things you reported. Your care team has been notified."}
            </div>
          </div>
        )}

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<Activity size={16} />} title="Blood pressure & symptoms" />
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <input placeholder="Systolic" value={bp.sys} onChange={(e) => setBp({ ...bp, sys: e.target.value })} style={inputStyle} type="number" />
            <input placeholder="Diastolic" value={bp.dia} onChange={(e) => setBp({ ...bp, dia: e.target.value })} style={inputStyle} type="number" />
          </div>
          {bpResult && <InlineNote result={bpResult} />}
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["swelling", "visualDisturbance", "suddenWeightGain", "burningUrination", "bleeding"].map((s) => (
              <Chip key={s} label={labelize(s)} active={symptoms.includes(s)} onClick={() => toggle(symptoms, setSymptoms, s)} />
            ))}
          </div>
          {patient.phase === "pre-term" && (
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Kick count (last 2 hrs)</label>
              <input value={kick} onChange={(e) => setKick(e.target.value)} type="number" style={{ ...inputStyle, width: 100 }} />
            </div>
          )}
        </Card>

        {isPostSection && (
          <Card style={{ marginTop: 14 }}>
            <SectionTitle icon={<Camera size={16} />} title="Wound & VTE check" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {["redness", "discharge", "warmth", "fever"].map((s) => (
                <Chip key={s} label={labelize(s)} active={wound.includes(s)} onClick={() => toggle(wound, setWound, s)} />
              ))}
            </div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "#eef2ee", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b6b64" }}>
                <Camera size={16} />
              </div>
              <span style={{ fontSize: 12.5, color: "#5b6b64" }}>Photo upload (simulated in this prototype — routes to provider for manual review)</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Pain scale (0–10): {pain}</label>
              <input type="range" min={0} max={10} value={pain} onChange={(e) => setPain(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {["calfPain", "chestPain"].map((s) => (
                <Chip key={s} label={labelize(s)} active={vte.includes(s)} onClick={() => toggle(vte, setVte, s)} />
              ))}
            </div>
            {woundResult && <InlineNote result={woundResult} />}
            {vteResult && <InlineNote result={vteResult} />}
          </Card>
        )}

        {showEPDS && (
          <Card style={{ marginTop: 14, borderLeft: "3px solid #B5566B" }}>
            <SectionTitle icon={<Moon size={16} />} title="Mental health check-in due" />
            <p style={{ fontSize: 13.5, color: "#3d4a44", marginTop: 8 }}>
              It's time for your Edinburgh Postnatal Depression Scale (EPDS) screening. This takes about 2 minutes.
            </p>
            <button style={primaryBtn}>Start screening</button>
          </Card>
        )}

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<Utensils size={16} />} title="Today's nutrition tip" />
          <p style={{ fontSize: 13.5, color: "#3d4a44", marginTop: 8 }}>
            {patient.phase === "post-term" && patient.deliveryType
              ? "Breastfeeding increases iron and calcium needs — aim for an extra 450–500 kcal/day from nutrient-dense sources."
              : "Folic acid, iron, calcium, iodine, and choline remain priority nutrients this trimester. Consider a short walk after meals to support blood sugar."}
          </p>
        </Card>

        {chartData.length > 1 && (
          <Card style={{ marginTop: 14 }}>
            <SectionTitle icon={<TrendingUp size={16} />} title="Your blood pressure trend" />
            <div style={{ height: 160, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="#e7ece7" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                  <YAxis tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} domain={[60, 180]} />
                  <Tooltip />
                  <ReferenceLine y={140} stroke="#C08A2E" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="sys" stroke="#2F6E68" strokeWidth={2} dot={{ r: 3 }} name="Systolic" />
                  <Line type="monotone" dataKey="dia" stroke="#B5566B" strokeWidth={2} dot={{ r: 3 }} name="Diastolic" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        <button onClick={submit} style={{ ...primaryBtn, width: "100%", marginTop: 18, padding: "13px 0", fontSize: 15 }}>
          {submitted ? "Check-in saved ✓" : "Submit today's check-in"}
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "Fraunces, serif", fontSize: 15.5, fontWeight: 600 }}>
      <span style={{ color: "#2F6E68" }}>{icon}</span>{title}
    </div>
  );
}
function InlineNote({ result }) {
  return (
    <div style={{ marginTop: 10, fontSize: 12.5, color: TIER_COLOR[result.tier], display: "flex", gap: 6, alignItems: "flex-start" }}>
      <span style={{ marginTop: 2 }}>●</span>
      <span>{result.note} <span style={{ color: "#8a9791" }}>— {result.source}</span></span>
    </div>
  );
}
function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
      border: `1px solid ${active ? "#2F6E68" : "#d8e0d9"}`, background: active ? "#2F6E68" : "#fff",
      color: active ? "#fff" : "#3d4a44", fontFamily: "Inter, sans-serif"
    }}>{label}</button>
  );
}
function labelize(s) {
  return s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
const inputStyle = { flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #d8e0d9", fontFamily: "IBM Plex Mono, monospace", fontSize: 14 };
const labelStyle = { fontSize: 12.5, color: "#5b6b64", display: "block", marginBottom: 4 };
const primaryBtn = { background: "#2F6E68", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 13.5, cursor: "pointer" };

/* ---------- PROVIDER VIEW ---------- */
function ProviderView({ patients, checkins, onSwitch }) {
  const [selected, setSelected] = useState(null);

  const rows = useMemo(() => patients.map((p) => {
    const cIns = checkins[p.id] || [];
    const latest = cIns[cIns.length - 1];
    const tiers = [];
    if (latest?.bp) tiers.push(evalBP(latest.bp.sys, latest.bp.dia).tier);
    if (latest?.wound) tiers.push(evalWound(latest.wound.symptoms).tier);
    if (latest?.vte) tiers.push(evalVTE(latest.vte.symptoms).tier);
    const epdsEntry = cIns.find((c) => c.epds)?.epds;
    if (epdsEntry) tiers.push(evalEPDS(epdsEntry.score).tier);
    return { ...p, tier: worstTier(tiers), latest, epdsEntry };
  }).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "urgent" ? -1 : b.tier === "urgent" ? 1 : a.tier === "monitor" ? -1 : 1)),
  [patients, checkins]);

  const sel = rows.find((r) => r.id === selected);

  return (
    <div style={{ minHeight: "100vh", background: "#f6f8f6", fontFamily: "Inter, sans-serif", color: "#14231F" }}>
      <style>{FONTS}</style>
      <div style={{ background: "#0F2A2E", color: "#fff", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Stethoscope size={20} />
          <span style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600 }}>Provider dashboard</span>
        </div>
        <button onClick={onSwitch} style={{ border: "none", background: "rgba(255,255,255,0.1)", color: "#fff", padding: "6px 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <LogOut size={14} /> Switch view
        </button>
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 20px 60px", display: "flex", gap: 20 }}>
        <div style={{ flex: sel ? "0 0 340px" : 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "#5b6b64", fontSize: 13 }}>
            <Users size={15} /> {rows.length} patients · {rows.filter((r) => r.tier !== "normal").length} flagged
          </div>
          {rows.map((r) => (
            <div key={r.id} onClick={() => setSelected(r.id)} style={{
              background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer",
              borderLeft: `4px solid ${TIER_COLOR[r.tier]}`, boxShadow: selected === r.id ? "0 0 0 2px #2F6E68" : "0 1px 2px rgba(20,35,31,0.06)",
              display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: "#5b6b64", marginTop: 2 }}>
                  {r.phase === "pre-term" ? `Wk ${r.weekOrDay}` : `Day ${r.weekOrDay} PP`} {r.deliveryType ? `· ${r.deliveryType}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TierBadge tier={r.tier} />
                <ChevronRight size={16} color="#a8b3ad" />
              </div>
            </div>
          ))}
        </div>

        {sel && <PatientDetail patient={sel} checkins={checkins[sel.id] || []} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function PatientDetail({ patient, checkins, onClose }) {
  const bpData = checkins.filter((c) => c.bp).map((c) => ({ date: fmtDate(c.date), sys: c.bp.sys, dia: c.bp.dia }));
  const latest = checkins[checkins.length - 1];
  const reasons = [];
  if (latest?.bp) { const r = evalBP(latest.bp.sys, latest.bp.dia); if (r.tier !== "normal") reasons.push({ label: "Blood pressure", ...r }); }
  if (latest?.wound?.symptoms?.length) { const r = evalWound(latest.wound.symptoms); if (r.tier !== "normal") reasons.push({ label: "Wound check", ...r }); }
  if (latest?.vte?.symptoms?.length) { const r = evalVTE(latest.vte.symptoms); if (r.tier !== "normal") reasons.push({ label: "VTE screen", ...r }); }
  const epds = checkins.find((c) => c.epds)?.epds;
  if (epds) { const r = evalEPDS(epds.score); if (r.tier !== "normal") reasons.push({ label: "Mental health (EPDS)", ...r, note: `Score ${epds.score} — ${r.note}` }); }

  return (
    <div style={{ flex: 1 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600 }}>{patient.name}</div>
            <div style={{ fontSize: 13, color: "#5b6b64", marginTop: 2 }}>
              {patient.phase === "pre-term" ? `Week ${patient.weekOrDay} of pregnancy` : `Day ${patient.weekOrDay} postpartum`} {patient.deliveryType ? `· ${patient.deliveryType} delivery` : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", color: "#5b6b64", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <ArrowLeft size={14} /> Close
          </button>
        </div>
        <div style={{ marginTop: 14 }}>
          <GestationalRuler phase={patient.phase} weekOrDay={patient.weekOrDay} />
        </div>
      </Card>

      {reasons.length > 0 && (
        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<ClipboardList size={16} />} title="Why this patient is flagged" />
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {reasons.map((r, i) => (
              <div key={i} style={{ padding: "10px 12px", borderRadius: 10, background: "#f9f9f7", border: `1px solid ${TIER_COLOR[r.tier]}33` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.label}</span>
                  <TierBadge tier={r.tier} />
                </div>
                <div style={{ fontSize: 12.5, color: "#3d4a44", marginTop: 4 }}>{r.note}</div>
                <div style={{ fontSize: 11.5, color: "#8a9791", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                  <ExternalLink size={11} /> Source: {r.source}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {bpData.length > 1 && (
        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<TrendingUp size={16} />} title="Blood pressure trend" />
          <div style={{ height: 180, marginTop: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={bpData}>
                <CartesianGrid stroke="#e7ece7" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                <YAxis tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} domain={[60, 180]} />
                <Tooltip />
                <ReferenceLine y={140} stroke="#C08A2E" strokeDasharray="4 4" label={{ value: "140", fontSize: 10, fill: "#C08A2E" }} />
                <ReferenceLine y={160} stroke="#B23A2E" strokeDasharray="4 4" label={{ value: "160", fontSize: 10, fill: "#B23A2E" }} />
                <Line type="monotone" dataKey="sys" stroke="#2F6E68" strokeWidth={2} dot={{ r: 3 }} name="Systolic" />
                <Line type="monotone" dataKey="dia" stroke="#B5566B" strokeWidth={2} dot={{ r: 3 }} name="Diastolic" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- LOGIN / VIEW SELECT ---------- */
function ViewSelect({ onSelect }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0F2A2E", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif" }}>
      <style>{FONTS}</style>
      <div style={{ textAlign: "center", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <Baby size={34} color="#B5566B" />
        </div>
        <div style={{ fontFamily: "Fraunces, serif", fontSize: 30, fontWeight: 500, marginBottom: 6 }}>Continuum</div>
        <div style={{ fontSize: 13.5, color: "#a9c2bb", marginBottom: 32 }}>Pre- and post-term monitoring, connected to your care team</div>
        <div style={{ display: "flex", gap: 14, justifyContent: "center" }}>
          <button onClick={() => onSelect("patient")} style={{ ...selectBtn, background: "#2F6E68" }}>
            <Heart size={16} /> I'm a patient
          </button>
          <button onClick={() => onSelect("provider")} style={{ ...selectBtn, background: "#B5566B" }}>
            <Stethoscope size={16} /> I'm a provider
          </button>
        </div>
      </div>
    </div>
  );
}
const selectBtn = { display: "flex", alignItems: "center", gap: 8, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontSize: 14.5, fontWeight: 600, cursor: "pointer", fontFamily: "Inter, sans-serif" };

/* ---------- ROOT ---------- */
export default function App() {
  const [view, setView] = useState(null);
  const [data, setData] = useState(null);
  const [activePatientId, setActivePatientId] = useState("p1");

  useEffect(() => { loadDemoData().then(setData); }, []);

  if (!data) {
    return <div style={{ minHeight: "100vh", background: "#0F2A2E", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "Inter, sans-serif" }}>Loading…</div>;
  }

  async function submitCheckin(entry) {
    const next = { ...data, checkins: { ...data.checkins, [activePatientId]: [...(data.checkins[activePatientId] || []), entry] } };
    setData(next);
    await saveDemoData(next);
  }

  if (!view) return <ViewSelect onSelect={setView} />;

  if (view === "patient") {
    const patient = data.patients.find((p) => p.id === activePatientId);
    return (
      <div>
        <div style={{ background: "#eef2ee", padding: "6px 16px", fontSize: 11.5, color: "#5b6b64", display: "flex", gap: 10, fontFamily: "Inter, sans-serif" }}>
          Demo patient:
          {data.patients.map((p) => (
            <span key={p.id} onClick={() => setActivePatientId(p.id)} style={{ cursor: "pointer", fontWeight: p.id === activePatientId ? 700 : 400, textDecoration: p.id === activePatientId ? "underline" : "none" }}>{p.name.split(" ")[0]}</span>
          ))}
        </div>
        <PatientView patient={patient} checkins={data.checkins[activePatientId]} onSubmitCheckin={submitCheckin} onSwitch={() => setView(null)} />
      </div>
    );
  }

  return <ProviderView patients={data.patients} checkins={data.checkins} onSwitch={() => setView(null)} />;
}