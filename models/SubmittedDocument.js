// models/SubmittedDocument.js
const mongoose = require("mongoose");

const submittedDocumentSchema = new mongoose.Schema(
  {
    scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    fullname: { type: String, required: true },
    batchYear: { type: String, required: true },

    docType: { type: String, required: true },

    // ✅ GridFS fields you actually save
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    bucket: { type: String, enum: ["submittedDocs"], required: true },

    status: { type: String, enum: ["Pending", "Accepted", "Rejected"], default: "Pending" },
  },
  { timestamps: true } // gives createdAt for sorting
);

module.exports = mongoose.model("SubmittedDocument", submittedDocumentSchema);
