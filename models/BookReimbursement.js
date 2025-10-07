const mongoose = require("mongoose");

const BookReimbursementSchema = new mongoose.Schema(
  {
    // Always reference the User, then denormalize fullname & batchYear for fast reads
    scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fullname: { type: String, required: true },
    batchYear: { type: String }, // keep as string to match your User usage
    allottedBudget: { type: Number, default: 0, min: 0 },
    totalReimbursed: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true, collection: "bookreimbursements" }
);

// convenience (virtual) – not stored, but handy if you ever fetch the doc alone
BookReimbursementSchema.virtual("remaining").get(function () {
  return (this.allottedBudget || 0) - (this.totalReimbursed || 0);
});

module.exports = mongoose.model("BookReimbursement", BookReimbursementSchema);
