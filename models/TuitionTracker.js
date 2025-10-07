const mongoose = require("mongoose");

const TuitionTrackerSchema = new mongoose.Schema(
  {
    scholar:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, unique: true },
    fullname:       { type: String, required: true },
    batchYear:      { type: String }, // keep string like elsewhere
    allottedBudget: { type: Number, default: 0, min: 0 },
    totalPaid:      { type: Number, default: 0, min: 0 }
  },
  { timestamps: true, collection: "tuitiontracker" } // <-- collection name exactly as requested
);

TuitionTrackerSchema.virtual("remaining").get(function () {
  return (this.allottedBudget || 0) - (this.totalPaid || 0);
});

module.exports = mongoose.model("TuitionTracker", TuitionTrackerSchema);
