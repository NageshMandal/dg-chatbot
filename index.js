const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const callbacks = require("./callback");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const userSessions = {};
const qaTree = JSON.parse(fs.readFileSync("./questions.json", "utf-8"));

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

  const option = qaTree[currentNode]?.options?.[userAnswer] || {};
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

// Serve static chatbot HTML
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

  // Handle file upload message fallback
  let msgToProcess = message;
  if (req.file && !req.body.message) {
    msgToProcess = `File uploaded: ${req.file.originalname}`;
  }

  // Update session data with actual input value for enrollment
  if (session.currentNode === "enroll_itil") {
    session.tempForm.name = inputValue;
  }
  if (session.currentNode === "enroll_itil_email") {
    session.tempForm.email = inputValue;
  }

  const result = getNextQuestion(session, msgToProcess);
  session.currentNode = result.nextNode;
  session.history.push({ user: msgToProcess, bot: result.question });

  // Trigger callback if defined
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

app.get("/status", (req, res) => {
  res.json({ sessions: Object.keys(userSessions).length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Ducis chatbot server running on port ${PORT}`);
});
