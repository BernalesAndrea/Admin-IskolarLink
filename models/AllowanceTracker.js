const mongoose = require("mongoose");

const allowanceTrackerSchema = new mongoose.Schema(
  {
    // Reference the scholar in Users
    scholar: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true
    },
    allottedBudget: { type: Number, default: 0 },
    totalGiven: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("AllowanceTracker", allowanceTrackerSchema);
