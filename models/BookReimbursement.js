const mongoose = require("mongoose");

const bookHistorySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  action: { type: String, required: true },   // "Set Budget" | "Reimbursed" | "Reset"
  amount: { type: Number, default: 0 },       // amount used in the action
  remaining: { type: Number, default: 0 },    // remaining after the action
  by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { _id: false });

const BookReimbursementSchema = new mongoose.Schema(
  {
    // Always reference the User, then denormalize fullname & batchYear for fast reads
    scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fullname: { type: String, required: true },
    batchYear: { type: String }, // keep as string to match your User usage
    allottedBudget: { type: Number, default: 0, min: 0 },
    totalReimbursed: { type: Number, default: 0, min: 0 },
    history: { type: [bookHistorySchema], default: [] },
  },
  { timestamps: true, collection: "bookreimbursements" }
);

// convenience (virtual) – not stored, but handy if you ever fetch the doc alone
BookReimbursementSchema.virtual("remaining").get(function () {
  return (this.allottedBudget || 0) - (this.totalReimbursed || 0);
});

module.exports = mongoose.model("BookReimbursement", BookReimbursementSchema);
