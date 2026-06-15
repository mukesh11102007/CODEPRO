import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { exec } from 'child_process';
import util from 'util';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const execPromise = util.promisify(exec);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(API_KEY);
const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || './project');
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// ─── MongoDB Connection ────────────────────────────────────────
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✦ Connected to MongoDB'))
    .catch(err => console.error('✗ MongoDB connection error:', err));

// ─── User Model ────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// ─── Auth Middleware ───────────────────────────────────────────
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.user = user;
        next();
    });
};

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Auth Endpoints ────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ name, email, password: hashedPassword });
        await user.save();

        const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { name: user.name, email: user.email } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: 'Invalid user or password' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Invalid user or password' });

        const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { name: user.name, email: user.email } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Helper: Language extensions ────────────────────────────────
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'venv', 'build', '.DS_Store']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.zip', '.tar', '.gz', '.pdf']);

// ─── Helper: Recursive file tree ────────────────────────────────
async function getFileTree(dir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (entry) => {
            if (IGNORE_DIRS.has(entry.name)) return null;
            const res = path.resolve(dir, entry.name);
            if (entry.isDirectory()) {
                return {
                    name: entry.name,
                    type: 'folder',
                    path: path.relative(PROJECT_ROOT, res),
                    children: await getFileTree(res)
                };
            }
            return {
                name: entry.name,
                type: 'file',
                path: path.relative(PROJECT_ROOT, res)
            };
        }));
        return files.filter(Boolean).sort((a, b) => {
            if (a.type === 'folder' && b.type === 'file') return -1;
            if (a.type === 'file' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });
    } catch (err) {
        console.error("Error reading directory:", dir, err.message);
        return [];
    }
}

// ─── Helper: Flatten file tree to list of paths ─────────────────
function flattenTree(nodes, list = []) {
    for (const node of nodes) {
        if (node.type === 'file') list.push(node.path);
        if (node.children) flattenTree(node.children, list);
    }
    return list;
}

// ─── Helper: Read file safely ───────────────────────────────────
async function safeReadFile(filePath) {
    try {
        const ext = path.extname(filePath).toLowerCase();
        if (BINARY_EXT.has(ext)) return `[Binary file: ${filePath}]`;
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    } catch {
        return `[Could not read: ${filePath}]`;
    }
}

// ─── In-memory conversation store ───────────────────────────────
const conversations = new Map();

