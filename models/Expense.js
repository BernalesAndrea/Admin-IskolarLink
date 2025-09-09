const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema({
  scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fullname: { type: String, required: true },
  batchYear: { type: String, required: true },
  tuition: { type: Number, default: 0 },
  bookAllowance: { type: Number, default: 0 },
  monthlyAllowance: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  dateModified: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Expense", expenseSchema);
