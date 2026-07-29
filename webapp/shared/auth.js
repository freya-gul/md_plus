import crypto from "node:crypto";

const COOKIE_NAME = "md_plus_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function sessionToken() {
  return crypto.createHmac("sha256", process.env.APP_PASSWORD || "").update("authenticated").digest("hex");
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const idx = p.indexOf("=");
        return [p.slice(0, idx), decodeURIComponent(p.slice(idx + 1))];
      })
  );
}

function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https";
}

export function isAuthenticated(req) {
  if (!process.env.APP_PASSWORD) return false;
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[COOKIE_NAME] === sessionToken();
}

export function loginCookie(req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `${COOKIE_NAME}=${sessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`;
}

export function requireAuth(req, res) {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}
