const mongoose = require("mongoose");
const Expense = require("./Expense");

const UserSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  barangay: { type: String, required: true },
  batchYear: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "scholar" },
  verified: { type: Boolean, default: false } // for admin verification later
});

// Automatically create expense record when a scholar is verified
UserSchema.post("findOneAndUpdate", async function (doc) {
  if (!doc) return;

  if (doc.role === "scholar" && doc.verified) {
    const exists = await Expense.findOne({ scholar: doc._id });
    if (!exists) {
      await Expense.create({
        scholar: doc._id,
        tuition: 0,
        bookAllowance: 0,
        monthlyAllowance: 0,
        totalSpent: 0,
        dateModified: new Date()
      });
    }
  }
});

module.exports = mongoose.model("User", UserSchema);
