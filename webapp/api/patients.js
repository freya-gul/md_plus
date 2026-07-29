import { sql } from "../shared/db.js";
import { requireAuth } from "../shared/auth.js";

function toDateOnly(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function rowToPatient(row) {
  return {
    id: row.id,
    name: row.name,
    dob: toDateOnly(row.dob),
    phase: row.phase,
    weekOrDay: row.week_or_day,
    deliveryType: row.delivery_type,
    dueDate: toDateOnly(row.due_date),
    htnHistory: row.htn_history,
    vteHistory: row.vte_history,
    psychHistory: row.psych_history,
    otherDiagnoses: row.other_diagnoses,
    notes: row.notes,
  };
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method === "GET") {
    const patientRows = await sql`SELECT * FROM patients ORDER BY created_at ASC`;
    const checkinRows = await sql`SELECT patient_id, data FROM checkins ORDER BY id ASC`;
    const checkins = {};
    for (const row of checkinRows) {
      (checkins[row.patient_id] ??= []).push(row.data);
    }
    res.status(200).json({ patients: patientRows.map(rowToPatient), checkins });
    return;
  }

  if (req.method === "POST") {
    const p = req.body || {};
    if (!p.name || !p.name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (p.weekOrDay == null || Number.isNaN(Number(p.weekOrDay))) {
      res.status(400).json({ error: "weekOrDay is required" });
      return;
    }
    const id = `p${Date.now()}`;
    const rows = await sql`
      INSERT INTO patients
        (id, name, dob, phase, week_or_day, delivery_type, due_date, htn_history, vte_history, psych_history, other_diagnoses, notes)
      VALUES
        (${id}, ${p.name}, ${p.dob || null}, ${p.phase}, ${p.weekOrDay}, ${p.deliveryType || null}, ${p.dueDate || null},
         ${!!p.htnHistory}, ${!!p.vteHistory}, ${!!p.psychHistory}, ${p.otherDiagnoses || null}, ${p.notes || null})
      RETURNING *
    `;
    res.status(201).json({ patient: rowToPatient(rows[0]) });
    return;
  }

  if (req.method === "PATCH") {
    const { patientId, htnHistory, psychHistory } = req.body || {};
    if (!patientId) {
      res.status(400).json({ error: "patientId is required" });
      return;
    }
    const rows = await sql`
      UPDATE patients SET
        htn_history = COALESCE(${htnHistory ?? null}, htn_history),
        psych_history = COALESCE(${psychHistory ?? null}, psych_history)
      WHERE id = ${patientId}
      RETURNING *
    `;
    if (!rows.length) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }
    res.status(200).json({ patient: rowToPatient(rows[0]) });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
