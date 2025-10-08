const mongoose = require("mongoose");
const Expense = require("./Expense");

const UserSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  barangay: { type: String, required: true },
  batchYear: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "scholar" },
  verified: { type: Boolean, default: false }, // for admin verification later

  scholarType: { type: String, default: "" },
  // type:        { type: String, default: "" },
  rejectionReason: { type: String, default: "" },

  profilePic: { type: String, default: "/assets/default-avatar.png" },
  profilePicId: { type: mongoose.Schema.Types.ObjectId, default: null },
  profilePicBucket: { type: String, default: null },
  course: { type: String, default: "" },
  schoolName: { type: String, default: "" }


});

UserSchema.virtual("profilePicUrl").get(function () {
  if (this.profilePicBucket && this.profilePicId) {
    return `/files/${this.profilePicBucket}/${this.profilePicId}`;
  }
  return this.profilePic || "/assets/default-avatar.png";
});

// Make sure virtuals show up in JSON responses
UserSchema.set("toJSON", { virtuals: true });
UserSchema.set("toObject", { virtuals: true });


// Automatically create expense record when a scholar is verified
UserSchema.post("findOneAndUpdate", async function (doc, next) {
  try {
    if (!doc) return next();

    if (doc.role === "scholar" && doc.verified) {
      // If your Expense schema requires fullname/batchYear, include them.
      await Expense.updateOne(
        { scholar: doc._id },
        {
          $setOnInsert: {
            scholar: doc._id,
            fullname: doc.fullname || "",
            batchYear: doc.batchYear || "",
            tuition: 0,
            bookAllowance: 0,
            monthlyAllowance: 0,
            totalSpent: 0,
            dateModified: new Date(),
            history: [] // include if your schema defines it
          }
        },
        { upsert: true }
      );
    }

    next();
  } catch (e) {
    // Do not break the original update; just log and continue.
    console.warn("User post-update hook (ensure Expense) error:", e.message);
    next(); // swallow to avoid 500 on user update
  }
});

module.exports = mongoose.model("User", UserSchema);
