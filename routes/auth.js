const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

// 🔑 SIGNUP
router.post("/signup", async (req, res) => {
  try {
    const { fullname, barangay, batchYear, email, password } = req.body;

    // check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ msg: "Email already registered" });

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      fullname,
      barangay,
      batchYear,
      email,
      password: hashedPassword
    });

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

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    // create JWT
    const token = jwt.sign({ id: user._id }, "SECRET_KEY", { expiresIn: "1h" });

    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax", // allows sending cookie on refresh & navigation
      secure: process.env.NODE_ENV === "production", // true in production
      maxAge: 60 * 60 * 1000 // 1 hour
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
