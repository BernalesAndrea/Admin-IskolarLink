// routes/users.js
const express = require("express");
const router = express.Router();
const User = require("../models/User");

// Helper to escape regex
function escapeRegex(str = "") {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/users/search?query=...
// - If query length === 1: search for names/emails that START with that char
// - Else: search anywhere (case-insensitive)
// Returns: [{ _id, fullname, email, role }, ...]
router.get("/search", async (req, res) => {
  try {
    const qRaw = (req.query.query || "").trim();
    if (!qRaw) return res.json([]);

    const q = escapeRegex(qRaw);
    const isSingle = q.length === 1;

    const filter = isSingle
      ? {
          $or: [
            { fullname: { $regex: "^" + q, $options: "i" } },
            { email: { $regex: "^" + q, $options: "i" } }
          ]
        }
      : {
          $or: [
            { fullname: { $regex: q, $options: "i" } },
            { email: { $regex: q, $options: "i" } }
          ]
        };

    const users = await User.find(filter)
      .select("_id fullname email role")
      .sort({ fullname: 1 })
      .limit(100); // safe upper bound

    res.json(users);
  } catch (err) {
    console.error("users.search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/users/list/:id
// Returns up to 10 users (exclude :id) to populate initial dropdown
router.get("/list/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const users = await User.find({ _id: { $ne: id } })
      .select("_id fullname email role")
      .sort({ fullname: 1 })
      .limit(10);
    res.json(users);
  } catch (err) {
    console.error("users.list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
