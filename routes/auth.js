// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User"); // adjust path if your models folder differs

const router = express.Router();

// 🔑 SIGNUP
router.post("/signup", async (req, res) => {
  try {
    const { fullname, barangay, batchYear, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ msg: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({ fullname, barangay, batchYear, email, password: hashedPassword });
    await newUser.save();

    res.json({ msg: "Registration successful!" });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// 🔑 LOGIN
router.post("/login", async (req, res) => {
  
  try {
    const { email, password } = req.body;
    
    const emailNorm = String(email || "").trim().toLowerCase();
    const user = await User.findOne({ email: emailNorm });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    // Use env secret — set JWT_SECRET_PRIMARY in Render
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET_PRIMARY,
      { expiresIn: process.env.TOKEN_TTL_HOURS ? `${process.env.TOKEN_TTL_HOURS}h` : "1h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: (process.env.TOKEN_TTL_HOURS ? Number(process.env.TOKEN_TTL_HOURS) : 1) * 60 * 60 * 1000
    });

    res.json({
      msg: "Login successful",
      redirect: (user.role === "admin" ? "/admin" : "/scholar"),
      userId: user._id.toString(),
      role: user.role
    });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;
