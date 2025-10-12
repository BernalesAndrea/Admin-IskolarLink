const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender_id: { type: String, required: true },   // user’s _id or email
  receiver_id: { type: String, required: true }, // recipient’s _id or email
  message: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  read_by: {type: [String], default: [] },
});

messageSchema.index({ sender_id: 1, receiver_id: 1, created_at: 1 });
messageSchema.index({ receiver_id: 1, created_at: 1 });

module.exports = mongoose.model("Message", messageSchema);