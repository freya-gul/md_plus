// One-off script: creates the patients/checkins tables (if missing) and,
// if the patients table is empty, seeds the same demo dataset the app used
// to generate client-side. Run with: node scripts/seed-db.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (expected in .env.local — run `vercel env pull .env.local` first)");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const TODAY = new Date("2026-07-22T09:00:00");
const dayISO = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const patients = [
  { id: "p1", name: "Maria Alvarez", phase: "pre-term", weekOrDay: 32, deliveryType: null, dueDate: dayISO(addDays(TODAY, 56)), htnHistory: false },
  { id: "p2", name: "Jade Whitfield", phase: "post-term", weekOrDay: 6, deliveryType: "C-section", dueDate: dayISO(addDays(TODAY, -42)), psychHistory: true },
  { id: "p3", name: "Priya Nair", phase: "pre-term", weekOrDay: 38, deliveryType: null, dueDate: dayISO(addDays(TODAY, 14)), htnHistory: true },
  { id: "p4", name: "Samira Okafor", phase: "post-term", weekOrDay: 30, deliveryType: "Vaginal", dueDate: dayISO(addDays(TODAY, -245)), vteHistory: true },
  { id: "p5", name: "Elena Petrova", phase: "pre-term", weekOrDay: 24, deliveryType: null, dueDate: dayISO(addDays(TODAY, 112)), htnHistory: false },
  { id: "p6", name: "Aisha Bello", phase: "post-term", weekOrDay: 15, deliveryType: "Vaginal", dueDate: dayISO(addDays(TODAY, -15)), vteHistory: false },
];

const checkins = {
  p1: Array.from({ length: 8 }).map((_, i) => {
    const sys = 118 + i * 5 + (i > 5 ? 10 : 0);
    const dia = 76 + i * 2 + (i > 5 ? 6 : 0);
    return {
      date: dayISO(addDays(TODAY, -14 + i * 2)),
      bp: { sys, dia }, weight: 152 + i * 0.4, kickCount: 12 - (i > 5 ? 3 : 0),
      symptoms: i > 5 ? ["swelling", "visualDisturbance"] : [],
      ...(i === 0 ? { nutrition: { supplements: ["Prenatal vitamin"], dietRestrictions: [], anemia: false, dietDescription: "Balanced meals, occasional prenatal smoothie" } } : {}),
      ...(i === 7 ? { nutrition: { supplements: ["Prenatal vitamin"], dietRestrictions: ["Vegetarian"], anemia: true, dietDescription: "Cut out meat this week, feeling low energy" } } : {}),
    };
  }),
  p2: Array.from({ length: 6 }).map((_, i) => ({
    date: dayISO(addDays(TODAY, -10 + i * 2)),
    weight: 145 - i * 0.3,
    wound: { symptoms: i >= 4 ? ["redness"] : [], painScale: i >= 4 ? 6 : 2 },
    vte: { symptoms: [] },
    postSymptoms: i === 4 ? ["burningUrination"] : [],
    epds: i === 5 ? { score: 12, anxietyScore: 7, selfHarm: false, date: dayISO(addDays(TODAY, -1)) } : null,
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
    epds: i === 2 ? { score: 6, anxietyScore: 2, selfHarm: false, date: dayISO(addDays(TODAY, -30)) } : null,
    ...(i === 3 ? { nutrition: { supplements: ["Prenatal vitamin", "Calcium"], dietRestrictions: [], anemia: false, breastfeeding: true, dietDescription: "Nursing every 2-3 hrs, eating extra dairy and lean protein" } } : {}),
  })),
  p5: Array.from({ length: 4 }).map((_, i) => ({
    date: dayISO(addDays(TODAY, -12 + i * 4)),
    bp: { sys: 110 + i, dia: 70 + i }, weight: 138 + i * 0.5, kickCount: 12 + i,
    symptoms: [],
    ...(i === 0 ? { nutrition: { supplements: ["Prenatal vitamin", "Folic acid"], dietRestrictions: [], anemia: false, dietDescription: "Regular balanced meals, no changes" } } : {}),
  })),
  p6: Array.from({ length: 4 }).map((_, i) => ({
    date: dayISO(addDays(TODAY, -9 + i * 3)),
    wound: { symptoms: [], painScale: 1 },
    vte: { symptoms: [] },
    postSymptoms: i === 3 ? ["burningUrination"] : [],
  })),
};

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dob DATE,
      phase TEXT NOT NULL,
      week_or_day INTEGER NOT NULL,
      delivery_type TEXT,
      due_date DATE,
      htn_history BOOLEAN,
      vte_history BOOLEAN,
      psych_history BOOLEAN,
      other_diagnoses TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS checkins (
      id SERIAL PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS checkins_patient_id_idx ON checkins(patient_id)`;
  console.log("Schema ready.");

  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM patients`;
  if (count > 0) {
    console.log(`patients table already has ${count} row(s) — skipping seed.`);
    return;
  }

  for (const p of patients) {
    await sql`
      INSERT INTO patients (id, name, dob, phase, week_or_day, delivery_type, due_date, htn_history, vte_history, psych_history)
      VALUES (${p.id}, ${p.name}, ${p.dob || null}, ${p.phase}, ${p.weekOrDay}, ${p.deliveryType}, ${p.dueDate},
              ${p.htnHistory ?? null}, ${p.vteHistory ?? null}, ${p.psychHistory ?? null})
    `;
  }
  for (const [patientId, entries] of Object.entries(checkins)) {
    for (const entry of entries) {
      await sql`
        INSERT INTO checkins (patient_id, date, data)
        VALUES (${patientId}, ${entry.date}, ${JSON.stringify(entry)}::jsonb)
      `;
    }
  }
  console.log(`Seeded ${patients.length} patients and their check-ins.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
