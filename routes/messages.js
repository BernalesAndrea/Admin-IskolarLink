// routes/messages.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Message = require("../models/message");
const User = require("../models/User");

const { Types } = mongoose;
const isId = (v) => Types.ObjectId.isValid(v);

// Utility: fetch minimal role info safely
async function getUserRole(_id) {
  if (!isId(_id)) return null;
  const u = await User.findById(_id).select("role").lean();
  return u?.role || null;
}

// SCHOLAR↔ADMIN guard: true if scholar is trying to talk to non-admin
async function isScholarToNonAdmin(userIdA, userIdB) {
  const [roleA, roleB] = await Promise.all([getUserRole(userIdA), getUserRole(userIdB)]);
  // If we can’t resolve roles, do not block (fail-open like the older version)
  if (!roleA || !roleB) return false;
  return roleA === "scholar" && roleB !== "admin";
}

// GET unread count for a user
router.get("/unread-count/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isId(userId)) return res.json({ count: 0 });

    // support legacy messages that may still have receiver_id=email
    const u = await User.findById(userId).select("email").lean();
    const receiverKeys = u?.email ? [userId, u.email] : [userId];

    const count = await Message.countDocuments({
      receiver_id: { $in: receiverKeys },
      read_by: { $ne: userId }
    });

    return res.json({ count });
  } catch (err) {
    console.error("messages.unread-count error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ========================= GET conversation =========================
// GET conversation (paged)
// Query params:
//   limit: number (default 50, max 200)
//   before: ISO timestamp to get older chunks (optional)
router.get("/:userId/:chatWith", async (req, res) => {
  try {
    const { userId, chatWith } = req.params;
    let { limit = 50, before } = req.query;
    limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    if (!isId(userId) || !isId(chatWith)) {
      return res.status(400).json({ error: "Invalid user id(s)." });
    }

    // Enforce Scholar → Admin only (server-side)
    try {
      if (await isScholarToNonAdmin(userId, chatWith)) {
        return res.status(403).json({ error: "Scholars may only chat with admin." });
      }
    } catch {
      // Non-fatal: proceed if role lookup fails (consistent with modified behavior)
    }

    const q = {
      $or: [
        { sender_id: userId, receiver_id: chatWith },
        { sender_id: chatWith, receiver_id: userId }
      ]
    };
    if (before) {
      const dt = new Date(before);
      if (!isNaN(dt.getTime())) q.created_at = { $lt: dt };
    }
    // fetch older first descending, then reverse to ascending on client
    const docs = await Message.find(q)
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();
    const messages = docs.reverse();

    return res.json(messages || []);
  } catch (err) {
    console.error("messages.get error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ========================= POST send message =========================
router.post("/", async (req, res) => {
  try {
    const { sender_id, receiver_id, message } = req.body || {};

    if (!sender_id || !receiver_id || typeof message !== "string") {
      return res.status(400).json({ error: "Missing fields: sender_id, receiver_id, message." });
    }
    if (!isId(sender_id) || !isId(receiver_id)) {
      return res.status(400).json({ error: "Invalid sender or receiver id." });
    }
    const trimmed = message.trim();
    if (!trimmed) {
      return res.status(400).json({ error: "Message must not be empty." });
    }

    // Enforce Scholar → Admin only (server-side)
    try {
      if (await isScholarToNonAdmin(sender_id, receiver_id)) {
        return res.status(403).json({ error: "Scholars may only message the admin." });
      }
    } catch {
      // Non-fatal: proceed if role lookup fails (consistent with modified behavior)
    }

    const newMsg = new Message({
      sender_id,
      receiver_id,
      message: trimmed
    });

    await newMsg.save();
    return res.json(newMsg);
  } catch (err) {
    console.error("messages.post error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});


// POST mark a thread as read
// body: { userId, withUserId }
router.post("/mark-read", async (req, res) => {
  try {
    const { userId, withUserId } = req.body || {};
    if (!userId || !withUserId || !isId(userId) || !isId(withUserId)) {
      return res.status(400).json({ error: "Missing or invalid fields." });
    }
    await Message.updateMany(
      { sender_id: withUserId, receiver_id: userId, read_by: { $ne: userId } },
      { $addToSet: { read_by: userId } }
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("messages.mark-read error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
