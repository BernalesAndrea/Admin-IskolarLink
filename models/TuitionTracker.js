const mongoose = require("mongoose");

const TuitionTrackerSchema = new mongoose.Schema(
  {
    scholar:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, unique: true },
    fullname:       { type: String, required: true },
    batchYear:      { type: String },
    allottedBudget: { type: Number, default: 0, min: 0 },
    totalPaid:      { type: Number, default: 0, min: 0 },

    // History: "Set Budget" | "Pay" | "Reset"
    history: [{
      date: { type: Date, default: Date.now, index: true },
      action: { type: String, required: true },
      amount: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 }
    }]
  },
  { timestamps: true, collection: "tuitiontracker" }
);

TuitionTrackerSchema.virtual("remaining").get(function () {
  const budget = this.allottedBudget || 0;
  const paid   = this.totalPaid || 0;
  return budget - paid;
});

module.exports = mongoose.model("TuitionTracker", TuitionTrackerSchema);
