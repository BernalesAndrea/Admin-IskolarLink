const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  barangay: { type: String, required: true },
  batchYear: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "scholar"},
  verified: { type: Boolean, default: false } // for admin verification later
});

module.exports = mongoose.model("User", UserSchema);