// ─── SYSTEM PROMPT for Gemini ───────────────────────────────────
const SYSTEM_PROMPT = `You are **Gemini Studio Agent**, an expert autonomous coding assistant embedded in a VS Code-like editor.

## Your Capabilities
- You can read, write, refactor, debug, and create code across entire repositories.
- You can use a real sandbox terminal to run commands (npm, tests, linters).
- You understand project structures, dependencies, and architecture patterns.

## ⚠️ MANDATORY PLAN-FIRST WORKFLOW
You MUST follow a critical reasoning loop before writing code.
1. When asked to implement a feature, fix a bug, or refactor, you MUST FIRST generate a step-by-step plan.
2. Wrap your plan in a special XML block:
   <PLAN>
   - Step 1: Research...
   - Step 2: Modify file X...
   - Step 3: Run tests...
   </PLAN>
3. Only AFTER outputting the <PLAN> block are you allowed to generate code blocks.

## Response Rules
1. When you need to EDIT or CREATE a file, wrap the FULL new content in a special block:
   CODE_BLOCK_START:relative/path/to/file
   ...full file content here...
   CODE_BLOCK_END
2. You may include MULTIPLE code blocks for multi-file changes.
3. If the user asks you to run a terminal command, explicitly instruct them to use the terminal panel or tell them what command to run.

## Context
You have access to the full file tree and any file contents provided in the conversation context.`;

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// ─── GET /api/files — File tree ─────────────────────────────────
app.get('/api/files', async (req, res) => {
    try {
        const tree = await getFileTree(PROJECT_ROOT);
        res.json(tree);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/read-file — Read single file ────────────────────
app.post('/api/read-file', async (req, res) => {
    try {
        const filePath = req.body.path;
        const fullPath = path.join(PROJECT_ROOT, filePath);
        // Security: prevent path traversal
        if (!fullPath.startsWith(PROJECT_ROOT)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const content = await fs.readFile(fullPath, 'utf-8');
        res.json({ content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/write-file — Write/save file ────────────────────
app.post('/api/write-file', async (req, res) => {
    try {
        const { path: filePath, content } = req.body;
        const fullPath = path.join(PROJECT_ROOT, filePath);
        if (!fullPath.startsWith(PROJECT_ROOT)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        res.json({ success: true, path: filePath });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/delete-file — Delete file/folder ──────────────────
app.post('/api/delete-file', async (req, res) => {
    try {
        const { path: filePath } = req.body;
        const fullPath = path.join(PROJECT_ROOT, filePath);
        if (!fullPath.startsWith(PROJECT_ROOT)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        await fs.rm(fullPath, { recursive: true, force: true });
        res.json({ success: true, path: filePath });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/index-repo — Build repo summary ─────────────────
app.post('/api/index-repo', async (req, res) => {
    try {
        const tree = await getFileTree(PROJECT_ROOT);
        const allFiles = flattenTree(tree);

        const summaries = [];
        for (const filePath of allFiles.slice(0, 50)) { // Limit to 50 files
            const fullPath = path.join(PROJECT_ROOT, filePath);
            const content = await safeReadFile(fullPath);
            const lines = content.split('\n').length;
            const ext = path.extname(filePath);
            summaries.push({
                path: filePath,
                extension: ext,
                lines,
                preview: content.substring(0, 200)
            });
        }

        res.json({
            totalFiles: allFiles.length,
            indexed: summaries.length,
            files: summaries
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/search — Grep-like search ────────────────────────
app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.json({ results: [] });

        const tree = await getFileTree(PROJECT_ROOT);
        const allFiles = flattenTree(tree);
        const results = [];

        for (const filePath of allFiles) {
            const ext = path.extname(filePath).toLowerCase();
            if (BINARY_EXT.has(ext)) continue;

            try {
                const fullPath = path.join(PROJECT_ROOT, filePath);
                const content = await fs.readFile(fullPath, 'utf-8');
                const lines = content.split('\n');
                lines.forEach((line, idx) => {
                    if (line.toLowerCase().includes(query.toLowerCase())) {
                        results.push({
                            file: filePath,
                            line: idx + 1,
                            content: line.trim().substring(0, 200)
                        });
                    }
                });
            } catch { /* skip unreadable files */ }

            if (results.length >= 100) break;
        }

        res.json({ results: results.slice(0, 100) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/run-command — Execute shell command ───────────────
app.post('/api/run-command', async (req, res) => {
    try {
        const { command } = req.body;
        if (!command) return res.status(400).json({ error: 'Command required' });

        const { stdout, stderr } = await execPromise(command, { cwd: PROJECT_ROOT, timeout: 30000 });
        res.json({ stdout, stderr });
    } catch (err) {
        res.status(500).json({ error: err.message, stderr: err.stderr || '' });
    }
});

// ─── POST /api/chat — AI Chat with streaming ───────────────────
app.post('/api/chat', async (req, res) => {
    const { prompt, history = [], currentFile, sessionId = 'default' } = req.body;

    try {
        let finalSystemPrompt = SYSTEM_PROMPT;
        try {
            const rules = await fs.readFile(path.join(PROJECT_ROOT, '.cursorrules'), 'utf-8');
            finalSystemPrompt += '\n\n## Project Specific Rules (.cursorrules)\n' + rules;
        } catch { /* ignore if not found */ }

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",
            systemInstruction: finalSystemPrompt
        });

        // Build context with file content
        let contextParts = [];

        // Include file tree for context
        const tree = await getFileTree(PROJECT_ROOT);
        const allFiles = flattenTree(tree);
        contextParts.push(`Project file tree:\n${allFiles.join('\n')}`);

        // Include current file content
        if (currentFile) {
            try {
                const fullPath = path.join(PROJECT_ROOT, currentFile);
                const content = await fs.readFile(fullPath, 'utf-8');
                contextParts.push(`\nCurrently open file: ${currentFile}\n\`\`\`\n${content}\n\`\`\``);
            } catch { /* file might not exist yet */ }
        }

        // Build chat history from stored conversations + request history
        let storedHistory = conversations.get(sessionId) || [];

        // Merge: prefer client-sent history if it has more messages
        const chatHistory = (history.length > storedHistory.length ? history : storedHistory)
            .map(msg => ({
                role: msg.role === 'model' ? 'model' : 'user',
                parts: [{ text: msg.parts?.[0]?.text || msg.text || '' }]
            }))
            .filter(msg => msg.parts[0].text.length > 0);

        const chat = model.startChat({ history: chatHistory });

        const fullPrompt = `${contextParts.join('\n\n')}\n\n---\nUser Request: ${prompt}`;

        const result = await chat.sendMessage(fullPrompt);
        const response = await result.response;
        const text = response.text();

        // Store updated history
        const updatedHistory = [
            ...chatHistory,
            { role: 'user', parts: [{ text: prompt }] },
            { role: 'model', parts: [{ text }] }
        ];
        conversations.set(sessionId, updatedHistory);

        res.json({ text, sessionId });
    } catch (err) {
        console.error("Gemini API Error:", err.message || err);
        res.status(500).json({
            error: "Failed to communicate with AI.",
            details: err.message || "Check your API key and model name."
        });
    }
});

// ─── POST /api/chat/stream — Streaming AI responses (SSE) ──────
app.post('/api/chat/stream', async (req, res) => {
    const { prompt, history = [], currentFile, sessionId = 'default' } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        let finalSystemPrompt = SYSTEM_PROMPT;
        try {
            const rules = await fs.readFile(path.join(PROJECT_ROOT, '.cursorrules'), 'utf-8');
            finalSystemPrompt += '\n\n## Project Specific Rules (.cursorrules)\n' + rules;
        } catch { /* ignore if not found */ }

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",
            systemInstruction: finalSystemPrompt
        });

        // Build context
        let contextParts = [];
        const tree = await getFileTree(PROJECT_ROOT);
        const allFiles = flattenTree(tree);
        contextParts.push(`Project file tree:\n${allFiles.join('\n')}`);

        if (currentFile) {
            try {
                const fullPath = path.join(PROJECT_ROOT, currentFile);
                const content = await fs.readFile(fullPath, 'utf-8');
                contextParts.push(`\nCurrently open file: ${currentFile}\n\`\`\`\n${content}\n\`\`\``);
            } catch { /* skip */ }
        }

        let storedHistory = conversations.get(sessionId) || [];
        const chatHistory = (history.length > storedHistory.length ? history : storedHistory)
            .map(msg => ({
                role: msg.role === 'model' ? 'model' : 'user',
                parts: [{ text: msg.parts?.[0]?.text || msg.text || '' }]
            }))
            .filter(msg => msg.parts[0].text.length > 0);

        const chat = model.startChat({ history: chatHistory });
        const fullPrompt = `${contextParts.join('\n\n')}\n\n---\nUser Request: ${prompt}`;

        const result = await chat.sendMessageStream(fullPrompt);
        let fullText = '';

        for await (const chunk of result.stream) {
            const text = chunk.text();
            fullText += text;
            res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
        }

        // Store conversation
        const updatedHistory = [
            ...chatHistory,
            { role: 'user', parts: [{ text: prompt }] },
            { role: 'model', parts: [{ text: fullText }] }
        ];
        conversations.set(sessionId, updatedHistory);

        res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`);
        res.end();
    } catch (err) {
        console.error("Stream Error:", err.message || err);
        res.write(`data: ${JSON.stringify({ error: err.message || "AI Error" })}\n\n`);
        res.end();
    }
});

// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`\n  ✦ Gemini Studio Backend running on http://localhost:${PORT}`);
    console.log(`  ✦ Project root: ${PROJECT_ROOT}\n`);
});