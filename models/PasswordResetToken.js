// models/PasswordResetToken.js
const mongoose = require("mongoose");

const PasswordResetTokenSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, index: true },
  expiresAt: { type: Date,   required: true },           // <-- removed index:true
  used:      { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now },
  requestedIp: String,
  userAgent:   String
});

// single TTL index (Mongo will auto-delete when expiresAt < now)
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
PasswordResetTokenSchema.index({ userId: 1, used: 1, expiresAt: 1 });

module.exports = mongoose.model("PasswordResetToken", PasswordResetTokenSchema);
