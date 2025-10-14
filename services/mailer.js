// services/mailer.js
const nodemailer = require("nodemailer");

function envFlag(val, def = false) {
  if (val == null) return def;
  const s = String(val).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function makeTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = envFlag(process.env.SMTP_SECURE, false);

  if (!host || !user || !pass) {
    // Dev fallback: no SMTP configured
    return null;
  }

  const pool = envFlag(process.env.SMTP_POOL, true);
  const maxConnections = parseInt(process.env.SMTP_MAX_CONNECTIONS || "5", 10);
  const maxMessages = parseInt(process.env.SMTP_MAX_MESSAGES || "100", 10);
  const rateDelta = parseInt(process.env.SMTP_RATE_DELTA_MS || "0", 10);
  const rateLimit = parseInt(process.env.SMTP_RATE_LIMIT || "0", 10);

  const transportOpts = {
    host, port, secure,
    auth: { user, pass },
    pool, maxConnections, maxMessages,
  };

  if (rateDelta > 0 && rateLimit > 0) {
    transportOpts.rateDelta = rateDelta;
    transportOpts.rateLimit = rateLimit;
  }

  return nodemailer.createTransport(transportOpts);
}

const transporter = makeTransport();
const FROM = process.env.SMTP_FROM || `"IskolarLink" <no-reply@iskolarlink.local>`;

/** Minimal brandable HTML wrapper */
function renderTemplate({ title = "", intro = "", bodyHtml = "", cta, footerNote } = {}) {
  const brandColor = "#923B3B"; // your maroon
  const btn = cta
    ? `<div style="text-align:center;margin:24px 0">
         <a href="${cta.url}" 
            style="display:inline-block;padding:12px 18px;border-radius:8px;
                   background:${brandColor};color:#fff;text-decoration:none;font-weight:bold">
           ${cta.label}
         </a>
       </div>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:620px;background:#fff;border-radius:16px;overflow:hidden;
             box-shadow:0 6px 24px rgba(0,0,0,.08)" cellspacing="0" cellpadding="0">
        <tr>
          <td style="background:${brandColor};color:#fff;padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold">
            IskolarLink
          </td>
        </tr>
        <tr>
          <td style="padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1d1d1f;font-size:15px;line-height:1.5">
            ${title ? `<h2 style="margin:0 0 8px 0;font-size:20px;color:${brandColor}">${escapeHtml(title)}</h2>` : ""}
            ${intro ? `<p style="margin:0 0 10px 0">${escapeHtml(intro)}</p>` : ""}
            ${bodyHtml || ""}
            ${btn}
            ${footerNote ? `<p style="margin:16px 0 0 0;font-size:12px;color:#6b7280">${escapeHtml(footerNote)}</p>` : ""}
          </td>
        </tr>
        <tr>
          <td style="padding:14px 24px;background:#fafafa;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-size:12px">
            © ${new Date().getFullYear()} IskolarLink — City of Koronadal
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** naive text fallback */
function toText(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Verify connection on startup (logs only) */
async function verifyAndLog() {
  if (!transporter) {
    console.log("📧 Mailer: SMTP not configured. Emails will be logged to console.");
    return false;
  }
  try {
    await transporter.verify();
    console.log("📧 Mailer: SMTP connected and ready.");
    return true;
  } catch (e) {
    console.warn("📧 Mailer: SMTP verify failed ->", e.message);
    return false;
  }
}

/** Send helper (falls back to console log if no SMTP) */
async function send({ to, subject, html, text }) {
  if (!html) html = renderTemplate({ title: subject, bodyHtml: "" });
  if (!text) text = toText(html);

  if (!transporter) {
    console.log("📧 [DEV] Email (not sent) ->", { to, subject, text, htmlSnippet: html.slice(0, 200) + "..." });
    return { devLogged: true };
  }

  return transporter.sendMail({
    from: FROM,
    to,
    subject,
    html,
    text
  });
}

module.exports = {
  send,
  renderTemplate,
  verifyAndLog
};
