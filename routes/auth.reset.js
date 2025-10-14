// routes/auth.reset.js
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const PasswordResetToken = require("../models/PasswordResetToken");
const { send, renderTemplate } = require("../services/mailer");

const router = express.Router();

function appOrigin() {
  // Where your reset page lives (front-end). Override in .env if different.
  return (
    process.env.APP_ORIGIN ||
    process.env.PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 3000}`
  );
}

const RESET_PATH = process.env.RESET_PATH || "/reset.html";

/** 1) Request a reset link (always 200 to avoid account enumeration) */
router.post("/forgot-password", async (req, res) => {
  try {
    const emailRaw = (req.body.email || "").trim();
    const email = emailRaw.toLowerCase();
    if (!email) return res.json({ ok: true }); // don't reveal

    const user = await User.findOne({ email }).select("_id email fullname").lean();
    // Always respond 200, but only proceed if user exists
    if (user) {
      // optional: throttle by checking a recent token (5 min)
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recent = await PasswordResetToken.findOne({ userId: user._id, createdAt: { $gt: fiveMinAgo } })
        .select("_id createdAt")
        .lean();
      if (!recent) {
        // Generate token
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        await PasswordResetToken.create({
          userId: user._id,
          tokenHash,
          expiresAt,
          ip: req.ip,
          ua: req.get("user-agent") || "",
        });

        const resetUrl = `${appOrigin()}${RESET_PATH}?token=${encodeURIComponent(token)}`;

        const html = renderTemplate({
          title: "Reset your IskolarLink password",
          intro: `Hello${user.fullname ? " " + user.fullname : ""},`,
          bodyHtml: `
            <p>We received a request to reset your IskolarLink password.</p>
            <p>Click the button below to set a new password. This link expires in <b>15 minutes</b> and can be used only once.</p>
          `,
          cta: { url: resetUrl, label: "Reset password" },
          footerNote:
            "If you didn’t request this, you can safely ignore this email—your password will remain unchanged.",
        });

        await send({
          to: user.email,
          subject: "Reset your IskolarLink password",
          html,
        });
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    // Still hide details to prevent enumeration
    return res.json({ ok: true });
  }
});

/** 2) Reset password with token */
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ ok: false, msg: "Token and new password are required." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ ok: false, msg: "Password must be at least 8 characters." });
    }

    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");

    // Find a valid, unused token
    const prt = await PasswordResetToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!prt) return res.status(400).json({ ok: false, msg: "Invalid or expired token." });

    const user = await User.findById(prt.userId);
    if (!user) return res.status(400).json({ ok: false, msg: "Invalid token." });

    // Update password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(String(password), salt);

    // (Optional) bump token version to invalidate existing JWTs, if you use them
    if (user.tokenVersion != null) user.tokenVersion += 1;

    await user.save();

    // Mark this token as used and (optional) delete other outstanding tokens
    prt.usedAt = new Date();
    await prt.save();
    await PasswordResetToken.deleteMany({ userId: user._id, usedAt: null, _id: { $ne: prt._id } });

    return res.json({ ok: true, msg: "Password updated. You can now sign in." });
  } catch (e) {
    return res.status(500).json({ ok: false, msg: "Something went wrong." });
  }
});

module.exports = router;
