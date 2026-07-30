import { useState, useEffect, useMemo, useRef } from "react";
import {
  Heart, AlertTriangle, CheckCircle2, Camera, Activity, Baby,
  ChevronRight, ArrowLeft, TrendingUp, Moon, Utensils, Stethoscope,
  ShieldAlert, ClipboardList, Users, LogOut, ExternalLink,
  Info, BookOpen, MessageCircle, Send, HelpCircle, Dumbbell, Milk, Lock, FileText
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";
import { ACOG_CONTENT } from "../shared/acogContent.js";

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
.info-tip { position: relative; display: inline-flex; vertical-align: middle; cursor: help; }
.info-tip .tip-bubble {
  display: none; position: absolute; z-index: 30; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%);
  width: 240px; background: #14231F; color: #F4F6F1; font-family: Inter, sans-serif; font-weight: 400;
  font-size: 12px; line-height: 1.45; padding: 9px 11px; border-radius: 8px; box-shadow: 0 4px 14px rgba(20,35,31,0.25);
  text-transform: none; letter-spacing: normal;
}
.info-tip .tip-bubble::after {
  content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: #14231F;
}
.info-tip:hover .tip-bubble, .info-tip:focus .tip-bubble { display: block; }
`;

function InfoTip({ text }) {
  return (
    <span className="info-tip" tabIndex={0} aria-label={text}>
      <Info size={13} color="#8a9791" />
      <span className="tip-bubble">{text}</span>
    </span>
  );
}

const TODAY = new Date("2026-07-22T09:00:00");
const dayISO = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtClock = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/* ---------- clinical thresholds (from flowchart evidence basis) ----------
   Every result carries a `note` (patient-facing, plain language) and a
   `providerNote` (clinical language, includes the specific recommended
   action) — the flowchart specifies these as separate output columns.
------------------------------------------------------------------------- */
function evalBP(sys, dia, opts = {}) {
  const { weekOrDay, phase } = opts;
  const chronicNote = phase === "pre-term" && weekOrDay != null && weekOrDay < 20
    ? " Elevated before 20 weeks gestation — may reflect chronic (pre-existing) hypertension rather than gestational hypertension; consider BP medication management."
    : "";
  if (sys >= 160 || dia >= 110) {
    return {
      tier: "urgent",
      note: "≥160/110 — severe pre-eclampsia range, medical emergency. Please seek care now.",
      providerNote: `≥160/110 — severe pre-eclampsia range, medical emergency.${chronicNote}`,
      source: "ACOG",
    };
  }
  if (sys >= 140 || dia >= 90) {
    return {
      tier: "monitor",
      note: "≥140/90 — monitor for pre-eclampsia; confirm with a repeat reading 4+ hours apart.",
      providerNote: `≥140/90 — monitor for pre-eclampsia; confirm with repeat reading 4+ hrs apart. Consider ordering weekly pre-eclampsia labs (CHAP panel).${chronicNote}`,
      source: "ACOG",
    };
  }
  return { tier: "normal", note: "Within expected range", providerNote: "Within expected range", source: "ACOG" };
}

/* ---------- symptoms layered on top of raw BP ----------
   Product decision: a single symptom alone does not escalate a clearly
   normal BP reading. It takes 2+ symptoms, or 1 symptom plus a borderline
   reading (sys 130-139 or dia 85-89), to flag for review — meant to catch
   atypical/normotensive pre-eclampsia without over-alerting on one symptom.
------------------------------------------------------------------------- */
const PREECLAMPSIA_SYMPTOMS = ["swelling", "visualDisturbance", "suddenWeightGain"];
function evalPreeclampsia(bp, symptoms, bpOpts) {
  const relevant = PREECLAMPSIA_SYMPTOMS.filter((s) => symptoms.includes(s));
  if (bp) {
    const bpResult = evalBP(bp.sys, bp.dia, bpOpts);
    if (bpResult.tier !== "normal") return bpResult;
    const borderline = bp.sys >= 130 || bp.dia >= 85;
    if (relevant.length >= 2 || (relevant.length === 1 && borderline)) {
      return {
        tier: "monitor",
        note: `${relevant.map(labelize).join(", ")} reported with BP ${bp.sys}/${bp.dia} — flagged for review even though BP is subthreshold.`,
        providerNote: `Symptom(s) ${relevant.map(labelize).join(", ")} + borderline BP ${bp.sys}/${bp.dia} — possible atypical/normotensive pre-eclampsia per ACOG; recommend follow-up.`,
        source: "ACOG",
      };
    }
    return bpResult;
  }
  if (relevant.length >= 2) {
    return {
      tier: "monitor",
      note: `${relevant.map(labelize).join(", ")} reported — flagged for review (no BP entered this check-in).`,
      providerNote: `Multiple pre-eclampsia symptoms (${relevant.map(labelize).join(", ")}) reported without a BP reading — recommend BP check and follow-up.`,
      source: "ACOG",
    };
  }
  return null;
}

/* ---------- fetal movement (kick count) ----------
   <10 movements in 2 hours is the standard threshold for immediate
   evaluation (Count the Kicks / ACOG fetal-movement guidance).
------------------------------------------------------------------------- */
function evalKickCount(count) {
  if (count === "" || count === null || count === undefined) return null;
  const n = Number(count);
  if (n < 10) {
    return {
      tier: "urgent",
      note: "Fewer than 10 movements in 2 hours — please contact your care team or seek care now.",
      providerNote: "Kick count <10 in 2 hrs — recommend immediate evaluation (NST/BPP) per standard fetal movement guidance.",
      source: "Count the Kicks / ACOG",
    };
  }
  return { tier: "normal", note: `${n} movements in 2 hrs — within expected range`, providerNote: `${n} movements in 2 hrs — within expected range`, source: "Count the Kicks / ACOG" };
}

/* ---------- BP trend across recent readings ----------
   Flags a rising trend even when every individual reading is subthreshold.
   Window/threshold are a reasonable default (last up to 4 readings,
   >=15 systolic or >=10 diastolic rise) — adjust if your team has a
   different rule of thumb.
------------------------------------------------------------------------- */
function evalBPTrend(bpHistory) {
  if (!bpHistory || bpHistory.length < 3) return null;
  const recent = bpHistory.slice(-4);
  const first = recent[0], last = recent[recent.length - 1];
  const sysDelta = last.sys - first.sys;
  const diaDelta = last.dia - first.dia;
  if (sysDelta < 15 && diaDelta < 10) return null;
  if (evalBP(last.sys, last.dia).tier !== "normal") return null; // already flagged by the reading itself
  return {
    tier: "monitor",
    note: `Your blood pressure has been trending upward over your last ${recent.length} readings (${first.sys}/${first.dia} → ${last.sys}/${last.dia}). Your care team has been notified.`,
    providerNote: `BP trending upward over last ${recent.length} readings (${first.sys}/${first.dia} → ${last.sys}/${last.dia}) though individually subthreshold — flagged per rising-trend criterion.`,
    source: "ACOG",
  };
}

function evalEPDS(score, anxietyScore = 0, selfHarm = false) {
  if (selfHarm) {
    return {
      tier: "urgent",
      note: "Thank you for sharing that. Please reach out to your care team right away, or call/text 988 if you need to talk to someone now.",
      providerNote: "Item 10 endorsed — thoughts of self-harm reported; alert for immediate psych consult.",
      source: "Edinburgh Postnatal Depression Scale",
    };
  }
  if (score >= 10) {
    return {
      tier: "monitor",
      note: `Your responses suggest you may be experiencing some depression${anxietyScore >= 6 ? " and anxiety" : ""} symptoms. Your care team has been notified.`,
      providerNote: `EPDS ${score}/30 — positive screen for depression${anxietyScore >= 6 ? " and anxiety" : ""}; alert for psych consult/PCP follow-up.`,
      source: "Edinburgh Postnatal Depression Scale",
    };
  }
  if (anxietyScore >= 6) {
    return {
      tier: "monitor",
      note: "Your responses suggest some anxiety symptoms. Your care team has been notified.",
      providerNote: `Anxiety subscale ${anxietyScore}/9 elevated (items 3–5); alert for psych consult/PCP follow-up.`,
      source: "Edinburgh Postnatal Depression Scale",
    };
  }
  return { tier: "normal", note: "Below screening threshold", providerNote: "Below screening threshold", source: "Edinburgh Postnatal Depression Scale" };
}
function daysBetween(aISO, bISO) {
  return Math.abs((new Date(aISO) - new Date(bISO)) / 86400000);
}
function evalWound(symptoms, pain, prevPain) {
  const flags = ["redness", "discharge", "warmth", "fever"].filter((s) => symptoms.includes(s));
  let tier = flags.length >= 2 ? "urgent" : flags.length === 1 ? "monitor" : "normal";
  const increasing = pain != null && prevPain != null && pain - prevPain >= 2;
  const highPain = pain != null && pain >= 7;
  if ((increasing || highPain) && tier === "normal") tier = "monitor";

  const bits = [];
  if (flags.length >= 2) bits.push("Multiple wound-infection signs present");
  else if (flags.length === 1) bits.push("One wound-infection sign present — track closely");
  else bits.push("No infection signs reported");
  if (increasing) bits.push(`pain has increased from ${prevPain} to ${pain} since your last check-in`);
  else if (highPain) bits.push(`pain scale is high (${pain}/10)`);

  return {
    tier,
    note: bits.join("; "),
    providerNote: tier === "normal" ? bits.join("; ") : `${bits.join("; ")}. Review uploaded wound photo (if provided) for infection signs.`,
    source: "Cleveland Clinic",
  };
}
function evalVTE(symptoms) {
  if (symptoms.includes("chestPain")) {
    return {
      tier: "urgent",
      note: "Chest pain reported — this can indicate a blood clot in the lungs. Please seek emergency care now.",
      providerNote: "Chest pain reported — possible pulmonary embolism; emergency, do not delay evaluation.",
      source: "American Heart Association",
    };
  }
  if (symptoms.includes("calfPain")) {
    return {
      tier: "monitor",
      note: "Calf pain/swelling reported — your care team has been notified to monitor for a blood clot (DVT).",
      providerNote: "Calf pain/swelling reported — monitor for DVT; recommend ordering a venous Doppler ultrasound.",
      source: "American Heart Association",
    };
  }
  return { tier: "normal", note: "No VTE symptoms reported", providerNote: "No VTE symptoms reported", source: "American Heart Association" };
}

/* ---------- postpartum symptom monitoring: bleeding, burning urination ---------- */
function evalPostpartumSymptoms(symptoms) {
  const notes = [];
  const providerNotes = [];
  if (symptoms.includes("bleeding")) {
    notes.push("Report any increase in bleeding, or soaking a pad within an hour, to your care team right away.");
    providerNotes.push("Patient reports vaginal bleeding — assess for postpartum hemorrhage (pad saturation, clots, vitals).");
  }
  if (symptoms.includes("burningUrination")) {
    notes.push("Burning with urination can indicate a urinary tract infection — your care team has been notified.");
    providerNotes.push("Burning urination reported — possible UTI; consider urinalysis/urine culture.");
  }
  if (!notes.length) {
    return { tier: "normal", note: "No bleeding or urinary symptoms reported", providerNote: "No bleeding or urinary symptoms reported", source: "Cleveland Clinic" };
  }
  return { tier: "monitor", note: notes.join(" "), providerNote: providerNotes.join(" "), source: "Cleveland Clinic" };
}

/* ---------- BP check-in cadence: postpartum days 3-10 -> 2x/day, days 11-24 -> 1x/day ---------- */
function bpCadencePhase(daysSincePostpartum) {
  if (daysSincePostpartum == null) return null;
  if (daysSincePostpartum >= 3 && daysSincePostpartum <= 10) return { required: 2, label: "twice daily (postpartum day 3–10)" };
  if (daysSincePostpartum > 10 && daysSincePostpartum <= 24) return { required: 1, label: "once daily (postpartum day 11–24)" };
  return null;
}

/* ---------- nutrition (data points: supplements, restrictions, breastfeeding, anemia, current diet) ---------- */
const ACOG_NUTRITION_URL = "https://www.acog.org/womens-health/faqs/healthy-eating-during-pregnancy";
const SUPPLEMENT_OPTIONS = ["Prenatal vitamin", "Folic acid", "Iron", "Calcium", "Vitamin D", "DHA/Omega-3", "Iodine"];
const DIET_RESTRICTION_OPTIONS = ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "Low-sodium", "Diabetic diet"];

function evalNutrition(current, previous) {
  if (!current) return null;
  const dietChanged = !!previous && (
    (current.dietDescription || "").trim() !== (previous.dietDescription || "").trim() ||
    JSON.stringify([...(current.dietRestrictions || [])].sort()) !== JSON.stringify([...(previous.dietRestrictions || [])].sort())
  );
  if (dietChanged) {
    return { tier: "monitor", note: "Diet has changed since last check-in — flagged for care team review", providerNote: "Diet has changed since last check-in — flagged for care team review", source: "ACOG Guidelines for Healthy Eating", url: ACOG_NUTRITION_URL };
  }
  return { tier: "normal", note: "No diet changes since last check-in", providerNote: "No diet changes since last check-in", source: "ACOG Guidelines for Healthy Eating", url: ACOG_NUTRITION_URL };
}

function nutritionRecommendations(nutrition, patient) {
  const recs = [];
  const restrictions = nutrition.dietRestrictions || [];
  if (patient.phase === "post-term" && nutrition.breastfeeding) {
    recs.push("Breastfeeding increases iron and calcium needs — aim for an extra 450–500 kcal/day from nutrient-dense sources.");
  }
  if (nutrition.anemia) {
    recs.push("Anemia reported — prioritize iron-rich foods (lean red meat, lentils, spinach) paired with vitamin C for absorption.");
  }
  if (restrictions.includes("Vegetarian") || restrictions.includes("Vegan")) {
    recs.push("Plant-based diet — watch B12, iron, choline, and omega-3 intake; fortified foods or supplements can help close the gap.");
  }
  if (!recs.length) {
    recs.push("Folic acid, iron, calcium, iodine, and choline remain priority nutrients this trimester.");
  }
  return recs;
}

function supplementReminders(nutrition, patient) {
  const supplements = nutrition.supplements || [];
  const reminders = [];
  if (!supplements.includes("Prenatal vitamin")) reminders.push("Prenatal vitamin — covers folic acid, iodine, and choline");
  if (nutrition.anemia && !supplements.includes("Iron")) reminders.push("Iron supplement — recommended given reported anemia");
  if (patient.phase === "post-term" && nutrition.breastfeeding && !supplements.includes("Calcium")) reminders.push("Calcium supplement — recommended while breastfeeding");
  return reminders;
}

/* ---------- LLM-assisted nutrition review ----------
   evalNutrition() (above) is a deterministic keyword/diff check — cheap,
   always available, but "did the wording change" isn't the same as "is
   this actually concerning." The API route asks Claude to read the diet
   description and judge clinical relevance. Once the AI has weighed in,
   its tier is authoritative — it replaces the keyword check rather than
   being combined with it, since a harmless wording change shouldn't keep
   a diet flagged just because the diff-check caught it. The keyword
   check only drives the tier before the AI has reviewed this diet (not
   yet asked, or the call failed) — a starting signal, not a veto.
------------------------------------------------------------------------- */
async function evalNutritionAI({ current, previous, patient }) {
  try {
    const res = await fetch("/api/evaluate-nutrition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dietDescription: current.dietDescription || "",
        previousDietDescription: previous?.dietDescription || "",
        dietRestrictions: current.dietRestrictions || [],
        supplements: current.supplements || [],
        anemia: !!current.anemia,
        breastfeeding: !!current.breastfeeding,
        phase: patient.phase,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || !data.tier) {
      console.error("Nutrition AI review failed:", res.status, data.error || data);
      return null;
    }
    return { tier: data.tier, note: data.note, providerNote: data.providerNote, source: "AI diet review (Claude)" };
  } catch (err) {
    console.error("Nutrition AI review request failed:", err);
    return null;
  }
}

function mergeNutritionAssessment(keywordResult, aiResult) {
  return aiResult || keywordResult;
}

/* ---------- EPDS (Edinburgh Postnatal Depression Scale, 10 items) ----------
   Scoring: total >=10 is a positive screen. Items 3/4/5 form the anxiety
   subscale (EPDS-3A); >=6 flags anxiety even when the total is <10.
   Item 10 (self-harm ideation) is a standalone safety flag regardless of total.
   Source: https://perinatology.com/calculators/Edinburgh%20Depression%20Scale.htm
------------------------------------------------------------------------- */
const EPDS_QUESTIONS = [
  { text: "I have been able to laugh and see the funny side of things", options: ["As much as I always could", "Not quite so much now", "Definitely not so much now", "Not at all"] },
  { text: "I have looked forward with enjoyment to things", options: ["As much as I ever did", "Rather less than I used to", "Definitely less than I used to", "Hardly at all"] },
  { text: "I have blamed myself unnecessarily when things went wrong", anxiety: true, options: ["No, never", "Not very often", "Yes, some of the time", "Yes, most of the time"] },
  { text: "I have been anxious or worried for no good reason", anxiety: true, options: ["No, not at all", "Hardly ever", "Yes, sometimes", "Yes, very often"] },
  { text: "I have felt scared or panicky for no very good reason", anxiety: true, options: ["No, not at all", "No, not much", "Yes, sometimes", "Yes, quite a lot"] },
  { text: "Things have been getting on top of me", options: ["No, I have been coping as well as ever", "No, most of the time I have coped quite well", "Yes, sometimes I haven't been coping as well as usual", "Yes, most of the time I haven't been able to cope at all"] },
  { text: "I have been so unhappy that I have had difficulty sleeping", options: ["No, not at all", "Not very often", "Yes, sometimes", "Yes, most of the time"] },
  { text: "I have felt sad or miserable", options: ["No, not at all", "Not very often", "Yes, quite often", "Yes, most of the time"] },
  { text: "I have been so unhappy that I have been crying", options: ["No, never", "Only occasionally", "Yes, quite often", "Yes, most of the time"] },
  { text: "The thought of harming myself has occurred to me", selfHarm: true, options: ["Never", "Hardly ever", "Sometimes", "Yes, quite often"] },
];
const MINDFULNESS_TIPS = [
  "Try a short breathing exercise: in for 4 counts, hold for 4, out for 6.",
  "Step outside for a few minutes of daylight and fresh air today.",
  "Grounding exercise: name 5 things you see, 4 you hear, 3 you can touch.",
  "It's okay to ask someone to hold the baby so you can rest for 10 minutes.",
  "Write down one small thing that felt okay today.",
];

const TIER_COLOR = { normal: "#4B8B6F", monitor: "#C08A2E", urgent: "#B23A2E" };
const TIER_LABEL = { normal: "Normal", monitor: "Monitor", urgent: "Urgent" };
const TIER_EXPLANATION = {
  normal: "Normal: what you reported is within the expected range. No action needed — keep up with your regular check-in schedule.",
  monitor: "Monitor: something you reported is outside the usual range but isn't an emergency. Your care team has been notified and will follow up; keep watching for changes and contact them sooner if things get worse.",
  urgent: "Urgent: this needs attention now. Contact your care team right away, or go to urgent/emergency care if you can't reach them.",
};
function worstTier(tiers) {
  if (tiers.includes("urgent")) return "urgent";
  if (tiers.includes("monitor")) return "monitor";
  return "normal";
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
          position: "absolute", left: `calc(${posPct}% - 9px)`, top: -4, width: 18, height: 18,
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
    <span title={TIER_EXPLANATION[tier]} style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999,
      fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, color: "#fff", background: TIER_COLOR[tier], cursor: "help"
    }}>
      {tier === "urgent" ? <AlertTriangle size={12} /> : tier === "monitor" ? <ShieldAlert size={12} /> : <CheckCircle2 size={12} />}
      {TIER_LABEL[tier]}
    </span>
  );
}

/* ---------- past medical history flag, surfaced on the dashboard list ----------
   Distinct from TierBadge: these are static background risk factors (not
   tied to today's check-in), so they get their own muted styling and a
   clinical-rationale tooltip rather than the tier color scale.
------------------------------------------------------------------------- */
function PmhBadge({ label, tooltip }) {
  return (
    <span title={tooltip} style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999,
      fontFamily: "Inter, sans-serif", fontSize: 11, fontWeight: 600, color: "#B5566B", background: "#B5566B1a", cursor: "help"
    }}>
      <ShieldAlert size={10} /> {label}
    </span>
  );
}

/* ---------- always-visible explainer for what each tier means/expects ---------- */
function TierLegend() {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ marginTop: 14 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#3d4a44" }}>
          <HelpCircle size={15} color="#2F6E68" /> What do "Normal / Monitor / Urgent" mean?
        </div>
        <ChevronRight size={15} color="#a8b3ad" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
      </div>
      {open && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {["normal", "monitor", "urgent"].map((t) => (
            <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <TierBadge tier={t} />
              <span style={{ fontSize: 12.5, color: "#3d4a44", lineHeight: 1.45 }}>{TIER_EXPLANATION[t]}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
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
function PatientView({ patient, checkins, onSubmitCheckin, onCompleteEPDS, onSetHtnHistory, onSwitch, onOpenEducation }) {
  const [bp, setBp] = useState({ sys: "", dia: "" });
  const [weight, setWeight] = useState("");
  const [symptoms, setSymptoms] = useState([]);
  const [kick, setKick] = useState("");
  const [wound, setWound] = useState([]);
  const [pain, setPain] = useState(0);
  const [woundPhoto, setWoundPhoto] = useState(null);
  const [vte, setVte] = useState([]);
  const [postSymptoms, setPostSymptoms] = useState([]);
  const [supplements, setSupplements] = useState([]);
  const [dietRestrictions, setDietRestrictions] = useState([]);
  const [anemia, setAnemia] = useState(false);
  const [breastfeeding, setBreastfeeding] = useState(false);
  const [dietDescription, setDietDescription] = useState("");
  const [aiNutrition, setAiNutrition] = useState(null);
  const [aiNutritionStatus, setAiNutritionStatus] = useState("idle"); // idle | loading | error
  const [submitted, setSubmitted] = useState(false);
  const [showEPDSForm, setShowEPDSForm] = useState(false);
  const [editingEpds, setEditingEpds] = useState(null);

  const isPostSection = patient.phase === "post-term" && patient.deliveryType === "C-section";
  const isPostTerm = patient.phase === "post-term";
  const daysSince = patient.phase === "post-term" ? patient.weekOrDay : null;
  const epdsHistory = (checkins || []).filter((c) => c.epds).map((c) => c.epds);
  const latestEpds = epdsHistory[epdsHistory.length - 1];
  const recentlyScreened = (checkins || []).some((c) => c.epds && daysBetween(c.epds.date, dayISO(TODAY)) < 14);
  const showEPDS = daysSince && [30, 60, 180].some((d) => Math.abs(d - daysSince) <= 3) && !recentlyScreened;

  function handleEPDSComplete(result) {
    onCompleteEPDS(result);
    setShowEPDSForm(false);
    setEditingEpds(null);
  }

  const bpVal = bp.sys && bp.dia ? { sys: Number(bp.sys), dia: Number(bp.dia) } : null;
  const bpResult = (bpVal || symptoms.length) ? evalPreeclampsia(bpVal, symptoms, { weekOrDay: patient.weekOrDay, phase: patient.phase }) : null;
  const kickResult = patient.phase === "pre-term" ? evalKickCount(kick) : null;
  const woundHistory = (checkins || []).filter((c) => c.wound).map((c) => c.wound);
  const prevPain = woundHistory.length ? woundHistory[woundHistory.length - 1].painScale : null;
  const woundResult = isPostSection && (wound.length || pain > 0) ? evalWound(wound, pain, prevPain) : null;
  const vteResult = vte.length ? evalVTE(vte) : null;
  const postpartumResult = isPostSection && postSymptoms.length ? evalPostpartumSymptoms(postSymptoms) : null;
  const bpHistoryForTrend = (checkins || []).filter((c) => c.bp).map((c) => ({ date: c.date, sys: c.bp.sys, dia: c.bp.dia }));
  const trendResult = evalBPTrend(bpHistoryForTrend);
  const bpEntries = (checkins || []).filter((c) => c.bp).map((c) => ({ date: c.date, ...c.bp }));
  const lastBp = bpEntries[bpEntries.length - 1];
  const cadence = isPostTerm ? bpCadencePhase(daysSince) : null;
  const todaysBpCount = (checkins || []).filter((c) => c.date === dayISO(TODAY) && c.bp).length;
  const cadenceDue = cadence && todaysBpCount < cadence.required;

  const nutritionHistory = (checkins || []).filter((c) => c.nutrition).map((c) => c.nutrition);
  const lastNutrition = nutritionHistory[nutritionHistory.length - 1];
  const nutritionInput = { supplements, dietRestrictions, anemia, breastfeeding: isPostTerm ? breastfeeding : undefined, dietDescription };
  const nutritionKeywordResult = dietDescription.trim() ? evalNutrition(nutritionInput, lastNutrition) : null;
  const nutritionResult = mergeNutritionAssessment(nutritionKeywordResult, aiNutrition);
  const nutritionRecs = nutritionRecommendations(nutritionInput, patient);
  const nutritionReminders = supplementReminders(nutritionInput, patient);

  async function requestAiNutritionReview() {
    setAiNutritionStatus("loading");
    const result = await evalNutritionAI({ current: nutritionInput, previous: lastNutrition, patient });
    if (result) {
      setAiNutrition(result);
      setAiNutritionStatus("idle");
    } else {
      setAiNutritionStatus("error");
    }
  }

  const chartData = (checkins || []).filter((c) => c.bp).map((c) => ({
    date: fmtDate(c.date), sys: c.bp.sys, dia: c.bp.dia,
  }));

  function toggle(list, setList, key) {
    setList(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);
  }

  function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setWoundPhoto(reader.result);
    reader.readAsDataURL(file);
  }

  function submit() {
    const hasNutrition = dietDescription.trim() || supplements.length || dietRestrictions.length || anemia || (isPostTerm && breastfeeding);
    const entry = {
      date: dayISO(TODAY),
      ...(bp.sys && bp.dia ? { bp: { sys: Number(bp.sys), dia: Number(bp.dia), time: fmtClock(TODAY) } } : {}),
      ...(weight ? { weight: Number(weight) } : {}),
      ...(kick ? { kickCount: Number(kick) } : {}),
      ...(symptoms.length ? { symptoms } : {}),
      ...(isPostSection ? { wound: { symptoms: wound, painScale: pain, ...(woundPhoto ? { photo: woundPhoto } : {}) } } : {}),
      ...(isPostSection ? { vte: { symptoms: vte } } : {}),
      ...(isPostSection && postSymptoms.length ? { postSymptoms } : {}),
      ...(hasNutrition
        ? { nutrition: { supplements, dietRestrictions, anemia, ...(isPostTerm ? { breastfeeding } : {}), dietDescription: dietDescription.trim(), ...(aiNutrition ? { aiAssessment: aiNutrition } : {}) } }
        : {}),
    };
    onSubmitCheckin(entry);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2600);
  }

  const worst = worstTier([
    bpResult?.tier, woundResult?.tier, vteResult?.tier, nutritionResult?.tier,
    kickResult?.tier, postpartumResult?.tier, trendResult?.tier,
  ].filter(Boolean));

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F1", fontFamily: "Inter, sans-serif", color: "#14231F" }}>
      <style>{FONTS}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Heart size={20} color="#B5566B" fill="#B5566B" />
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600 }}>{patient.name}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={onOpenEducation} style={{ border: "none", background: "none", color: "#2F6E68", display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              <BookOpen size={14} /> Education
            </button>
            <button onClick={onSwitch} style={{ border: "none", background: "none", color: "#5b6b64", display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
              <LogOut size={14} /> Switch view
            </button>
          </div>
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

        <TierLegend />

        <Card style={{ marginTop: 14 }}>
          <SectionTitle
            icon={<Activity size={16} />}
            title="Blood pressure & symptoms"
            info="High blood pressure can be an early sign of pre-eclampsia, a pregnancy/postpartum complication that affects your organs. Tracking readings over time lets your care team catch a rising trend before any single reading looks alarming."
          />
          {lastBp && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: "#5b6b64" }}>
              Last checked {fmtDate(lastBp.date)}{lastBp.time ? ` at ${lastBp.time}` : ""} — {lastBp.sys}/{lastBp.dia}
            </div>
          )}
          {patient.htnHistory === undefined ? (
            <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "#f9f9f7", border: "1px solid #e7ece7" }}>
              <div style={{ fontSize: 12.5, color: "#3d4a44" }}>Before your first check: do you have a history of high blood pressure or hypertension prior to this pregnancy?</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => onSetHtnHistory(true)} style={{ ...primaryBtn, padding: "6px 14px", fontSize: 12.5 }}>Yes</button>
                <button onClick={() => onSetHtnHistory(false)} style={{ ...primaryBtn, padding: "6px 14px", fontSize: 12.5, background: "#fff", color: "#2F6E68", border: "1px solid #2F6E68" }}>No</button>
              </div>
            </div>
          ) : null}
          {cadenceDue && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#C08A2E" }}>
              BP check due: {todaysBpCount} of {cadence.required} today ({cadence.label})
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <input placeholder="Systolic" value={bp.sys} onChange={(e) => setBp({ ...bp, sys: e.target.value })} style={inputStyle} type="number" />
            <input placeholder="Diastolic" value={bp.dia} onChange={(e) => setBp({ ...bp, dia: e.target.value })} style={inputStyle} type="number" />
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>Weight (lbs) <InfoTip text="Sudden weight gain (more than ~2 lbs in a week) can signal fluid retention linked to pre-eclampsia, so we track it alongside blood pressure." /></label>
            <input value={weight} onChange={(e) => setWeight(e.target.value)} type="number" style={{ ...inputStyle, width: 120 }} />
          </div>
          {bpResult && <InlineNote result={bpResult} />}
          {trendResult && <InlineNote result={trendResult} />}
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["swelling", "visualDisturbance", "suddenWeightGain"].map((s) => (
              <Chip key={s} label={labelize(s)} active={symptoms.includes(s)} onClick={() => toggle(symptoms, setSymptoms, s)} tooltip={SYMPTOM_TOOLTIPS[s]} />
            ))}
          </div>
          {patient.phase === "pre-term" && (
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Kick count (last 2 hrs) <InfoTip text="A noticeable drop in fetal movement can be an early sign of fetal distress. A count under 10 in 2 hours immediately flags your care team for evaluation, rather than waiting for your next scheduled check-in." /></label>
              <input value={kick} onChange={(e) => setKick(e.target.value)} type="number" style={{ ...inputStyle, width: 100 }} />
              {kickResult && <InlineNote result={kickResult} />}
            </div>
          )}
        </Card>

        {isPostSection && (
          <Card style={{ marginTop: 14 }}>
            <SectionTitle
              icon={<Camera size={16} />}
              title="Wound & VTE check"
              info="C-section incisions can develop infections, and pregnancy/postpartum raises the risk of blood clots (VTE). These questions help your care team catch either one early, while it's still easy to treat."
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {["redness", "discharge", "warmth", "fever"].map((s) => (
                <Chip key={s} label={labelize(s)} active={wound.includes(s)} onClick={() => toggle(wound, setWound, s)} tooltip={WOUND_TOOLTIPS[s]} />
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>Wound photo</label>
              <input type="file" accept="image/*" onChange={handlePhoto} style={{ fontSize: 12.5 }} />
              {woundPhoto && (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
                  <img src={woundPhoto} alt="Wound preview" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid #e7ece7" }} />
                  <span style={{ fontSize: 12, color: "#5b6b64" }}>Attached — will be sent to your care team for review</span>
                </div>
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Pain scale (0–10): {pain} <InfoTip text="Pain that's rising, not just high, can signal a developing infection even before other symptoms show up — that's why we compare this to your last check-in." /></label>
              <input type="range" min={0} max={10} value={pain} onChange={(e) => setPain(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {["calfPain", "chestPain"].map((s) => (
                <Chip key={s} label={labelize(s)} active={vte.includes(s)} onClick={() => toggle(vte, setVte, s)} tooltip={VTE_TOOLTIPS[s]} />
              ))}
            </div>
            {woundResult && <InlineNote result={woundResult} />}
            {vteResult && <InlineNote result={vteResult} />}
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Other postpartum symptoms <InfoTip text="Heavy bleeding can signal postpartum hemorrhage, and burning urination can signal a UTI — both are treatable, and both are much easier to treat when caught early." /></label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {["bleeding", "burningUrination"].map((s) => (
                  <Chip key={s} label={labelize(s)} active={postSymptoms.includes(s)} onClick={() => toggle(postSymptoms, setPostSymptoms, s)} tooltip={POSTPARTUM_SYMPTOM_TOOLTIPS[s]} />
                ))}
              </div>
              {postpartumResult && <InlineNote result={postpartumResult} />}
            </div>
          </Card>
        )}

        {showEPDS && (
          <Card style={{ marginTop: 14, borderLeft: "3px solid #B5566B" }}>
            <SectionTitle
              icon={<Moon size={16} />}
              title="Mental health check-in due"
              info="Postpartum depression and anxiety are common and very treatable. This validated screening (EPDS) helps your care team know when to check in more closely, well before things feel unmanageable."
            />
            <p style={{ fontSize: 13.5, color: "#3d4a44", marginTop: 8 }}>
              It's time for your Edinburgh Postnatal Depression Scale (EPDS) screening. This takes about 2 minutes.
            </p>
            <button onClick={() => setShowEPDSForm(true)} style={primaryBtn}>Start screening</button>
          </Card>
        )}

        {latestEpds && (
          <Card style={{ marginTop: 14 }}>
            <SectionTitle icon={<Moon size={16} />} title="Your mental health screening" />
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <TierBadge tier={evalEPDS(latestEpds.score, latestEpds.anxietyScore, latestEpds.selfHarm).tier} />
              <span style={{ fontSize: 12.5, color: "#5b6b64" }}>{fmtDate(latestEpds.date)} · Score {latestEpds.score}/30</span>
            </div>
            <button
              onClick={() => setEditingEpds(latestEpds)}
              style={{ ...primaryBtn, marginTop: 12, background: "#fff", color: "#2F6E68", border: "1px solid #2F6E68" }}
            >
              Edit answers
            </button>
          </Card>
        )}

        <Card style={{ marginTop: 14 }}>
          <SectionTitle
            icon={<Utensils size={16} />}
            title="Nutrition & supplements"
            info="What you eat and take affects both you and your baby (or milk supply). These questions help your care team spot gaps early — like anemia risk from a restricted diet — reviewed against ACOG guidance."
          />
          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>Current supplements</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {SUPPLEMENT_OPTIONS.map((s) => (
                <Chip key={s} label={s} active={supplements.includes(s)} onClick={() => toggle(supplements, setSupplements, s)} tooltip={SUPPLEMENT_TOOLTIPS[s]} />
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Dietary restrictions</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {DIET_RESTRICTION_OPTIONS.map((d) => (
                <Chip key={d} label={d} active={dietRestrictions.includes(d)} onClick={() => toggle(dietRestrictions, setDietRestrictions, d)} tooltip={DIET_RESTRICTION_TOOLTIPS[d]} />
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Health status</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Chip
                label="Anemia"
                active={anemia}
                onClick={() => setAnemia((a) => !a)}
                tooltip="Flags that we should prioritize iron-rich foods and watch your iron supplementation more closely."
              />
              {isPostTerm && (
                <Chip
                  label="Currently breastfeeding"
                  active={breastfeeding}
                  onClick={() => setBreastfeeding((b) => !b)}
                  tooltip="Breastfeeding raises your calorie, calcium, and iron needs — this changes the recommendations and reminders shown below."
                />
              )}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Current diet (brief notes)</label>
            <textarea
              value={dietDescription}
              onChange={(e) => { setDietDescription(e.target.value); setAiNutrition(null); setAiNutritionStatus("idle"); }}
              placeholder="e.g. typical meals, any recent changes"
              rows={2}
              style={{ ...inputStyle, width: "100%", fontFamily: "Inter, sans-serif", resize: "vertical" }}
            />
            {dietDescription.trim() && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={requestAiNutritionReview}
                  disabled={aiNutritionStatus === "loading"}
                  style={{ ...primaryBtn, padding: "6px 14px", fontSize: 12.5, background: "#fff", color: "#2F6E68", border: "1px solid #2F6E68", opacity: aiNutritionStatus === "loading" ? 0.6 : 1 }}
                >
                  {aiNutritionStatus === "loading" ? "Reviewing…" : aiNutrition ? "Re-review with AI" : "Ask AI to review this diet"}
                </button>
                {aiNutritionStatus === "error" && <span style={{ fontSize: 11.5, color: "#8a9791" }}>AI review unavailable — showing rule-based check only</span>}
              </div>
            )}
          </div>
          {nutritionResult && <InlineNote result={nutritionResult} />}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #eef2ee" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#5b6b64", marginBottom: 6 }}>Tailored recommendations</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#3d4a44", display: "flex", flexDirection: "column", gap: 4 }}>
              {nutritionRecs.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
          {nutritionReminders.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eef2ee" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#5b6b64", marginBottom: 6 }}>Supplement reminders</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#3d4a44", display: "flex", flexDirection: "column", gap: 4 }}>
                {nutritionReminders.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 11, color: "#8a9791" }}>
            Source: <a href={ACOG_NUTRITION_URL} target="_blank" rel="noreferrer" style={{ color: "#8a9791" }}>ACOG Guidelines for Healthy Eating</a>
          </div>
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
      {(showEPDSForm || editingEpds) && (
        <EPDSScreening
          patient={patient}
          existingEpds={editingEpds}
          onComplete={handleEPDSComplete}
          onCancel={() => { setShowEPDSForm(false); setEditingEpds(null); }}
        />
      )}
    </div>
  );
}

function SectionTitle({ icon, title, info }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "Fraunces, serif", fontSize: 15.5, fontWeight: 600 }}>
      <span style={{ color: "#2F6E68" }}>{icon}</span>{title}
      {info && <InfoTip text={info} />}
    </div>
  );
}
function InlineNote({ result }) {
  return (
    <div style={{ marginTop: 10, fontSize: 12.5, color: TIER_COLOR[result.tier], display: "flex", gap: 6, alignItems: "flex-start" }}>
      <span style={{ marginTop: 2 }}>●</span>
      <span>
        {result.note}{" "}
        <span style={{ color: "#8a9791" }}>
          —{" "}
          {result.url
            ? <a href={result.url} target="_blank" rel="noreferrer" style={{ color: "#8a9791" }}>{result.source}</a>
            : result.source}
        </span>
      </span>
    </div>
  );
}
function Chip({ label, active, onClick, tooltip }) {
  return (
    <button onClick={onClick} title={tooltip} style={{
      padding: "6px 12px", borderRadius: 999, fontSize: 12.5, cursor: tooltip ? "help" : "pointer",
      border: `1px solid ${active ? "#2F6E68" : "#d8e0d9"}`, background: active ? "#2F6E68" : "#fff",
      color: active ? "#fff" : "#3d4a44", fontFamily: "Inter, sans-serif"
    }}>{label}</button>
  );
}

/* ---------- per-item "why we ask" text for check-in chips ----------
   Shown as a native hover tooltip on each chip (see Chip's `tooltip` prop).
------------------------------------------------------------------------- */
const SYMPTOM_TOOLTIPS = {
  swelling: "Sudden or severe swelling of the face or hands can be a sign of pre-eclampsia, especially alongside other symptoms or a borderline blood pressure reading.",
  visualDisturbance: "Seeing spots, blurring, or light sensitivity can reflect pre-eclampsia affecting blood flow — reported together with your blood pressure, it helps catch it earlier.",
  suddenWeightGain: "Rapid weight gain (more than about 2 lbs in a week) often reflects fluid retention linked to pre-eclampsia rather than diet.",
};
const WOUND_TOOLTIPS = {
  redness: "Redness spreading from a C-section incision is often one of the earliest visible signs of infection.",
  discharge: "Discharge from the incision, especially if it smells unusual or looks cloudy, often signals infection needing prompt treatment.",
  warmth: "An incision that feels warm to the touch can indicate inflammation or infection before other signs show up.",
  fever: "A fever alongside wound symptoms raises the likelihood of infection and is treated as more urgent by your care team.",
};
const VTE_TOOLTIPS = {
  calfPain: "One-sided calf pain or swelling is a classic warning sign of a deep vein blood clot (DVT), which pregnancy and postpartum both raise the risk of.",
  chestPain: "Chest pain can mean a clot has traveled to the lungs (pulmonary embolism) — a medical emergency, which is why this always flags urgent.",
};
const POSTPARTUM_SYMPTOM_TOOLTIPS = {
  bleeding: "Bleeding that increases instead of tapering off, or soaks a pad within an hour, can signal postpartum hemorrhage.",
  burningUrination: "Burning with urination usually signals a urinary tract infection — common postpartum, and easily treated once caught.",
};
const SUPPLEMENT_TOOLTIPS = {
  "Prenatal vitamin": "Covers your daily folic acid, iodine, and choline needs in one dose — the foundation the other supplement reminders below build on.",
  "Folic acid": "ACOG recommends 600 mcg/day during pregnancy (at least 400 mcg from a prenatal vitamin) — it helps prevent neural tube birth defects of the brain and spine.",
  "Iron": "Pregnancy needs 27 mg/day (up from 18 mg) to build the extra blood supply for you and the fetus. Your blood is checked for anemia at routine visits.",
  "Calcium": "1,000 mg/day (1,300 mg if you're 14-18) builds the fetus's bones and teeth — needs go up again while breastfeeding.",
  "Vitamin D": "600 IU/day works with calcium for fetal bone development. Many people don't get enough from diet and sunlight alone.",
  "DHA/Omega-3": "Supports fetal brain development. ACOG's primary recommendation is 2-3 servings of lower-mercury fish a week rather than a supplement alone.",
  "Iodine": "220 mcg/day is essential for healthy fetal brain development — it isn't in every prenatal vitamin, so it's worth checking your label.",
};
const DIET_RESTRICTION_TOOLTIPS = {
  "Vegetarian": "Plant-based diets need extra attention to B12, iron, choline, and omega-3s, since those are mostly found in animal products.",
  "Vegan": "Vegan diets need extra attention to B12, iron, choline, omega-3s, and sometimes calcium/vitamin D — fortified foods or supplements often help close the gap.",
  "Gluten-free": "Some gluten-free grain substitutes are less fortified with folic acid and iron than standard wheat products, so it's worth double-checking intake.",
  "Dairy-free": "Dairy is a primary source of calcium and vitamin D — going dairy-free means those need to come from fortified alternatives or supplements instead.",
  "Low-sodium": "Usually reflects a separate condition, like blood pressure management, that your care team will want context on.",
  "Diabetic diet": "Blood sugar control affects fetal growth — flagging this helps your care team coordinate with any glucose monitoring you're doing.",
};
function labelize(s) {
  return s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
const inputStyle = { flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #d8e0d9", fontFamily: "IBM Plex Mono, monospace", fontSize: 14 };
const labelStyle = { fontSize: 12.5, color: "#5b6b64", display: "block", marginBottom: 4 };
const primaryBtn = { background: "#2F6E68", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 13.5, cursor: "pointer" };

/* ---------- EPDS screening flow ---------- */
const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(15,42,46,0.55)", display: "flex",
  alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50, fontFamily: "Inter, sans-serif"
};

function EPDSScreening({ patient, existingEpds, onComplete, onCancel }) {
  const needsBaseline = !existingEpds && (patient.psychHistory === undefined || patient.psychHistory === null);
  const [step, setStep] = useState(needsBaseline ? "baseline" : "questions");
  const [psychHistory, setPsychHistoryLocal] = useState(null);
  const [answers, setAnswers] = useState(
    existingEpds?.answers ? [...existingEpds.answers] : Array(EPDS_QUESTIONS.length).fill(null)
  );
  const [result, setResult] = useState(null);

  const allAnswered = answers.every((a) => a !== null);

  function submitAnswers() {
    const score = answers.reduce((sum, a) => sum + a, 0);
    const anxietyScore = EPDS_QUESTIONS.reduce((sum, q, i) => sum + (q.anxiety ? answers[i] : 0), 0);
    const selfHarm = answers[9] > 0;
    const epds = { date: existingEpds ? existingEpds.date : dayISO(TODAY), score, anxietyScore, selfHarm, answers };
    setResult({ epds, evalResult: evalEPDS(score, anxietyScore, selfHarm) });
    setStep("result");
  }

  if (step === "baseline") {
    return (
      <div style={overlayStyle}>
        <Card style={{ maxWidth: 480, width: "100%" }}>
          <SectionTitle icon={<ClipboardList size={16} />} title="Before we start" />
          <p style={{ fontSize: 13.5, color: "#3d4a44", marginTop: 8 }}>
            Do you have a history of depression, anxiety, or another mental health diagnosis prior to this pregnancy?
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={() => { setPsychHistoryLocal(true); setStep("questions"); }} style={{ ...primaryBtn, flex: 1 }}>Yes</button>
            <button onClick={() => { setPsychHistoryLocal(false); setStep("questions"); }} style={{ ...primaryBtn, flex: 1, background: "#fff", color: "#2F6E68", border: "1px solid #2F6E68" }}>No</button>
          </div>
          <button onClick={onCancel} style={{ marginTop: 14, border: "none", background: "none", color: "#5b6b64", fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
        </Card>
      </div>
    );
  }

  if (step === "questions") {
    return (
      <div style={overlayStyle}>
        <Card style={{ maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
          <SectionTitle icon={<Moon size={16} />} title={existingEpds ? "Edit your EPDS answers" : "Edinburgh Postnatal Depression Scale"} />
          <p style={{ fontSize: 12.5, color: "#5b6b64", marginTop: 6 }}>
            {existingEpds ? "Update any answers below, then save your changes." : "Choose the answer that comes closest to how you have felt in the past 7 days."}
          </p>
          {existingEpds && !existingEpds.answers && (
            <p style={{ fontSize: 12, color: "#B5566B", marginTop: 6 }}>
              Your original answers weren't saved individually — please re-answer each question to update your results.
            </p>
          )}
          {EPDS_QUESTIONS.map((q, i) => (
            <div key={i} style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i + 1}. {q.text}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {q.options.map((opt, score) => (
                  <label key={score} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name={`epds-${i}`}
                      checked={answers[i] === score}
                      onChange={() => setAnswers((a) => a.map((v, idx) => (idx === i ? score : v)))}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 20 }}>
            <button onClick={onCancel} style={{ border: "none", background: "none", color: "#5b6b64", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button
              onClick={submitAnswers}
              disabled={!allAnswered}
              style={{ ...primaryBtn, flex: 1, opacity: allAnswered ? 1 : 0.5, cursor: allAnswered ? "pointer" : "not-allowed" }}
            >
              {existingEpds ? "Save changes" : "Submit screening"}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  const { epds, evalResult } = result;
  return (
    <div style={overlayStyle}>
      <Card style={{ maxWidth: 480, width: "100%" }}>
        <SectionTitle
          icon={evalResult.tier === "urgent" ? <AlertTriangle size={16} /> : evalResult.tier === "monitor" ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}
          title={existingEpds ? "Changes saved" : "Screening complete"}
        />
        <div style={{ marginTop: 10 }}><TierBadge tier={evalResult.tier} /></div>
        <div style={{ marginTop: 10, fontSize: 13.5, color: "#3d4a44" }}>{evalResult.note}</div>
        {evalResult.tier !== "normal" && (
          <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: evalResult.tier === "urgent" ? "#fbeae7" : "#faf1de", fontSize: 13 }}>
            Your care team has been notified and will reach out about scheduling a psych consult or PCP follow-up.
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <SectionTitle icon={<Moon size={16} />} title="A few things that can help" />
          <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13, color: "#3d4a44", display: "flex", flexDirection: "column", gap: 6 }}>
            {MINDFULNESS_TIPS.slice(0, 3).map((tip, i) => <li key={i}>{tip}</li>)}
          </ul>
        </div>
        <button
          onClick={() => onComplete({ psychHistory, epds, editingDate: existingEpds ? existingEpds.date : undefined })}
          style={{ ...primaryBtn, width: "100%", marginTop: 18 }}
        >
          Done
        </button>
      </Card>
    </div>
  );
}

/* ---------- shared: what flagged this patient, and why ----------
   Each category looks back through check-in history for its own most
   recent relevant entry (not just whatever the last check-in happened to
   contain) so a later, unrelated check-in never silently drops an earlier
   elevated reading. Used by both the dashboard row list and the detail panel.
------------------------------------------------------------------------- */
function computePatientReasons(patient, cIns) {
  const reasons = [];

  const bpHistory = cIns.filter((c) => c.bp).map((c) => ({ date: c.date, sys: c.bp.sys, dia: c.bp.dia }));
  const bpRelevant = cIns.filter((c) => c.bp || c.symptoms?.length);
  const latestBpEntry = bpRelevant[bpRelevant.length - 1];
  if (latestBpEntry) {
    const bpVal = latestBpEntry.bp ? { sys: latestBpEntry.bp.sys, dia: latestBpEntry.bp.dia } : null;
    const pre = evalPreeclampsia(bpVal, latestBpEntry.symptoms || [], { weekOrDay: patient.weekOrDay, phase: patient.phase });
    if (pre && pre.tier !== "normal") reasons.push({ label: "Blood pressure / pre-eclampsia risk", ...pre });
  }
  const trend = evalBPTrend(bpHistory);
  if (trend) reasons.push({ label: "Blood pressure trend", ...trend });

  const kickEntries = cIns.filter((c) => c.kickCount != null);
  const latestKick = kickEntries[kickEntries.length - 1];
  if (latestKick) {
    const k = evalKickCount(latestKick.kickCount);
    if (k && k.tier !== "normal") reasons.push({ label: "Fetal movement (kick count)", ...k });
  }

  const woundEntries = cIns.filter((c) => c.wound).map((c) => c.wound);
  const latestWound = woundEntries[woundEntries.length - 1];
  if (latestWound) {
    const prevPain = woundEntries.length > 1 ? woundEntries[woundEntries.length - 2].painScale : null;
    const r = evalWound(latestWound.symptoms, latestWound.painScale, prevPain);
    if (r.tier !== "normal") reasons.push({ label: "Wound check", ...r });
  }

  const vteEntries = cIns.filter((c) => c.vte).map((c) => c.vte);
  const latestVte = vteEntries[vteEntries.length - 1];
  if (latestVte?.symptoms?.length) { const r = evalVTE(latestVte.symptoms); if (r.tier !== "normal") reasons.push({ label: "VTE screen", ...r }); }

  const postEntries = cIns.filter((c) => c.postSymptoms?.length).map((c) => c.postSymptoms);
  const latestPost = postEntries[postEntries.length - 1];
  if (latestPost) { const r = evalPostpartumSymptoms(latestPost); if (r.tier !== "normal") reasons.push({ label: "Bleeding / urinary symptoms", ...r }); }

  const epdsEntries = cIns.filter((c) => c.epds).map((c) => c.epds);
  const epdsEntry = epdsEntries[epdsEntries.length - 1];
  if (epdsEntry) { const r = evalEPDS(epdsEntry.score, epdsEntry.anxietyScore, epdsEntry.selfHarm); if (r.tier !== "normal") reasons.push({ label: "Mental health (EPDS)", ...r }); }

  const nutritionEntries = cIns.filter((c) => c.nutrition).map((c) => c.nutrition);
  if (nutritionEntries.length) {
    const latestNutrition = nutritionEntries[nutritionEntries.length - 1];
    const keyword = evalNutrition(latestNutrition, nutritionEntries[nutritionEntries.length - 2]);
    const r = mergeNutritionAssessment(keyword, latestNutrition.aiAssessment || null);
    if (r.tier !== "normal") reasons.push({ label: "Nutrition", ...r });
  }

  return reasons;
}

/* ---------- PROVIDER VIEW ---------- */
function ProviderView({ patients, checkins, onSwitch, onAddPatient }) {
  const [selected, setSelected] = useState(null);

  const rows = useMemo(() => patients.map((p) => {
    const cIns = checkins[p.id] || [];
    const reasons = computePatientReasons(p, cIns);
    return { ...p, tier: worstTier(reasons.map((r) => r.tier)), reasons };
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onAddPatient} style={{ border: "none", background: "#B5566B", color: "#fff", padding: "6px 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
            <ClipboardList size={14} /> Add patient
          </button>
          <button onClick={onSwitch} style={{ border: "none", background: "rgba(255,255,255,0.1)", color: "#fff", padding: "6px 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <LogOut size={14} /> Switch view
          </button>
        </div>
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
                {(r.htnHistory || r.vteHistory) && (
                  <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {r.htnHistory && (
                      <PmhBadge
                        label="HTN hx"
                        tooltip="Pre-existing (chronic) hypertension — raises risk of pre-eclampsia, placental abruption, and fetal growth restriction. Monitor BP trend closely even when individual readings are subthreshold."
                      />
                    )}
                    {r.vteHistory && (
                      <PmhBadge
                        label="VTE hx"
                        tooltip="Prior venous thromboembolism — raises risk of a recurrent clot during pregnancy and postpartum. ACOG recommends assessing for prophylactic anticoagulation."
                      />
                    )}
                  </div>
                )}
                {r.tier !== "normal" && r.reasons.length > 0 && (
                  <div style={{ fontSize: 11.5, color: TIER_COLOR[r.tier], marginTop: 4, display: "flex", flexWrap: "wrap", gap: "3px 6px" }}>
                    {r.reasons.map((reason, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: TIER_COLOR[reason.tier], flex: "none" }} />
                        {reason.label}
                      </span>
                    ))}
                  </div>
                )}
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

/* ---------- clinician-facing visit summary ----------
   Compiles the same flagged reasons/PMH/vitals the dashboard already
   computes into an EHR-ready note, so a provider can document a chart
   review in one paste instead of re-reading the full check-in history.
------------------------------------------------------------------------- */
function buildVisitSummary(patient, checkins, reasons) {
  const lines = [];
  lines.push(`Visit summary — ${patient.name}`);
  lines.push(`Generated ${fmtDate(dayISO(TODAY))} from Continuum patient-reported check-ins`);
  lines.push(
    patient.phase === "pre-term"
      ? `Week ${patient.weekOrDay} of pregnancy`
      : `Day ${patient.weekOrDay} postpartum${patient.deliveryType ? ` (${patient.deliveryType} delivery)` : ""}`
  );

  const pmh = [];
  if (patient.htnHistory) pmh.push("hypertension");
  if (patient.vteHistory) pmh.push("prior VTE");
  if (patient.psychHistory) pmh.push("prior psychiatric history");
  if (pmh.length) lines.push(`PMH: ${pmh.join(", ")}`);
  if (patient.otherDiagnoses) lines.push(`Other diagnoses (intake): ${patient.otherDiagnoses}`);

  const bpEntries = checkins.filter((c) => c.bp);
  const lastBp = bpEntries[bpEntries.length - 1];
  if (lastBp) lines.push(`Last BP: ${lastBp.bp.sys}/${lastBp.bp.dia} (${fmtDate(lastBp.date)})`);

  const weights = checkins.filter((c) => c.weight != null).map((c) => c.weight);
  if (weights.length) {
    const w = weights[weights.length - 1];
    const prev = weights[weights.length - 2];
    lines.push(`Weight: ${w} lbs${prev != null ? ` (${w - prev >= 0 ? "+" : ""}${(w - prev).toFixed(1)} since last check-in)` : ""}`);
  }

  lines.push("");
  if (reasons.length) {
    lines.push(`Flagged items (${reasons.length}):`);
    reasons.forEach((r) => {
      lines.push(`- [${TIER_LABEL[r.tier].toUpperCase()}] ${r.label}: ${r.providerNote || r.note} (Source: ${r.source})`);
    });
  } else {
    lines.push("No flagged items — all patient-reported check-ins within expected range.");
  }
  return lines.join("\n");
}

function VisitSummaryModal({ summary, onClose }) {
  const [copied, setCopied] = useState(false);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch (e) {
      console.error("Copy visit summary failed:", e);
    }
  }

  return (
    <div style={overlayStyle}>
      <Card style={{ maxWidth: 560, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <SectionTitle icon={<ClipboardList size={16} />} title="Visit summary" />
        <pre
          style={{
            marginTop: 12, padding: 12, background: "#f9f9f7", border: "1px solid #e7ece7", borderRadius: 10,
            fontFamily: "IBM Plex Mono, monospace", fontSize: 12.5, lineHeight: 1.5, color: "#14231F",
            whiteSpace: "pre-wrap", wordBreak: "break-word", overflowY: "auto", flex: 1,
          }}
        >
          {summary}
        </pre>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button onClick={onClose} style={{ border: "none", background: "none", color: "#5b6b64", fontSize: 13, cursor: "pointer" }}>Close</button>
          <button onClick={copySummary} style={{ ...primaryBtn, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <ClipboardList size={13} /> {copied ? "Copied ✓" : "Copy to clipboard"}
          </button>
        </div>
      </Card>
    </div>
  );
}

function PatientDetail({ patient, checkins, onClose }) {
  const bpData = checkins.filter((c) => c.bp).map((c) => ({ date: fmtDate(c.date), sys: c.bp.sys, dia: c.bp.dia }));
  const reasons = computePatientReasons(patient, checkins);
  const [showSummary, setShowSummary] = useState(false);

  const weights = checkins.filter((c) => c.weight != null).map((c) => c.weight);
  const weightNow = weights[weights.length - 1];
  const weightPrev = weights[weights.length - 2];
  const woundPhotos = checkins.filter((c) => c.wound?.photo).map((c) => ({ date: c.date, photo: c.wound.photo }));
  const latestWoundPhoto = woundPhotos[woundPhotos.length - 1];

  return (
    <>
    <div style={{ flex: 1 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600 }}>{patient.name}</div>
            <div style={{ fontSize: 13, color: "#5b6b64", marginTop: 2 }}>
              {patient.phase === "pre-term" ? `Week ${patient.weekOrDay} of pregnancy` : `Day ${patient.weekOrDay} postpartum`} {patient.deliveryType ? `· ${patient.deliveryType} delivery` : ""}
            </div>
            {patient.psychHistory && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "#B5566B", display: "flex", alignItems: "center", gap: 4 }}>
                <ShieldAlert size={12} /> PMH: prior psychiatric history noted
              </div>
            )}
            {patient.htnHistory && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "#B5566B", display: "flex", alignItems: "center", gap: 4 }}>
                <ShieldAlert size={12} /> PMH: prior hypertension history noted
              </div>
            )}
            {patient.vteHistory && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "#B5566B", display: "flex", alignItems: "center", gap: 4 }}>
                <ShieldAlert size={12} /> PMH: prior VTE history noted
              </div>
            )}
            {patient.dob && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "#5b6b64" }}>DOB: {fmtDate(patient.dob)}</div>
            )}
            {weightNow != null && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "#5b6b64" }}>
                Weight: {weightNow} lbs{weightPrev != null ? ` (${weightNow - weightPrev >= 0 ? "+" : ""}${(weightNow - weightPrev).toFixed(1)} since last check-in)` : ""}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <button onClick={onClose} style={{ border: "none", background: "none", color: "#5b6b64", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
              <ArrowLeft size={14} /> Close
            </button>
            <button
              onClick={() => setShowSummary(true)}
              style={{ ...primaryBtn, background: "#fff", color: "#2F6E68", border: "1px solid #2F6E68", padding: "6px 12px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
            >
              <ClipboardList size={13} /> View visit summary
            </button>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <GestationalRuler phase={patient.phase} weekOrDay={patient.weekOrDay} />
        </div>
      </Card>

      {(patient.otherDiagnoses || patient.notes) && (
        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<ClipboardList size={16} />} title="Intake notes" />
          {patient.otherDiagnoses && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#5b6b64" }}>Other diagnoses</div>
              <div style={{ fontSize: 13, color: "#3d4a44", marginTop: 2 }}>{patient.otherDiagnoses}</div>
            </div>
          )}
          {patient.notes && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#5b6b64" }}>Additional notes</div>
              <div style={{ fontSize: 13, color: "#3d4a44", marginTop: 2 }}>{patient.notes}</div>
            </div>
          )}
        </Card>
      )}

      {latestWoundPhoto && (
        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<Camera size={16} />} title="Wound photo" />
          <div style={{ fontSize: 12, color: "#5b6b64", marginTop: 6 }}>Submitted {fmtDate(latestWoundPhoto.date)}</div>
          <a href={latestWoundPhoto.photo} target="_blank" rel="noreferrer">
            <img src={latestWoundPhoto.photo} alt="Wound" style={{ marginTop: 10, maxWidth: "100%", borderRadius: 10, border: "1px solid #e7ece7" }} />
          </a>
        </Card>
      )}

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
                <div style={{ fontSize: 12.5, color: "#3d4a44", marginTop: 4 }}>{r.providerNote || r.note}</div>
                <div style={{ fontSize: 11.5, color: "#8a9791", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                  <ExternalLink size={11} /> Source:{" "}
                  {r.url
                    ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#8a9791" }}>{r.source}</a>
                    : r.source}
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
    {showSummary && (
      <VisitSummaryModal summary={buildVisitSummary(patient, checkins, reasons)} onClose={() => setShowSummary(false)} />
    )}
    </>
  );
}

/* ---------- EDUCATION: subjects, FAQs, and AI Q&A ----------
   FAQ text, scope, sources, and the grounding excerpt all come from
   ACOG_CONTENT (shared/acogContent.js), fetched from live ACOG patient
   FAQ pages — this file only adds the icon and short UI blurb per topic.
   The same ACOG_CONTENT.<key>.scope string is sent to /api/ask-education
   so the model only answers within that topic and declines (rather than
   improvises) anything outside it or anything needing a personal diagnosis.
------------------------------------------------------------------------- */
const EDUCATION_SUBJECTS = [
  { key: "nutrition", icon: Utensils, blurb: "Eating well during pregnancy and postpartum, supplements, and special diets.", ...ACOG_CONTENT.nutrition },
  { key: "hypertension", icon: Activity, blurb: "Blood pressure changes, pre-eclampsia warning signs, and why we monitor closely.", ...ACOG_CONTENT.hypertension },
  { key: "postpartum-recovery", icon: Heart, blurb: "What's normal after delivery, healing timelines, and warning signs.", ...ACOG_CONTENT["postpartum-recovery"] },
  { key: "pelvic-floor", icon: Dumbbell, blurb: "Kegels, pelvic organ prolapse, returning to exercise, and pelvic floor health.", ...ACOG_CONTENT["pelvic-floor"] },
  { key: "breastfeeding", icon: Milk, blurb: "Latch, feeding schedules, diet, mastitis, and medication safety.", ...ACOG_CONTENT.breastfeeding },
];

async function askEducation(subjectKey, question) {
  try {
    const res = await fetch("/api/ask-education", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subjectKey, question }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || typeof data.answer !== "string") {
      return { error: data.error || "Something went wrong reaching the assistant." };
    }
    return { answer: data.answer, onTopic: data.onTopic !== false };
  } catch (err) {
    return { error: "Couldn't reach the assistant — check your connection and try again." };
  }
}

function EducationChat({ subject }) {
  const [input, setInput] = useState("");
  const [thread, setThread] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const threadEndRef = useRef(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread.length]);

  async function ask(question) {
    if (!question || status === "loading") return;
    setInput("");
    setStatus("loading");
    setThread((t) => [...t, { question, pending: true }]);
    const result = await askEducation(subject.key, question);
    setThread((t) => {
      const next = [...t];
      next[next.length - 1] = result.error
        ? { question, error: result.error }
        : { question, answer: result.answer, onTopic: result.onTopic };
      return next;
    });
    setStatus(result.error ? "error" : "idle");
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <MessageCircle size={15} color="#2F6E68" />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#3d4a44" }}>Ask about {subject.label.toLowerCase()}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "#8a9791", marginTop: 4 }}>
        Answers are drawn only from ACOG and other validated guidelines, and are limited to this topic — for anything specific to you, contact your care team.
      </div>

      {thread.length === 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, color: "#8a9791", marginBottom: 6 }}>Suggested questions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {subject.faqs.slice(0, 3).map((f, i) => (
              <button
                key={i}
                onClick={() => ask(f.q)}
                style={{
                  padding: "6px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer", textAlign: "left",
                  border: "1px solid #d8e0d9", background: "#fff", color: "#2F6E68", fontFamily: "Inter, sans-serif",
                }}
              >
                {f.q}
              </button>
            ))}
          </div>
        </div>
      )}

      {thread.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {thread.map((t, i) => (
            <div key={i}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#14231F" }}>{t.question}</div>
              {t.pending ? (
                <div style={{ fontSize: 13, color: "#8a9791", marginTop: 4, padding: "9px 12px", borderRadius: 10, background: "#f9f9f7", border: "1px solid #e7ece7", fontStyle: "italic" }}>
                  Thinking…
                </div>
              ) : t.error ? (
                <div style={{ fontSize: 12.5, color: "#B23A2E", marginTop: 4 }}>{t.error}</div>
              ) : (
                <div style={{
                  fontSize: 13, color: "#3d4a44", marginTop: 4, padding: "9px 12px", borderRadius: 10,
                  background: t.onTopic ? "#f9f9f7" : "#faf1de", border: `1px solid ${t.onTopic ? "#e7ece7" : "#C08A2E33"}`,
                }}>
                  {t.answer}
                </div>
              )}
            </div>
          ))}
          <div ref={threadEndRef} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(input.trim()); }}
          placeholder={`Ask a question about ${subject.label.toLowerCase()}...`}
          style={{ ...inputStyle, width: "100%", fontFamily: "Inter, sans-serif" }}
        />
        <button
          onClick={() => ask(input.trim())}
          disabled={status === "loading" || !input.trim()}
          style={{ ...primaryBtn, padding: "0 14px", opacity: status === "loading" || !input.trim() ? 0.6 : 1, display: "flex", alignItems: "center" }}
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}

function EducationView({ onBack }) {
  const [selectedKey, setSelectedKey] = useState(null);
  const subject = EDUCATION_SUBJECTS.find((s) => s.key === selectedKey);

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F1", fontFamily: "Inter, sans-serif", color: "#14231F" }}>
      <style>{FONTS}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={20} color="#2F6E68" />
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600 }}>Education</span>
          </div>
          <button
            onClick={() => (subject ? setSelectedKey(null) : onBack())}
            style={{ border: "none", background: "none", color: "#5b6b64", display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}
          >
            <ArrowLeft size={14} /> {subject ? "All topics" : "Back to check-in"}
          </button>
        </div>

        {!subject && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: "#5b6b64" }}>Pick a topic to see frequently asked questions or ask your own.</div>
            {EDUCATION_SUBJECTS.map((s) => (
              <Card
                key={s.key}
                style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div onClick={() => setSelectedKey(s.key)} style={{ display: "flex", gap: 12, alignItems: "center", flex: 1 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "#eef2ee", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                    <s.icon size={17} color="#2F6E68" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14.5, fontFamily: "Fraunces, serif" }}>{s.label}</div>
                    <div style={{ fontSize: 12, color: "#5b6b64", marginTop: 2 }}>{s.blurb}</div>
                  </div>
                </div>
                <ChevronRight size={16} color="#a8b3ad" onClick={() => setSelectedKey(s.key)} />
              </Card>
            ))}
          </div>
        )}

        {subject && (
          <>
            <Card style={{ marginTop: 14 }}>
              <SectionTitle icon={<subject.icon size={16} />} title={subject.label} />
              <p style={{ fontSize: 13, color: "#5b6b64", marginTop: 6 }}>{subject.blurb}</p>
            </Card>

            <Card style={{ marginTop: 14 }}>
              <SectionTitle icon={<HelpCircle size={16} />} title="Frequently asked questions" />
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {subject.faqs.map((f, i) => (
                  <details key={i} style={{ borderTop: i > 0 ? "1px solid #eef2ee" : "none", paddingTop: i > 0 ? 8 : 0 }}>
                    <summary style={{ fontSize: 13.5, fontWeight: 600, cursor: "pointer", color: "#14231F" }}>{f.q}</summary>
                    <div style={{ fontSize: 13, color: "#3d4a44", marginTop: 6, lineHeight: 1.5 }}>{f.a}</div>
                  </details>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: "#8a9791", display: "flex", flexDirection: "column", gap: 2 }}>
                {subject.sources.map((src, i) => (
                  <div key={i}>
                    Source: <a href={src.url} target="_blank" rel="noreferrer" style={{ color: "#8a9791" }}>{src.label}</a>
                  </div>
                ))}
              </div>
            </Card>

            <Card style={{ marginTop: 14 }}>
              <details>
                <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#2F6E68" }}><ExternalLink size={15} /></span>
                  <span style={{ fontFamily: "Fraunces, serif", fontSize: 14.5, fontWeight: 600 }}>Read the ACOG source text</span>
                </summary>
                <p style={{ fontSize: 11.5, color: "#8a9791", marginTop: 8 }}>
                  This is the actual reference text pulled from ACOG's patient FAQ pages — it's what the assistant below is grounded in when answering your questions.
                </p>
                <p style={{ fontSize: 13, color: "#3d4a44", marginTop: 10, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{subject.excerpt}</p>
              </details>
            </Card>

            <Card style={{ marginTop: 14 }}>
              <EducationChat subject={subject} />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- DOCUMENTATION: what Continuum does, for patients and care teams ---------- */
function DocsSection({ children }) {
  return <div style={{ marginTop: 10, fontSize: 13.5, color: "#3d4a44", lineHeight: 1.6 }}>{children}</div>;
}
function DocsList({ items }) {
  return (
    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13.5, color: "#3d4a44", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

function DocsView({ onBack }) {
  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F1", fontFamily: "Inter, sans-serif", color: "#14231F" }}>
      <style>{FONTS}</style>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileText size={20} color="#2F6E68" />
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600 }}>How Continuum works</span>
          </div>
          <button onClick={onBack} style={{ border: "none", background: "none", color: "#5b6b64", display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
            <ArrowLeft size={14} /> Back
          </button>
        </div>
        <p style={{ fontSize: 13.5, color: "#5b6b64", marginTop: 10, lineHeight: 1.55 }}>
          Continuum connects pregnant and postpartum patients to their care team between visits. Patients log
          short check-ins from home; the app screens each entry against evidence-based clinical thresholds and
          surfaces anything that needs attention on a provider dashboard — so problems like pre-eclampsia,
          wound infection, blood clots, postpartum depression, or hemorrhage get caught early instead of waiting
          for the next scheduled appointment.
        </p>

        <Card style={{ marginTop: 16 }}>
          <SectionTitle icon={<Baby size={16} />} title="Where you are: the gestational ruler" />
          <DocsSection>
            Every screen shows a timeline running from <strong>week 20 of pregnancy</strong> through{" "}
            <strong>term (40 weeks)</strong> to <strong>day 90 postpartum</strong>. A dot marks the patient's
            current position, and colored ticks mark past check-ins that were flagged Monitor or Urgent — so
            you can see at a glance both where someone is in their pregnancy/recovery and when things came up.
          </DocsSection>
        </Card>

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<HelpCircle size={16} />} title="The three-tier result system" />
          <DocsSection>
            Every check-in item — a blood pressure reading, a symptom, a screening score — is scored into one
            of three tiers. The same tiers are used everywhere: on the patient's check-in, on the provider's
            patient list, and in the visit summary.
          </DocsSection>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {["normal", "monitor", "urgent"].map((t) => (
              <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <TierBadge tier={t} />
                <span style={{ fontSize: 12.5, color: "#3d4a44", lineHeight: 1.45 }}>{TIER_EXPLANATION[t]}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<Heart size={16} />} title="For patients: what a check-in covers" />
          <DocsSection>
            The check-in form adapts to where the patient is — some sections only appear during pregnancy,
            others only appear postpartum after a C-section.
          </DocsSection>
          <DocsList items={[
            <><strong>Blood pressure & symptoms</strong> — systolic/diastolic entry plus swelling, visual disturbance, and sudden weight gain checkboxes. Readings ≥140/90 flag for monitoring and ≥160/110 flag urgent (severe pre-eclampsia range). A single symptom won't flag a clearly normal reading, but two or more symptoms — or one symptom plus a borderline reading — flags for review even when blood pressure alone looks fine. The app also watches the trend across recent readings and flags a rising pattern even if every individual reading was subthreshold.</>,
            <><strong>Weight</strong> — tracked alongside blood pressure since a sudden gain (roughly 2+ lbs in a week) can signal the fluid retention seen in pre-eclampsia.</>,
            <><strong>Kick counts</strong> (pregnancy only) — fewer than 10 fetal movements in 2 hours immediately flags urgent, per standard fetal-movement guidance.</>,
            <><strong>Wound & VTE check</strong> (postpartum after a C-section) — redness, discharge, warmth, or fever around the incision, plus a 0–10 pain scale compared against the last check-in (rising or high pain flags even without other signs), an optional wound photo for the care team to review, and calf pain/chest pain screening for blood clots (chest pain always flags urgent as a possible pulmonary embolism).</>,
            <><strong>Other postpartum symptoms</strong> — heavy bleeding and burning urination, screened for postpartum hemorrhage and UTI.</>,
            <><strong>Mental health screening (EPDS)</strong> — the 10-item Edinburgh Postnatal Depression Scale, prompted around postpartum days 30, 60, and 180. A total score ≥10, an elevated anxiety subscale, or any answer indicating thoughts of self-harm all flag for the care team; self-harm always shows a 988 crisis line prompt. Patients can revisit and edit past answers at any time.</>,
            <><strong>Nutrition & supplements</strong> — current supplements, dietary restrictions, anemia/breastfeeding status, and a free-text diet description. A rule-based check flags when the diet description changes since the last check-in; patients can also ask an AI reviewer to read the description for clinical relevance, which — when used — replaces the rule-based flag rather than stacking with it. The section also surfaces tailored recommendations (e.g. iron pairing for anemia, extra calories while breastfeeding) and missing-supplement reminders, sourced from ACOG nutrition guidance.</>,
            <><strong>Blood pressure trend chart</strong> — once there are at least two readings, a chart plots systolic/diastolic over time against the 140 mm Hg reference line.</>,
          ]} />
        </Card>

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<BookOpen size={16} />} title="For patients: the Education library" />
          <DocsSection>
            A separate section (reachable from the check-in screen) covers five topics — Nutrition,
            Hypertension, Postpartum Recovery, Pelvic Floor & Physical Recovery, and Breastfeeding Support.
            Each topic shows the source ACOG FAQ text it's grounded in, a handful of common questions with
            plain-language answers, and a chat box for asking follow-up questions. The AI assistant answers
            only from that topic's ACOG excerpt, declines anything outside its scope or anything requiring a
            personal diagnosis, and always credits the source it drew from.
          </DocsSection>
        </Card>

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<Stethoscope size={16} />} title="For care teams: the provider dashboard" />
          <DocsList items={[
            <><strong>Patient list</strong> — every patient, sorted Urgent first, then Monitor, then Normal. Each row shows their week/day, delivery type, past-medical-history badges (e.g. prior hypertension or VTE — shown separately from today's tier since they're background risk, not a new event), and a short list of what's currently flagged.</>,
            <><strong>Patient detail</strong> — the gestational ruler, intake notes, the latest wound photo (if submitted), a "why this patient is flagged" list giving the clinical-language rationale and cited source for each flagged item, and the blood pressure trend chart with both the 140 and 160 mm Hg reference lines.</>,
            <><strong>Visit summary</strong> — a one-click, EHR-ready plain-text note compiling PMH, latest vitals, and every flagged item with its clinical rationale and source, previewed before copying to the clipboard so a provider can document a chart review without re-reading the full check-in history.</>,
            <><strong>Add patient</strong> — an intake form capturing name, DOB, pregnancy status (week or postpartum day, delivery type), past medical history (hypertension, VTE, psychiatric history), other diagnoses, and free-text notes.</>,
          ]} />
        </Card>

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<ShieldAlert size={16} />} title="Clinical basis" />
          <DocsSection>
            Thresholds and scoring are drawn from named clinical sources rather than invented — each flagged
            item in the app links back to the guideline it came from:
          </DocsSection>
          <DocsList items={[
            "ACOG — blood pressure staging, pre-eclampsia symptoms, and nutrition guidance",
            "Count the Kicks / ACOG — fetal movement (kick count) guidance",
            "Edinburgh Postnatal Depression Scale — depression/anxiety screening and scoring",
            "American Heart Association — VTE (blood clot) warning signs",
            "Cleveland Clinic — wound infection and postpartum symptom guidance",
          ]} />
        </Card>

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<Lock size={16} />} title="Access & data" />
          <DocsSection>
            The app sits behind a password-protected login. Patient and check-in data — including wound
            photos and EPDS answers — is stored in a Postgres database rather than on-device, so a patient's
            history is available to their care team across sessions and devices.
          </DocsSection>
        </Card>
      </div>
    </div>
  );
}

/* ---------- NEW PATIENT INTAKE ---------- */
function NewPatientPage({ onSave, onCancel }) {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [phase, setPhase] = useState("pre-term");
  const [weekOrDay, setWeekOrDay] = useState("");
  const [deliveryType, setDeliveryType] = useState(null);
  const [htnHistory, setHtnHistory] = useState(false);
  const [vteHistory, setVteHistory] = useState(false);
  const [psychHistory, setPsychHistory] = useState(false);
  const [otherDiagnoses, setOtherDiagnoses] = useState("");
  const [notes, setNotes] = useState("");

  const canSave = name.trim() && weekOrDay !== "" && (phase === "pre-term" || deliveryType);

  function save() {
    const n = Number(weekOrDay);
    const dueDate = phase === "pre-term"
      ? dayISO(addDays(TODAY, Math.max(0, 40 - n) * 7))
      : dayISO(addDays(TODAY, -n));
    onSave({
      name: name.trim(),
      dob: dob || null,
      phase,
      weekOrDay: n,
      deliveryType: phase === "post-term" ? deliveryType : null,
      dueDate,
      htnHistory,
      vteHistory,
      psychHistory,
      otherDiagnoses: otherDiagnoses.trim(),
      notes: notes.trim(),
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F1", fontFamily: "Inter, sans-serif", color: "#14231F" }}>
      <style>{FONTS}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ClipboardList size={20} color="#2F6E68" />
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600 }}>New patient</span>
          </div>
          <button onClick={onCancel} style={{ border: "none", background: "none", color: "#5b6b64", display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
            <ArrowLeft size={14} /> Back to dashboard
          </button>
        </div>

        <Card>
          <SectionTitle icon={<Users size={16} />} title="Basic information" />
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Patient name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" style={{ ...inputStyle, width: "100%", fontFamily: "Inter, sans-serif" }} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Date of birth</label>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={{ ...inputStyle, width: 180 }} />
          </div>
        </Card>

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<Baby size={16} />} title="Pregnancy status" />
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Chip label="Pre-term (currently pregnant)" active={phase === "pre-term"} onClick={() => setPhase("pre-term")} />
            <Chip label="Post-term (postpartum)" active={phase === "post-term"} onClick={() => setPhase("post-term")} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>{phase === "pre-term" ? "Weeks pregnant" : "Days postpartum"}</label>
            <input value={weekOrDay} onChange={(e) => setWeekOrDay(e.target.value)} type="number" min={0} style={{ ...inputStyle, width: 120 }} />
          </div>
          {phase === "post-term" && (
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Delivery type</label>
              <div style={{ display: "flex", gap: 8 }}>
                <Chip label="Vaginal" active={deliveryType === "Vaginal"} onClick={() => setDeliveryType("Vaginal")} />
                <Chip label="C-section" active={deliveryType === "C-section"} onClick={() => setDeliveryType("C-section")} />
              </div>
            </div>
          )}
        </Card>

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<ShieldAlert size={16} />} title="Past medical history" />
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Chip label="Hypertension" active={htnHistory} onClick={() => setHtnHistory((v) => !v)} />
            <Chip label="Prior VTE / blood clot" active={vteHistory} onClick={() => setVteHistory((v) => !v)} />
            <Chip label="Prior psychiatric / mental health diagnosis" active={psychHistory} onClick={() => setPsychHistory((v) => !v)} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Other relevant diagnoses</label>
            <textarea
              value={otherDiagnoses}
              onChange={(e) => setOtherDiagnoses(e.target.value)}
              placeholder="e.g. gestational diabetes, autoimmune condition, prior C-section..."
              rows={2}
              style={{ ...inputStyle, width: "100%", fontFamily: "Inter, sans-serif", resize: "vertical" }}
            />
          </div>
        </Card>

        <Card style={{ marginTop: 14 }}>
          <SectionTitle icon={<ClipboardList size={16} />} title="Anything else helpful" />
          <div style={{ marginTop: 12 }}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. allergies, support system, language preference, prior pregnancy complications..."
              rows={3}
              style={{ ...inputStyle, width: "100%", fontFamily: "Inter, sans-serif", resize: "vertical" }}
            />
          </div>
        </Card>

        <button
          onClick={save}
          disabled={!canSave}
          style={{ ...primaryBtn, width: "100%", marginTop: 18, padding: "13px 0", fontSize: 15, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}
        >
          Add patient
        </button>
      </div>
    </div>
  );
}

/* ---------- LOGIN / VIEW SELECT ---------- */
function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const ok = await onLogin(password);
    setSubmitting(false);
    if (!ok) setError("Incorrect password");
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2A2E", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif" }}>
      <style>{FONTS}</style>
      <form onSubmit={submit} style={{ textAlign: "center", color: "#fff", width: 280 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <Lock size={30} color="#B5566B" />
        </div>
        <div style={{ fontFamily: "Fraunces, serif", fontSize: 26, fontWeight: 500, marginBottom: 20 }}>Continuum</div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid #2c4a48", background: "#14383a", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 14 }}
        />
        {error && <div style={{ marginTop: 8, fontSize: 12.5, color: "#e39a8d" }}>{error}</div>}
        <button type="submit" disabled={submitting || !password} style={{ ...selectBtn, background: "#2F6E68", width: "100%", justifyContent: "center", marginTop: 14, opacity: submitting || !password ? 0.6 : 1 }}>
          {submitting ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

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
        <button
          onClick={() => onSelect("docs")}
          style={{ border: "none", background: "none", color: "#a9c2bb", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", marginTop: 22, fontFamily: "Inter, sans-serif" }}
        >
          <FileText size={14} /> How Continuum works
        </button>
      </div>
    </div>
  );
}
const selectBtn = { display: "flex", alignItems: "center", gap: 8, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontSize: 14.5, fontWeight: 600, cursor: "pointer", fontFamily: "Inter, sans-serif" };

/* ---------- ROOT ---------- */
export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [view, setView] = useState(null);
  const [data, setData] = useState(null);
  const [activePatientId, setActivePatientId] = useState("p1");
  const [addingPatient, setAddingPatient] = useState(false);
  const [patientScreen, setPatientScreen] = useState("checkin"); // checkin | education

  async function refreshData() {
    const res = await fetch("/api/patients");
    if (res.status === 401) {
      setAuthenticated(false);
      setAuthChecked(true);
      return;
    }
    const json = await res.json();
    setData({ patients: json.patients, checkins: json.checkins });
    setAuthenticated(true);
    setAuthChecked(true);
  }

  useEffect(() => { refreshData(); }, []);

  async function login(password) {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return false;
    await refreshData();
    return true;
  }

  if (!authChecked) {
    return <div style={{ minHeight: "100vh", background: "#0F2A2E", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "Inter, sans-serif" }}>Loading…</div>;
  }

  if (!authenticated) {
    return <LoginScreen onLogin={login} />;
  }

  if (!data) {
    return <div style={{ minHeight: "100vh", background: "#0F2A2E", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "Inter, sans-serif" }}>Loading…</div>;
  }

  async function submitCheckin(entry) {
    await fetch("/api/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId: activePatientId, entry }),
    });
    await refreshData();
  }

  async function completeEPDS({ psychHistory, epds, editingDate }) {
    if (editingDate) {
      await fetch("/api/checkins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: activePatientId, editingDate, epds }),
      });
    } else {
      await fetch("/api/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: activePatientId, entry: { date: dayISO(TODAY), epds } }),
      });
    }
    if (psychHistory !== null && psychHistory !== undefined) {
      await fetch("/api/patients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: activePatientId, psychHistory }),
      });
    }
    await refreshData();
  }

  async function setHtnHistory(value) {
    await fetch("/api/patients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId: activePatientId, htnHistory: value }),
    });
    await refreshData();
  }

  async function addPatient(newPatient) {
    await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPatient),
    });
    await refreshData();
    setAddingPatient(false);
  }

  if (!view) return <ViewSelect onSelect={setView} />;

  if (view === "docs") return <DocsView onBack={() => setView(null)} />;

  if (view === "patient") {
    if (patientScreen === "education") {
      return <EducationView onBack={() => setPatientScreen("checkin")} />;
    }
    const patient = data.patients.find((p) => p.id === activePatientId);
    return (
      <div>
        <div style={{ background: "#eef2ee", padding: "6px 16px", fontSize: 11.5, color: "#5b6b64", display: "flex", gap: 10, fontFamily: "Inter, sans-serif" }}>
          Demo patient:
          {data.patients.map((p) => (
            <span key={p.id} onClick={() => setActivePatientId(p.id)} style={{ cursor: "pointer", fontWeight: p.id === activePatientId ? 700 : 400, textDecoration: p.id === activePatientId ? "underline" : "none" }}>{p.name.split(" ")[0]}</span>
          ))}
        </div>
        <PatientView
          patient={patient}
          checkins={data.checkins[activePatientId]}
          onSubmitCheckin={submitCheckin}
          onCompleteEPDS={completeEPDS}
          onSetHtnHistory={setHtnHistory}
          onSwitch={() => setView(null)}
          onOpenEducation={() => setPatientScreen("education")}
        />
      </div>
    );
  }

  if (addingPatient) {
    return <NewPatientPage onSave={addPatient} onCancel={() => setAddingPatient(false)} />;
  }

  return <ProviderView patients={data.patients} checkins={data.checkins} onSwitch={() => setView(null)} onAddPatient={() => setAddingPatient(true)} />;
}