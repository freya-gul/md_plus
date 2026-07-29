import { sql } from "../shared/db.js";
import { requireAuth } from "../shared/auth.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method === "POST") {
    const { patientId, entry } = req.body || {};
    if (!patientId || !entry) {
      res.status(400).json({ error: "patientId and entry are required" });
      return;
    }
    const rows = await sql`
      INSERT INTO checkins (patient_id, date, data)
      VALUES (${patientId}, ${entry.date}, ${JSON.stringify(entry)}::jsonb)
      RETURNING data
    `;
    res.status(201).json({ checkin: rows[0].data });
    return;
  }

  if (req.method === "PATCH") {
    const { patientId, editingDate, epds } = req.body || {};
    if (!patientId || !editingDate || !epds) {
      res.status(400).json({ error: "patientId, editingDate, and epds are required" });
      return;
    }
    const rows = await sql`
      UPDATE checkins SET data = jsonb_set(data, '{epds}', ${JSON.stringify(epds)}::jsonb)
      WHERE patient_id = ${patientId} AND data->'epds'->>'date' = ${editingDate}
      RETURNING data
    `;
    if (!rows.length) {
      res.status(404).json({ error: "Matching check-in not found" });
      return;
    }
    res.status(200).json({ checkin: rows[0].data });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
