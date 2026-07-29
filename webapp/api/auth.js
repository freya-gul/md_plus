import { loginCookie } from "../shared/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.APP_PASSWORD) {
    res.status(500).json({ error: "APP_PASSWORD is not configured" });
    return;
  }

  const { password } = req.body || {};
  if (password !== process.env.APP_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  res.setHeader("Set-Cookie", loginCookie(req));
  res.status(200).json({ ok: true });
}
