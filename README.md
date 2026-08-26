# CodeForge V2 — AI-Native Multi-Agent SDE

CodeForge V2 is a local-first AI software development environment. Describe a
project in plain language and a multi-agent pipeline designs an architecture,
writes every file, runs security analysis, fixes findings, and produces a
reviewed, exportable project — powered by a provider pool that works with or
without API keys.

## How it works

```
Your Prompt
    │
    ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Architect   │──▶│    Coder     │──▶│ Security Scan│
│ stack+files  │   │ per file     │   │   (OWASP)    │
└──────────────┘   └──────┬───────┘   └──────┬───────┘
                          │                  │ issues found & budget left
                          ▼                  ▼
                     per-file grade      Fix loop
                     (from findings)   (coder + rescan)
                                          │
                                          ▼
                     ┌──────────────────────────────┐
                     │   Build/Test agent (sandbox) │─── fail ───▶ Debugger
                     │  npm install + build (+test) │              │
                     └──────────────────────────────┘              ▼
                             │ pass                     Coder repairs files
                             ▼                          (loop, bounded)
                     ┌──────────────┐
                     │ Code Review  │  build-aware final review
                     │ (real code)  │  (real code + build status + gates)
                     └──────────────┘
```

- **Architect** designs the tech stack and file tree.
- **Coder** generates each file with full project context.
- **Security Scan** runs automated analysis (LLM + heuristic fallback).
- **Fix loop** re-invokes the coder when the scan finds issues, up to
  `maxIterations` rounds per file, then re-scans. The loop is *converging*:
  a round that doesn't reduce the weighted severity of findings stops the
  loop instead of burning quota on repeated identical attempts.
- **Build/Test agent** runs the *real* toolchain — `npm install` + `build`
  (+ `test` if declared) — on the generated project inside an **isolated temp
  dir** (never on the host). Install runs with `--ignore-scripts` so generated
  dependencies can't execute arbitrary postinstall payloads.
- **Debugger** diagnoses build failures from the real toolchain output and
  directs the **Coder** to repair the implicated files; every repair is
  **verified by a rebuild** (repairs never happen without a following build).
  An identical error signature across consecutive builds short-circuits the
  loop (no-progress guard), and retry rounds **escalate**: keyed cloud
  providers are preferred over the free/local ones that already failed.
- **Code Review** evaluates the *actual generated source* plus the real build
  result (a failed build caps the score — the LLM can't claim 95/100 for
  code that doesn't compile) and produces scores + suggestions.

## Features

- Zero-key out of the box: **Ollama** (local, auto-detects installed models)
  first, **LLM7.io** free gateway as backup.
- **BYOK**: bring your own keys for Groq, NVIDIA NIM, Cerebras, Mistral,
  Google Gemini, Chutes.ai — stored in browser localStorage.
- Provider retry chain + per-task attempt budgets + 429 cooldown tracking.
- Live SSE streaming with provider status, per-file grades, security findings.
- Export projects as ZIP with a `codeforge.json` manifest.
- History of recent builds (bounded, persisted to localStorage).
- **Build/Test agent** verifies generated projects actually install and build
  (isolated temp dir, install with `--ignore-scripts`), with an automatic
  Debugger → Coder repair loop on failure.

## Getting started

```bash
bun install        # or: npm install
bun run dev        # http://localhost:3000
```

For local inference, have Ollama running (`ollama serve`) with at least one
installed model. The default local model is **`granite4.1:3b`** (fast on
CPU-only machines) — pull it with `ollama pull granite4.1:3b`. The
auto-detector also picks up `qwen2.5:3b`, `phi4-mini`, … and explicitly
avoids 7B+ models on CPU-only machines.

### Add cloud keys (optional)

Copy `.env.example` to `.env` and add any keys you have, or use the
**BYOK Keys** button in the UI. Without any keys, the pipeline still works via
Ollama + LLM7.

## Scripts

| Command          | What it does                                   |
| ---------------- | ---------------------------------------------- |
| `bun run dev`    | Start dev server (Vite middleware + API)       |
| `bun run build`  | Production build (client + server bundle)      |
| `bun start`      | Run the production server                      |
| `bun run lint`   | Type-check with `tsc --noEmit`                 |
| `bun run test`   | Run unit tests (vitest)                        |

## Environment variables

See [.env.example](.env.example) — all are optional:
`GROQ_API_KEY`, `NVIDIA_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`,
`GEMINI_API_KEY`, `CHUTES_API_KEY`, `LLM7_API_KEY`, `OLLAMA_BASE_URL`,
`PORT`, `HOST`, `CORS_ORIGINS`, `TRUST_PROXY`,
`CODEFORGE_BUILD_AGENT`, `CODEFORGE_PACKAGE_MANAGER`,
`CODEFORGE_INSTALL_TIMEOUT_MS`, `CODEFORGE_BUILD_TIMEOUT_MS`,
`CODEFORGE_KEEP_BUILD_DIR`.

## Security notes

- The generation endpoint is rate-limited per IP and capped in body size and
  concurrency; generation is aborted when the client disconnects (or the user
  presses **Stop** in the UI — cancellation propagates into in-flight LLM
  calls instantly).
- The server binds to `127.0.0.1` by default (set `HOST=0.0.0.0` to expose it
  on your LAN) and supports `TRUST_PROXY=1` behind a reverse proxy so per-IP
  rate limits see real client IPs. Graceful shutdown (SIGTERM/SIGINT) aborts
  all in-flight generations before exit.
- BYOK keys live in your browser's localStorage (convenient for local use;
  a future version may move them to the OS credential store).
- Generated fallback code now hashes passwords with bcrypt and refuses to boot
  without a real `JWT_SECRET` — no hardcoded secrets are emitted.
- The heuristic security scanner covers eval/new-Function code injection,
  command injection, XSS sinks, hardcoded credentials, weak hashing, wildcard
  CORS, and insecure randomness even when the LLM scanner is unavailable.

## Project structure

```
src/
├── agents/          # orchestrator, nodes, prompts, fallback engine, validators, build agent
├── lib/
│   ├── providers/   # provider pool, selector, rate-limit tracker
│   ├── ollamaModels.ts, ollamaHealth.ts, byok.ts, exportProject.ts
├── components/      # UI (editor, file tree, agent graph, review, settings…)
└── store/           # zustand pipeline store
server.ts            # Express + Vite middleware + SSE generation API
```
