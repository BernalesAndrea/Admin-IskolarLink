const mongoose = require("mongoose");

const allowanceHistorySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },       // when the action happened
  action: { type: String, required: true },       // "Set Budget" | "Given" | "Reset"
  amount: { type: Number, default: 0 },           // amount used in the action
  remaining: { type: Number, default: 0 },        // remaining balance AFTER the action
  by: {                                           // who performed it (admin id, optional)
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { _id: false });

const allowanceTrackerSchema = new mongoose.Schema(
  {
    // Reference the scholar in Users
    scholar: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
    },
    allottedBudget: { type: Number, default: 0 },
    totalGiven: { type: Number, default: 0 },
    history: { type: [allowanceHistorySchema], default: [] }, 
  },
  { timestamps: true }
);

module.exports = mongoose.model("AllowanceTracker", allowanceTrackerSchema);
