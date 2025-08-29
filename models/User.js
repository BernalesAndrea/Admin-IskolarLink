const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  barangay: { type: String, required: true },
  batchYear: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin", "scholar"], default: "scholar" }
});
const User = mongoose.model('User', userSchema);
