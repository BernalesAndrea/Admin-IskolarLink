const express = require("express");
const router = express.Router();

const User = require("../models/User");
const TuitionTracker = require("../models/TuitionTracker");

// helper for remaining budget
const computeRemaining = (budget = 0, paid = 0) => budget - paid;


// ✨ helper: append a history record
async function pushHistory(trackerDoc, action, amount) {
  const budget = trackerDoc.allottedBudget || 0;
  const paid   = trackerDoc.totalPaid || 0;
  const remaining = computeRemaining(budget, paid);

  // push (don’t await save twice if caller will save anyway)
  await TuitionTracker.updateOne(
    { _id: trackerDoc._id },
    { $push: { history: { date: new Date(), action, amount: Number(amount) || 0, remaining } } }
  );
}

/** Require admin (authMiddleware should have set req.user) */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ msg: "Access denied" });
  }
  next();
}

/** Ensure every verified scholar has a tuitiontracker doc */
async function ensureTuitionDocsForVerified() {
  const verified = await User.find({ role: "scholar", verified: true })
    .select("_id fullname batchYear")
    .lean();

  if (!verified.length) return;

  const existing = await TuitionTracker.find({
    scholar: { $in: verified.map(v => v._id) }
  })
    .select("scholar")
    .lean();

  const have = new Set(existing.map(e => String(e.scholar)));

  const toInsert = verified
    .filter(u => !have.has(String(u._id)))
    .map(u => ({
      scholar: u._id,
      fullname: u.fullname,
      batchYear: u.batchYear || "",
      allottedBudget: 0,
      totalPaid: 0,
    }));

  if (toInsert.length) await TuitionTracker.insertMany(toInsert);
}

/** GET /api/tuition  -> merged snapshot for admin table */
router.get("/", requireAdmin, async (req, res) => {
  try {
    await ensureTuitionDocsForVerified();

    const scholars = await User.find({ role: "scholar", verified: true })
      .select("_id fullname batchYear")
      .sort({ fullname: 1 })
      .lean();

    const trackers = await TuitionTracker.find({
      scholar: { $in: scholars.map(s => s._id) }
    })
      .select("scholar allottedBudget totalPaid updatedAt") // 👈 include
      .lean();

    const map = new Map(trackers.map(t => [String(t.scholar), t]));

    const merged = scholars.map(s => {
      const t = map.get(String(s._id)) || { allottedBudget: 0, totalPaid: 0,};
      const budget = t.allottedBudget || 0;
      const paid = t.totalPaid || 0;
      const remaining = computeRemaining(budget, paid);

      return {
        _id: String(s._id),
        fullname: s.fullname,
        batchYear: s.batchYear || "",
        allottedBudget: budget,
        totalPaid: paid,
        remaining,
        updatedAt: t.updatedAt || null
      };
    });

    res.json(merged);
  } catch (err) {
    console.error("GET /api/tuition error:", err);
    res.status(500).json({ msg: "Error fetching tuition tracker", error: err.message });
  }
});


/** PUT /api/tuition/:userId/budget  -> set allottedBudget */
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

    const updated = await TuitionTracker.findOneAndUpdate(
      { scholar: u._id },
      {
        $set: {
          scholar: u._id,
          fullname: u.fullname,
          batchYear: u.batchYear || "",
          allottedBudget: amount
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ✨ log history
    await pushHistory(updated, "Set Budget", amount);

    const budget = updated.allottedBudget || 0;
    const paid = updated.totalPaid || 0;
    const remaining = computeRemaining(budget, paid);

    res.json({ msg: "Budget updated", tracker: { ...updated.toObject(), remaining } });
  } catch (err) {
    console.error("PUT /api/tuition/:userId/budget error:", err);
    res.status(500).json({ msg: "Failed to update budget", error: err.message });
  }
});



/** PUT /api/tuition/:userId/pay  -> increment totalPaid */
router.put("/:userId/pay", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const inc = Number(req.body.addAmount);
    if (!Number.isFinite(inc) || inc <= 0) {
      return res.status(400).json({ msg: "Invalid addAmount" });
    }

    const u = await User.findOne({ _id: userId, role: "scholar", verified: true })
      .select("_id fullname batchYear");
    if (!u) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await TuitionTracker.findOneAndUpdate(
      { scholar: u._id },
      {
        $setOnInsert: {
          scholar: u._id,
          fullname: u.fullname,
          batchYear: u.batchYear || "",
          allottedBudget: 0,
        },
        $inc: { totalPaid: inc }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ✨ log history
    await pushHistory(updated, "Pay", inc);

    const budget = updated.allottedBudget || 0;
    const paid = updated.totalPaid || 0;
    const remaining = computeRemaining(budget, paid);

    res.json({ msg: "Payment recorded", tracker: { ...updated.toObject(), remaining } });
  } catch (err) {
    console.error("PUT /api/tuition/:userId/pay error:", err);
    res.status(500).json({ msg: "Failed to record payment", error: err.message });
  }
});


/** PUT /api/tuition/:userId/reset  -> zero out fields */
router.put("/:userId/reset", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const u = await User.findOne({ _id: userId, role: "scholar", verified: true })
      .select("_id fullname batchYear");
    if (!u) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await TuitionTracker.findOneAndUpdate(
      { scholar: u._id },
      { $set: { allottedBudget: 0, totalPaid: 0,} },
      { upsert: true, new: true }
    );

    // ✨ log history
    await pushHistory(updated, "Reset", 0);

    res.json({ msg: "Tuition tracker reset to zero", tracker: updated });
  } catch (err) {
    console.error("PUT /api/tuition/:userId/reset error:", err);
    res.status(500).json({ msg: "Failed to reset tuition tracker", error: err.message });
  }
});

// GET /api/tuition/:userId/history  -> newest first
router.get("/:userId/history", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const t = await TuitionTracker.findOne({ scholar: userId })
      .select("history")
      .lean();

    const rows = (t?.history || []).sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /api/tuition/:userId/history error:", err);
    res.status(500).json({ msg: "Error fetching tuition history", error: err.message });
  }
});



module.exports = router;
