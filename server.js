import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN = process.env.ADMIN_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 4096);
const RATE = Number(process.env.RATE_LIMIT ?? 20); // requests/min per IP, 0 = off
const DIR = process.env.DATA_DIR || "./data";
const FILE = path.join(DIR, "kb.json");

fs.mkdirSync(DIR, { recursive: true });
let kb = [];
try { kb = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
const save = () => fs.writeFileSync(FILE, JSON.stringify(kb));

const SYSTEM = `You are khokh (خوخ), an AI assistant specialised in writing code and designing apps and websites.
Reply in the same language and dialect the user writes in. Be concise and practical.
When asked for a web page or app interface, return ONE complete self-contained HTML file (inline CSS and JS) inside a single \`\`\`html block so it can be previewed live.
For other code, use fenced blocks with a language tag. After the code, add a short explanation.`;

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static("public"));

// ---------- knowledge base (retrieval) ----------
const tok = (s) => s.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || [];

function chunk(text) {
  const out = [];
  let cur = "";
  for (const para of text.split(/\n{2,}/)) {
    if (cur && (cur + para).length > 900) { out.push(cur.trim()); cur = ""; }
    cur += para + "\n\n";
    while (cur.length > 1800) { out.push(cur.slice(0, 1800)); cur = cur.slice(1800); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function retrieve(q) {
  const qt = new Set(tok(q));
  if (!qt.size) return [];
  const all = kb.flatMap((d) => d.chunks.map((c) => ({ name: d.name, c })));
  const sets = all.map((x) => new Set(tok(x.c)));
  const df = {};
  sets.forEach((s) => s.forEach((w) => { if (qt.has(w)) df[w] = (df[w] || 0) + 1; }));
  const N = all.length || 1;
  return all
    .map((x, i) => ({ x, s: [...qt].reduce((a, w) => a + (sets[i].has(w) ? Math.log(1 + N / (df[w] || 1)) : 0), 0) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((r) => r.x);
}

// ---------- model call ----------
async function claude({ system, messages, web, max }) {
  const body = { model: MODEL, max_tokens: max, system, messages };
  if (web) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || "Upstream error");
  return (d.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
}

async function learn(topic) {
  const text = await claude({
    system: "You are a research assistant. Search the web and write accurate, compact study notes in markdown: key facts, short code examples where relevant, and source URLs. No filler.",
    messages: [{ role: "user", content: "Research and write notes about: " + topic }],
    web: true,
    max: 3000,
  });
  const name = "web: " + topic;
  kb = kb.filter((d) => d.name !== name);
  kb.push({ id: crypto.randomUUID(), name, chunks: chunk(text) });
  save();
}

const admin = (req, res, next) => {
  if (!ADMIN) return res.status(403).json({ error: "Set ADMIN_KEY on the server to enable the knowledge base." });
  if (req.get("x-admin-key") !== ADMIN) return res.status(401).json({ error: "Wrong admin key." });
  next();
};

// ---------- routes ----------
const hits = new Map();
app.post("/api/chat", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  if (RATE > 0) {
    const now = Date.now();
    const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= RATE) return res.status(429).json({ error: "Too many requests. Try again in a minute." });
    recent.push(now);
    hits.set(req.ip, recent);
  }
  const messages = (req.body.messages || []).slice(-20).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 50000),
  }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return res.status(400).json({ error: "No message." });

  const last = [...messages].reverse().find((m) => m.role === "user").content;
  const ctx = retrieve(last).map((x) => `[${x.name}]\n${x.c}`).join("\n---\n");
  const system = SYSTEM + (ctx ? "\n\nKnowledge base (prefer this when relevant):\n" + ctx : "");
  try {
    res.json({ text: await claude({ system, messages, web: !!req.body.web, max: MAX_TOKENS }) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/kb", (req, res) => res.json({ docs: kb.map((d) => ({ id: d.id, name: d.name, chunks: d.chunks.length })) }));

app.post("/api/kb", admin, (req, res) => {
  const name = String(req.body.name || "").slice(0, 200);
  const text = String(req.body.text || "").slice(0, 500000);
  if (!name || !text.trim()) return res.status(400).json({ error: "Empty file." });
  kb.push({ id: crypto.randomUUID(), name, chunks: chunk(text) });
  save();
  res.json({ ok: true });
});

app.delete("/api/kb/:id", admin, (req, res) => {
  kb = kb.filter((d) => d.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.post("/api/learn", admin, async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set." });
  const topic = String(req.body.topic || "").slice(0, 300);
  if (!topic) return res.status(400).json({ error: "Empty topic." });
  try { await learn(topic); res.json({ ok: true }); } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- autonomous learning loop ----------
const TOPICS = (process.env.LEARN_TOPICS || "").split(";").map((s) => s.trim()).filter(Boolean);
const EVERY = Number(process.env.LEARN_EVERY_HOURS || 24);
if (TOPICS.length && KEY) {
  const run = async () => { for (const t of TOPICS) { try { await learn(t); } catch (e) { console.error(e.message); } } };
  setTimeout(run, 5000);
  setInterval(run, EVERY * 3600e3);
}

app.listen(process.env.PORT || 3000, () => console.log("khokh is running"));
