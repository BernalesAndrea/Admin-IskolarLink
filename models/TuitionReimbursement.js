const mongoose = require("mongoose");

const TuitionReimbursementSchema = new mongoose.Schema(
  {
    scholar:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fullname:  { type: String, required: true },
    batchYear: { type: String }, // keep string (same as BookReimbursement)
    allottedBudget:   { type: Number, default: 0, min: 0 },
    totalReimbursed:  { type: Number, default: 0, min: 0 }
  },
  { timestamps: true, collection: "tuitionreimbursement" } // <-- collection name
);

TuitionReimbursementSchema.virtual("remaining").get(function () {
  return (this.allottedBudget || 0) - (this.totalReimbursed || 0);
});

module.exports = mongoose.model("TuitionReimbursement", TuitionReimbursementSchema);
