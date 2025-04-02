const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const callbacks = require("./callback");
const path = require("path");
const mongoose = require("mongoose");
const ChatLog = require("./models/ChatLog");

// -------------------------------
// MongoDB Setup using Mongoose

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/chatbot";
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// -------------------------------
// NLP & Conversation Tree Setup

const { NlpManager } = require("node-nlp");
const manager = new NlpManager({ languages: ['en'] });
const qaTree = JSON.parse(fs.readFileSync("./questions.json", "utf-8"));

// Add FAQ data to NLP manager if available
if (qaTree.faqData && Array.isArray(qaTree.faqData)) {
  qaTree.faqData.forEach((faq, index) => {
    const intent = `faq_${index}`;
    faq.questions.forEach(utterance => {
      manager.addDocument('en', utterance, intent);
    });
    manager.addAnswer('en', intent, faq.answer);
  });
  (async () => {
    await manager.train();
    manager.save();
    console.log("✅ NLP Manager trained and ready.");
  })();
}

// Prepare intent patterns
const intentPatterns = (qaTree.intent_patterns || []).map(p => ({
  pattern: new RegExp(p.pattern, "i"),
  node: p.node
}));

function getIntentNode(message) {
  const msg = message.toLowerCase().replace(/[!?.]/g, "").trim();
  for (let i = 0; i < intentPatterns.length; i++) {
    if (intentPatterns[i].pattern.test(msg)) return intentPatterns[i].node;
  }
  return null;
}

function getNextQuestion(state, userAnswer) {
  const currentNode = state.currentNode ?? null;
  if (!currentNode) {
    return {
      nextNode: "start",
      question: qaTree["start"].question,
      options: Object.keys(qaTree["start"].options || {}),
      input: qaTree["start"].input || null,
      placeholder: qaTree["start"].placeholder || "",
      card: qaTree["start"].card || null
    };
  }
  const currentNodeData = qaTree[currentNode];
  if (currentNodeData.input === "form") {
    const optionKeys = Object.keys(currentNodeData.options || {});
    const defaultOptionKey = optionKeys[0];
    const nextNode = currentNodeData.options[defaultOptionKey].next || null;
    return {
      nextNode,
      question: qaTree[nextNode].question,
      options: Object.keys(qaTree[nextNode].options || {}),
      input: qaTree[nextNode].input || null,
      placeholder: qaTree[nextNode].placeholder || "",
      card: qaTree[nextNode].card || null,
      callback: currentNodeData.options[defaultOptionKey].callback || null
    };
  }
  const option = currentNodeData.options?.[userAnswer] || {};
  const nextNode = option.next || null;
  if (!nextNode) {
    const intentNode = getIntentNode(userAnswer);
    if (intentNode && qaTree[intentNode]) {
      return {
        nextNode: intentNode,
        question: qaTree[intentNode].question,
        options: Object.keys(qaTree[intentNode].options || {}),
        input: qaTree[intentNode].input || null,
        placeholder: qaTree[intentNode].placeholder || "",
        card: qaTree[intentNode].card || null
      };
    }
    return {
      nextNode: null,
      question: "🤖 Sorry, I didn't quite understand. Could you rephrase or select from the main menu?",
      options: ["Main Menu"],
      input: null,
      placeholder: "",
      card: null
    };
  }
  const node = qaTree[nextNode];
  return {
    nextNode,
    question: node.question,
    options: node.options ? Object.keys(node.options) : [],
    input: node.input || null,
    placeholder: node.placeholder || "",
    card: node.card || null,
    callback: option.callback || null
  };
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory session store
const userSessions = {};

// Serve static chatbot HTML from /chatbot directory
app.use("/chatbot", express.static(path.join(__dirname, "public")));

app.post("/chat", upload.single("file"), async (req, res) => {
  const { user_id, message = "", input_data = "" } = req.body;
  const sessionId = user_id || uuidv4();
  if (!userSessions[sessionId]) {
    userSessions[sessionId] = {
      currentNode: null,
      history: [],
      tempForm: {}
    };
  }
  const session = userSessions[sessionId];
  const inputValue = input_data || message;
  let msgToProcess = message;
  if (req.file && !req.body.message) {
    msgToProcess = `File uploaded: ${req.file.originalname}`;
  }
  if (session.history.length > 0 && session.history[session.history.length - 1].user === msgToProcess) {
    session.currentNode = null;
  }
  if (session.currentNode === "enroll_itil") {
    session.tempForm.name = inputValue;
  }
  if (session.currentNode === "enroll_itil_email") {
    session.tempForm.email = inputValue;
  }
  const result = getNextQuestion(session, msgToProcess);
  session.currentNode = result.nextNode;
  session.history.push({ user: msgToProcess, bot: result.question });
  if (result.nextNode === null) {
    const nlpResult = await manager.process("en", msgToProcess);
    if (nlpResult.intent !== "None" && nlpResult.score > 0.6 && nlpResult.answer) {
      session.history.push({ user: msgToProcess, bot: nlpResult.answer });
      return res.json({
        session_id: sessionId,
        question: nlpResult.answer,
        options: ["Main Menu"],
        input: null,
        placeholder: "",
        card: null,
        callback: null,
        completed: false
      });
    }
  }
  if (result.callback && callbacks[result.callback]) {
    try {
      await callbacks[result.callback]({
        session_id: sessionId,
        message: msgToProcess,
        tempForm: session.tempForm,
        course: "ITIL"
      });
    } catch (err) {
      console.error("❌ Callback error:", err.message);
    }
  }
  return res.json({
    session_id: sessionId,
    question: result.question,
    options: result.options,
    input: result.input || null,
    placeholder: result.placeholder || "",
    card: result.card || null,
    callback: result.callback || null,
    completed: result.nextNode === null
  });
});

// /saveChat endpoint now uses express.text() to capture raw text from sendBeacon
app.post("/saveChat", (req, res) => {
  console.log("Received /saveChat body:", req.body);
  const { session_id, chatContent } = req.body;
  if (!session_id || typeof chatContent !== "string") {
    console.error("Invalid data received.");
    return res.status(400).json({ status: "error", message: "Invalid data" });
  }
  const chatLog = new ChatLog({
    session_id,
    chatContent,
    savedAt: new Date()
  });
  chatLog.save()
    .then(() => {
      console.log("Chat saved to MongoDB for session:", session_id);
      res.json({ status: "success", message: "Chat saved to MongoDB" });
    })
    .catch((err) => {
      console.error("Error saving chat to MongoDB:", err);
      res.status(500).json({ status: "error", message: "Failed to save chat" });
    });
});

app.get("/status", (req, res) => {
  res.json({ sessions: Object.keys(userSessions).length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Ducis chatbot server running on port ${PORT}`);
});
