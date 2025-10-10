// routes/book.js
const express = require("express");
const router = express.Router();

const User = require("../models/User");
const BookReimbursement = require("../models/BookReimbursement");

/* ============= HELPERS ============= */
// Ensure every verified scholar has a BookReimbursement doc
async function ensureBookReimbDocsForVerified() {
  const verified = await User.find({ role: "scholar", verified: true })
    .select("_id fullname batchYear")
    .lean();

  if (!verified.length) return;

  const existing = await BookReimbursement.find({
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

  if (toInsert.length) await BookReimbursement.insertMany(toInsert);
}

/* ============= ROUTES (RELATIVE PATHS) ============= */
/**
 * NOTE:
 * In server.js you should mount like:
 *   app.use("/api/book", authMiddleware, bookRoutes);
 * So every path here is relative to /api/book and you do NOT call authMiddleware again.
 */

// GET /api/book
router.get("/", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    await ensureBookReimbDocsForVerified();

    const scholars = await User.find({ role: "scholar", verified: true })
      .select("_id fullname batchYear")
      .sort({ fullname: 1 })
      .lean();

    const map = new Map(
      (await BookReimbursement.find({ scholar: { $in: scholars.map(s => s._id) } })
        .select("scholar allottedBudget totalReimbursed updatedAt")
        .lean()).map(t => [String(t.scholar), t])
    );

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
    console.error("GET /api/book error:", err);
    res.status(500).json({ msg: "Error fetching book reimbursements", error: err.message });
  }
});

// PUT /api/book/:userId/budget
router.put("/:userId/budget", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const { userId } = req.params;
    const { allottedBudget } = req.body;

    const amount = Number(allottedBudget);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ msg: "Invalid allottedBudget" });
    }

    const u = await User.findOne({ _id: userId, role: "scholar", verified: true })
      .select("_id fullname batchYear");
    if (!u) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await BookReimbursement.findOneAndUpdate(
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

    // history
    await BookReimbursement.updateOne(
      { _id: updated._id },
      {
        $push: {
          history: {
            date: new Date(),
            action: "Set Budget",
            amount: amount,
            remaining,
            by: req.user.id
          }
        }
      }
    );

    res.json({ msg: "Budget updated", tracker: { ...updated.toObject(), remaining } });
  } catch (err) {
    console.error("PUT /api/book/:userId/budget error:", err);
    res.status(500).json({ msg: "Failed to update budget", error: err.message });
  }
});

// PUT /api/book/:userId/reimburse
router.put("/:userId/reimburse", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const { userId } = req.params;
    const { addAmount } = req.body;

    const inc = Number(addAmount);
    if (!Number.isFinite(inc) || inc <= 0) {
      return res.status(400).json({ msg: "Invalid addAmount" });
    }

    const u = await User.findOne({ _id: userId, role: "scholar", verified: true })
      .select("_id fullname batchYear");
    if (!u) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await BookReimbursement.findOneAndUpdate(
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

    // history
    await BookReimbursement.updateOne(
      { _id: updated._id },
      {
        $push: {
          history: {
            date: new Date(),
            action: "Reimbursed",
            amount: inc,
            remaining,
            by: req.user.id
          }
        }
      }
    );

    res.json({ msg: "Reimbursed", tracker: { ...updated.toObject(), remaining } });
  } catch (err) {
    console.error("PUT /api/book/:userId/reimburse error:", err);
    res.status(500).json({ msg: "Failed to reimburse", error: err.message });
  }
});

// PUT /api/book/:userId/reset
router.put("/:userId/reset", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const { userId } = req.params;

    const u = await User.findOne({ _id: userId, role: "scholar", verified: true })
      .select("_id");
    if (!u) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const updated = await BookReimbursement.findOneAndUpdate(
      { scholar: u._id },
      { $set: { allottedBudget: 0, totalReimbursed: 0 } },
      { upsert: true, new: true }
    );

    // history (remaining = 0)
    await BookReimbursement.updateOne(
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

    res.json({ msg: "Book reimbursement reset to zero", tracker: updated });
  } catch (err) {
    console.error("PUT /api/book/:userId/reset error:", err);
    res.status(500).json({ msg: "Failed to reset book reimbursement", error: err.message });
  }
});

// GET /api/book/:userId/history
router.get("/:userId/history", async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const { userId } = req.params;
    const u = await User.findOne({ _id: userId, role: "scholar", verified: true }).select("_id");
    if (!u) return res.status(404).json({ msg: "Scholar not found or not verified" });

    const doc = await BookReimbursement.findOne({ scholar: u._id })
      .select("history")
      .populate("history.by", "fullname")
      .lean();

    const history = (doc?.history || []).sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(history);
  } catch (err) {
    console.error("GET /api/book/:userId/history error:", err);
    res.status(500).json({ msg: "Error fetching reimbursement history", error: err.message });
  }
});

module.exports = router;
