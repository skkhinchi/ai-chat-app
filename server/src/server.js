import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readFile, unlink } from "fs/promises";
import { PDFParse } from "pdf-parse";
import { chunkText } from "./rag/chunkText.js";
import { embedQuery, generateEmbeddings } from "./rag/embeddings.js";
import { retrieveTopK } from "./rag/retrieveTopK.js";
import {
  appendToVectorStore,
  clearVectorStore,
  vectorStore,
} from "./rag/vectorStore.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 15 * 1024 * 1024 },
});

const app = express();
app.use(cors());
app.use(express.json());

/** Register early so a stale/old server file is obvious vs missing routes. */
app.post("/clear-docs", (req, res) => {
  clearVectorStore();
  res.json({ message: "All documents cleared", vectorCount: vectorStore.length });
});

app.post("/clear-all", (req, res) => {
  clearVectorStore();
  res.json({
    message: "Chat + Documents cleared (server vectors wiped)",
    vectorCount: vectorStore.length,
  });
});

app.get("/clear-all", (req, res) => {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ error: "Use POST /clear-all (GET is not supported)" });
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
    try {
      const { message, history: rawHistory } = req.body;
      const history = Array.isArray(rawHistory) ? rawHistory : [];
  
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }
  
      let instructions = "You are a helpful assistant.";
      let ragSources = null;
      let context = "";
  
      if (vectorStore.length > 0) {
        try {
          const queryVector = await embedQuery(openai, message);
          const { context: ctx, topChunks } = retrieveTopK(
            vectorStore,
            queryVector,
            3,
          );
          context = ctx;

          if (context.trim()) {
            const contextText = context.toLowerCase();
            const STOPWORDS = [
              "what",
              "is",
              "the",
              "of",
              "are",
              "in",
              "on",
              "a",
              "an",
            ];
            const cleanMessage = message
              .toLowerCase()
              .replace(/[^\w\s]/g, "");
            const keywords = cleanMessage
              .split(/\s+/)
              .filter((word) => word && !STOPWORDS.includes(word));
            const hasMatch =
              keywords.length === 0 ||
              keywords.some((word) => contextText.includes(word));


            ragSources = topChunks.map((c) => ({
              text: c.text,
              fileName: c.fileName ?? "document.pdf",
            }));

            instructions = `You are a STRICT RAG AI assistant.

CRITICAL RULES:
- Answer ONLY from the context
- If answer not found → say EXACTLY "I don't know"
- DO NOT use external knowledge
- Keep answer short

Context:
${context}`;
          }
        } catch (ragErr) {
          console.error("[RAG] error:", ragErr);
          return res.end("I don't know");
        }
      }
  
      const userContent =
        ragSources !== null
          ? `Question: ${message}\nAnswer:`
          : message;
  
      const stream = await openai.responses.stream({
        model: "gpt-4.1-mini",
        temperature: 0,
        instructions,
        input: [...history, { role: "user", content: userContent }],
      });
  
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Cache-Control", "no-cache");
      res.flushHeaders();
  
      if (ragSources && ragSources.length > 0) {
        res.write(
          `data: ${JSON.stringify({ type: "source", sources: ragSources })}\n\n`
        );
      }
  
      for await (const chunk of stream) {
        if (chunk.type === "response.output_text.delta") {
          res.write(chunk.delta);
        }
      }
  
      res.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).send("Error");
      } else {
        res.end();
      }
    }
  });

app.post("/title", async (req, res) => {
  try {
    const { userMessage, assistantReply } = req.body;
    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({ error: "userMessage is required" });
    }
    const replyExcerpt =
      typeof assistantReply === "string" ? assistantReply.slice(0, 600) : "";

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You write very short chat thread titles. Reply with the title text only: max 6 words, no quotes, no trailing punctuation, same language as the user's first message.",
        },
        {
          role: "user",
          content: `First user message:\n${userMessage.slice(0, 800)}\n\nAssistant reply (excerpt):\n${replyExcerpt}`,
        },
      ],
      max_tokens: 40,
      temperature: 0.5,
    });

    let title = completion.choices[0]?.message?.content?.trim() || "Chat";
    title = title.replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "").trim();
    title = title.replace(/[.…]+$/g, "").trim();
    if (title.length > 64) title = title.slice(0, 61).trim() + "…";

    res.json({ title });
  } catch (err) {
    console.error("title:", err);
    res.status(500).json({ error: "Failed to generate title" });
  }
});

app.post("/upload", upload.single("file"), async (req, res) => {
  let filePath;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded (field name: file)" });
    }
    filePath = req.file.path;
    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF files are supported" });
    }
    const dataBuffer = await readFile(filePath);
    const parser = new PDFParse({ data: dataBuffer });
    try {
      const pdfData = await parser.getText();
      const rawText = pdfData.text ?? "";

      const chunks = chunkText(rawText, 500);
      console.log("[RAG] chunks:", chunks);

      /** @type {{ text: string; vector: number[]; fileName: string }[]} */
      let embedded = [];
      try {
        if (chunks.length > 0) {
          const rawEmbedded = await generateEmbeddings(openai, chunks);
          const fileName =
            req.file.originalname || req.file.filename || "document.pdf";
          embedded = rawEmbedded.map((e) => ({ ...e, fileName }));
          appendToVectorStore(embedded);
          console.log(
            "[RAG] chunks added:",
            embedded.length,
            "| vectorStore total entries:",
            vectorStore.length,
            "| file:",
            fileName,
          );
        } else {
          console.log("[RAG] chunks added: 0 (no text to chunk)");
        }
      } catch (ragErr) {
        console.error("[RAG] embedding failed:", ragErr);
      }

      console.log("[RAG] number of chunks:", chunks.length);
      if (embedded.length > 0) {
        console.log("[RAG] first embedding object:", {
          text: embedded[0].text,
          vector: embedded[0].vector,
          fileName: embedded[0].fileName,
        });
      }

      res.json({
        text: rawText,
        message: "PDF processed successfully",
        chunkCount: chunks.length,
      });
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch (err) {
    console.error("upload:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error processing PDF" });
    }
  } finally {
    if (filePath) {
      await unlink(filePath).catch(() => {});
    }
  }
});

app.get("/", (req, res) => {
  res.type("text/plain").send(
    "API is running 🚀\n\nPOST /clear-docs — clear RAG vectors only\nPOST /clear-all — clear vectors (same store; client resets chats separately)\n",
  );
});

app.listen(8000, () => {
  console.log("🚀 Server running on http://localhost:8000");
});