const mongoose = require("mongoose");

const TuitionTrackerSchema = new mongoose.Schema(
  {
    scholar:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, unique: true },
    fullname:       { type: String, required: true },
    batchYear:      { type: String },
    allottedBudget: { type: Number, default: 0, min: 0 },
    totalPaid:      { type: Number, default: 0, min: 0 },
    totalReimbursed:{ type: Number, default: 0, min: 0 },

    // ✨ NEW: simple embedded history log
    history: [{
      date: { type: Date, default: Date.now, index: true },
      action: { type: String, required: true },    // "Set Budget" | "Pay" | "Reimburse" | "Reset"
      amount: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 }
    }]
  },
  { timestamps: true, collection: "tuitiontracker" }
);

TuitionTrackerSchema.virtual("remaining").get(function () {
  const budget = this.allottedBudget || 0;
  const paid = this.totalPaid || 0;
  const reimb = this.totalReimbursed || 0;
  return budget - (paid + reimb);
});

module.exports = mongoose.model("TuitionTracker", TuitionTrackerSchema);
