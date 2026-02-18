// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

// ---- shared JWT config (mirrors server.js) ----
const TOKEN_TTL = `${process.env.TOKEN_TTL_HOURS || 1}h`;
const JWT_ISSUER = process.env.JWT_ISSUER || undefined;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || undefined;
const JWT_ALG = process.env.JWT_ALG || "HS256";
const JWT_PRIMARY = process.env.JWT_SECRET_PRIMARY || process.env.JWT_SECRET;

function signJwt(payload, opts = {}) {
  return jwt.sign(payload, JWT_PRIMARY, {
    ...opts,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: JWT_ALG,
  });
}

// ---------- SIGNUP ----------
router.post("/signup", async (req, res) => {
  try {
    const { fullname, barangay, batchYear, email, password } = req.body;

    const normEmail = String(email || "").trim().toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail);

    if (!fullname || !barangay || !batchYear || !normEmail || !password) {
      return res.status(400).json({ msg: "Please complete all fields" });
    }
    if (!emailOk) return res.status(400).json({ msg: "Please enter a valid email address" });

    const exists = await User.findOne({ email: normEmail }).lean();
    if (exists) return res.status(400).json({ msg: "Email already registered" });

    const hashed = await bcrypt.hash(password, 10);
    await User.create({
      fullname,
      barangay,
      batchYear,
      email: normEmail,
      password: hashed,
      role: "scholar",
      verified: false,
    });

    return res.json({ msg: "Registration successful! Await admin verification." });
  } catch (err) {
    console.error("POST /auth/signup error:", err);
    return res.status(500).json({ msg: "Error creating user", error: err.message });
  }
});

// ---------- LOGIN ----------
router.post("/login", async (req, res) => {
  try {
    const normEmail = String(req.body?.email || "").trim().toLowerCase();
    const { password } = req.body;

    const user = await User.findOne({ email: normEmail });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ msg: "Invalid credentials" });

    // block unverified scholars
    if (user.role === "scholar" && !user.verified) {
      return res.status(403).json({ msg: "Your account is awaiting admin verification." });
    }

    const token = signJwt({ id: user._id, role: user.role }, { expiresIn: TOKEN_TTL });

    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000,
    };

    if (user.role === "admin") res.cookie("adminToken", token, cookieOpts);
    if (user.role === "scholar") res.cookie("scholarToken", token, cookieOpts);

    return res.json({
      msg: "Login successful",
      redirect: user.role === "admin" ? "/admin" : "/scholar",
      userId: user._id.toString(),
      role: user.role,
    });
  } catch (err) {
    console.error("POST /auth/login error:", err);
    return res.status(500).json({ msg: "Server error" });
  }
});

// ---------- FORGOT: check if email exists ----------
router.post("/forgot-check", async (req, res) => {
  try {
    const normEmail = String(req.body?.email || "").trim().toLowerCase();
    if (!normEmail) return res.status(400).json({ msg: "Email is required" });

    const found = await User.exists({ email: normEmail });
    if (!found) return res.status(404).json({ msg: "Email does not exist" });
    return res.json({ msg: "Email found" });
  } catch (err) {
    console.error("POST /auth/forgot-check error:", err);
    return res.status(500).json({ msg: "Server error" });
  }
});

// ---------- RESET PASSWORD (demo/no token) ----------
router.post("/reset-password", async (req, res) => {
  try {
    const { email, password } = req.body; // FIX: actually read password
    const normEmail = String(email || "").trim().toLowerCase();

    if (!normEmail || !password) {
      return res.status(400).json({ msg: "Email and password are required" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ msg: "Password must be at least 8 characters" });
    }

    const user = await User.findOne({ email: normEmail });
    if (!user) return res.status(404).json({ msg: "Email does not exist" });

    user.password = await bcrypt.hash(password, 10);
    await user.save();

    // clear any possible cookies
    const base = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" };
    res.clearCookie("scholarToken", base);
    res.clearCookie("adminToken", base);

    return res.json({ msg: "Password updated. You can now sign in." });
  } catch (err) {
    console.error("POST /auth/reset-password error:", err);
    return res.status(500).json({ msg: "Server error" });
  }
});

// ---------- LOGOUT ----------
router.post("/logout", (req, res) => {
  const base = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" };
  res.clearCookie("scholarToken", base);
  res.clearCookie("adminToken", base);
  return res.json({ msg: "Logged out successfully", redirect: "/" });
});

module.exports = router;
