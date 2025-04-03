// models/ChatLog.js
const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  sender: { type: String, required: true }, // "user" or "bot"
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const ChatLogSchema = new mongoose.Schema({
  session_id: { type: String, required: true, unique: true },
  userInfo: {
    name: { type: String },
    email: { type: String },
    contact: { type: String },
    address: { type: String }
  },
  messages: [MessageSchema],
  startedAt: { type: Date, default: Date.now },
  closed: { type: Boolean, default: false },
  closedAt: { type: Date }
});

module.exports = mongoose.model("ChatLog", ChatLogSchema);
