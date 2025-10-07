const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const User = require("../models/User");
const TuitionReimbursement = require("../models/TuitionReimbursement");

// You already have this in server.js; we’ll accept req.user populated by it.
// If you prefer, you can import and use the same middleware here too:
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ msg: "Access denied" });
  }
  next();
}

// Seed all verified scholars so each has a tracker doc
async function ensureTuitionDocsForVerified() {
  const verified = await User.find({ role: "scholar", verified: true })
    .select("_id fullname batchYear")
    .lean();

  if (!verified.length) return;

  const existing = await TuitionReimbursement.find({
    scholar: { $in: verified.map(v => v._id) }
  }).select("scholar").lean();

  const have = new Set(existing.map(e => String(e.scholar)));

  const toInsert = verified
    .filter(u => !have.has(String(u._id)))
    .map(u => ({
      scholar: u._id,
      fullname: u.fullname,
      batchYear: u.batchYear || "",
      allottedBudget: 0,
      totalReimbursed: 0
    }));

  if (toInsert.length) await TuitionReimbursement.insertMany(toInsert);
}

/**
 * GET /api/tuition
 * Returns merged list of verified scholars + their tuition tracker snapshot
 */
router.get("/", requireAdmin, async (req, res) => {
  try {
    await ensureTuitionDocsForVerified();

    const scholars = await User.find({ role: "scholar", verified: true })
      .select("_id fullname batchYear")
      .sort({ fullname: 1 })
      .lean();

    const trackers = await TuitionReimbursement.find({
      scholar: { $in: scholars.map(s => s._id) }
    })
      .select("scholar allottedBudget totalReimbursed updatedAt")
      .lean();

    const map = new Map(trackers.map(t => [String(t.scholar), t]));

    const merged = scholars.map(s => {
      const t = map.get(String(s._id)) || { allottedBudget: 0, totalReimbursed: 0 };
      const remaining = (t.allottedBudget || 0) - (t.totalReimbursed || 0);
      return {
        _id: String(s._id),
        fullname: s.fullname,
        batchYear: s.batchYear || "",
        allottedBudget: t.allottedBudget || 0,
        totalReimbursed: t.totalReimbursed || 0,
        remaining,
        updatedAt: t.updatedAt || null
      };
    });

    res.json(merged);
  } catch (err) {
    console.error("GET /api/tuition error:", err);
    res.status(500).json({ msg: "Error fetching tuition reimbursements", error: err.message });
  }
});

/**
 * PUT /api/tuition/:userId/budget
 * Sets allottedBudget
 */
router.put("/:userId/budget", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const amount = Number(req.body.allottedBudget);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ msg: "Invalid allottedBudget" });
    }

    const u = await User.findOne({ _id: userId, role: "scholar", verified: true })
      .select("_id fullname batchYear");
    if (!u) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await TuitionReimbursement.findOneAndUpdate(
      { scholar: u._id },
      {
        $set: {
          scholar: u._id,
          fullname: u.fullname,
          batchYear: u.batchYear || "",
          allottedBudget: amount
        }
      },
      { upsert: true, new: true }
    );

    const remaining = (updated.allottedBudget || 0) - (updated.totalReimbursed || 0);
    res.json({ msg: "Budget updated", tracker: { ...updated.toObject(), remaining } });
  } catch (err) {
    console.error("PUT /api/tuition/:userId/budget error:", err);
    res.status(500).json({ msg: "Failed to update budget", error: err.message });
  }
});

/**
 * PUT /api/tuition/:userId/reimburse
 * Increments totalReimbursed by addAmount
 */
router.put("/:userId/reimburse", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const inc = Number(req.body.addAmount);
    if (!Number.isFinite(inc) || inc <= 0) {
      return res.status(400).json({ msg: "Invalid addAmount" });
    }

    const u = await User.findOne({ _id: userId, role: "scholar", verified: true })
      .select("_id fullname batchYear");
    if (!u) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await TuitionReimbursement.findOneAndUpdate(
      { scholar: u._id },
      {
        $setOnInsert: {
          scholar: u._id,
          fullname: u.fullname,
          batchYear: u.batchYear || "",
          allottedBudget: 0
        },
        $inc: { totalReimbursed: inc }
      },
      { upsert: true, new: true }
    );

    const remaining = (updated.allottedBudget || 0) - (updated.totalReimbursed || 0);
    res.json({ msg: "Reimbursed", tracker: { ...updated.toObject(), remaining } });
  } catch (err) {
    console.error("PUT /api/tuition/:userId/reimburse error:", err);
    res.status(500).json({ msg: "Failed to reimburse", error: err.message });
  }
});

/**
 * PUT /api/tuition/:userId/reset
 * Resets both fields to 0
 */
router.put("/:userId/reset", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const u = await User.findOne({ _id: userId, role: "scholar", verified: true })
      .select("_id");
    if (!u) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await TuitionReimbursement.findOneAndUpdate(
      { scholar: u._id },
      { $set: { allottedBudget: 0, totalReimbursed: 0 } },
      { upsert: true, new: true }
    );

    res.json({ msg: "Tuition reimbursement reset to zero", tracker: updated });
  } catch (err) {
    console.error("PUT /api/tuition/:userId/reset error:", err);
    res.status(500).json({ msg: "Failed to reset tuition reimbursement", error: err.message });
  }
});

module.exports = router;
