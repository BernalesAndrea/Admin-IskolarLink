// routes/allowances.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const User = require("../models/User");
const AllowanceTracker = require("../models/AllowanceTracker");

// ============ HELPERS ============
async function ensureAllowanceDocsForVerified() {
  const verified = await User.find({ role: "scholar", verified: true }).select("_id");
  const ids = verified.map(s => s._id);

  const existing = await AllowanceTracker.find({ scholar: { $in: ids } }).select("scholar");
  const have = new Set(existing.map(e => String(e.scholar)));

  const toInsert = ids
    .filter(id => !have.has(String(id)))
    .map(id => ({ scholar: id, allottedBudget: 0, totalGiven: 0 }));

  if (toInsert.length) await AllowanceTracker.insertMany(toInsert);
}

// ============ ROUTES ============
// GET /api/allowances
// Admin only: list verified scholars + their allowance tracker
router.get("/", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    await ensureAllowanceDocsForVerified();

    const scholars = await User.find({ role: "scholar", verified: true })
      .select("_id fullname batchYear")
      .sort({ fullname: 1 })
      .lean();

    const ids = scholars.map(s => s._id);
    const trackers = await AllowanceTracker.find({ scholar: { $in: ids } })
      .select("scholar allottedBudget totalGiven updatedAt")
      .lean();

    const map = new Map(trackers.map(t => [String(t.scholar), t]));
    const merged = scholars.map(s => {
      const t = map.get(String(s._id)) || { allottedBudget: 0, totalGiven: 0 };
      const remaining = (t.allottedBudget || 0) - (t.totalGiven || 0);
      return {
        _id: String(s._id),
        fullname: s.fullname,
        batchYear: s.batchYear,
        allottedBudget: t.allottedBudget || 0,
        totalGiven: t.totalGiven || 0,
        remaining,
        updatedAt: t.updatedAt || null
      };
    });

    res.json(merged);
  } catch (err) {
    console.error("GET /api/allowances error:", err);
    res.status(500).json({ msg: "Error fetching allowances", error: err.message });
  }
});

// PUT /api/allowances/:userId/budget
router.put("/:userId/budget", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });
    const { userId } = req.params;
    const { allottedBudget } = req.body;

    if (typeof allottedBudget !== "number" || Number.isNaN(allottedBudget) || allottedBudget < 0) {
      return res.status(400).json({ msg: "Invalid allottedBudget" });
    }

    const scholar = await User.findOne({ _id: userId, role: "scholar", verified: true }).select("_id");
    if (!scholar) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await AllowanceTracker.findOneAndUpdate(
      { scholar: scholar._id },
      { $set: { allottedBudget } },
      { upsert: true, new: true }
    );

    const remaining = (updated.allottedBudget || 0) - (updated.totalGiven || 0);

    await AllowanceTracker.updateOne(
      { _id: updated._id },
      {
        $push: {
          history: {
            date: new Date(),
            action: "Set Budget",
            amount: allottedBudget,
            remaining,
            by: req.user.id
          }
        }
      }
    );

    res.json({ msg: "Budget updated", tracker: updated });
  } catch (err) {
    console.error("PUT /api/allowances/:userId/budget error:", err);
    res.status(500).json({ msg: "Failed to update budget", error: err.message });
  }
});

// PUT /api/allowances/:userId/given
router.put("/:userId/given", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const { userId } = req.params;
    const { addAmount } = req.body;

    const inc = Number(addAmount);
    if (!Number.isFinite(inc) || inc <= 0) {
      return res.status(400).json({ msg: "Invalid addAmount" });
    }

    const scholar = await User.findOne({ _id: userId, role: "scholar", verified: true }).select("_id");
    if (!scholar) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await AllowanceTracker.findOneAndUpdate(
      { scholar: scholar._id },
      { 
        $inc: { totalGiven: inc },
        $setOnInsert: { allottedBudget: 0 }
      },
      { upsert: true, new: true }
    );

    const remaining = (updated.allottedBudget || 0) - (updated.totalGiven || 0);

    await AllowanceTracker.updateOne(
      { _id: updated._id },
      {
        $push: {
          history: {
            date: new Date(),
            action: "Given",
            amount: inc,
            remaining,
            by: req.user.id
          }
        }
      }
    );

    res.json({ msg: "Amount given recorded", tracker: updated });
  } catch (err) {
    console.error("PUT /api/allowances/:userId/given error:", err);
    res.status(500).json({ msg: "Failed to update total given", error: err.message });
  }
});

// PUT /api/allowances/:userId/reset
router.put("/:userId/reset", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const { userId } = req.params;

    const scholar = await User.findOne({ _id: userId, role: "scholar", verified: true }).select("_id");
    if (!scholar) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await AllowanceTracker.findOneAndUpdate(
      { scholar: scholar._id },
      { $set: { allottedBudget: 0, totalGiven: 0 } },
      { upsert: true, new: true }
    );

    await AllowanceTracker.updateOne(
      { _id: updated._id },
      {
        $push: {
          history: {
            date: new Date(),
            action: "Reset",
            amount: 0,
            remaining: 0,
            by: req.user.id
          }
        }
      }
    );

    res.json({ msg: "Allowance reset to zero", tracker: updated });
  } catch (err) {
    console.error("PUT /api/allowances/:userId/reset error:", err);
    res.status(500).json({ msg: "Failed to reset allowance", error: err.message });
  }
});

// GET /api/allowances/:userId/history
router.get("/:userId/history", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const { userId } = req.params;
    const scholar = await User.findOne({ _id: userId, role: "scholar", verified: true }).select("_id");
    if (!scholar) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const doc = await AllowanceTracker.findOne({ scholar: scholar._id })
      .select("history")
      .populate("history.by", "fullname")
      .lean();

    const history = (doc?.history || []).sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(history);
  } catch (err) {
    console.error("GET /api/allowances/:userId/history error:", err);
    res.status(500).json({ msg: "Error fetching allowance history", error: err.message });
  }
});

module.exports = router;
