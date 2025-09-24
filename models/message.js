const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender_id: { type: String, required: true },   // user’s _id or email
  receiver_id: { type: String, required: true }, // recipient’s _id or email
  message: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Message", messageSchema);