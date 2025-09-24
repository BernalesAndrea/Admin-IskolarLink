// routes/messages.js
const express = require("express");
const router = express.Router();
const Message = require("../models/message");
const User = require("../models/User");

// Get conversation between two users by IDs
router.get("/:userId/:chatWith", async (req, res) => {
  try {
    const { userId, chatWith } = req.params;

    const messages = await Message.find({
      $or: [
        { sender_id: userId, receiver_id: chatWith },
        { sender_id: chatWith, receiver_id: userId }
      ]
    }).sort({ created_at: 1 });

    res.json(messages);
  } catch (err) {
    console.error("messages.get error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Send a message (body: { sender_id, receiver_id, message })
router.post("/", async (req, res) => {
  try {
    const { sender_id, receiver_id, message } = req.body;
    if (!sender_id || !receiver_id || !message) {
      return res.status(400).json({ error: "Missing fields" });
    }
    const newMsg = new Message({ sender_id, receiver_id, message });
    await newMsg.save();
    res.json(newMsg);
  } catch (err) {
    console.error("messages.post error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
