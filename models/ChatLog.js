const mongoose = require("mongoose");

const chatLogSchema = new mongoose.Schema({
  session_id: { type: String, required: true },
  chatContent: { type: String, default: "" }, // stores the innerHTML of the chat div
  savedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("ChatLog", chatLogSchema);
