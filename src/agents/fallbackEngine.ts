import { AgentFile, TechStack, SecurityIssue, CodeReviewResult } from './state';

export function fallbackArchitect(prompt: string): { stack: TechStack; files: AgentFile[] } {
  const pLower = prompt.toLowerCase();

  if (pLower.includes('rest api') || pLower.includes('express') || pLower.includes('jwt') || pLower.includes('auth')) {
    return {
      stack: {
        frontend: 'React / Vite Client',
        backend: 'Express.js',
        database: 'In-Memory / SQLite',
        auth: 'JWT Authentication',
        language: 'TypeScript',
        libraries: ['express', 'jsonwebtoken', 'bcryptjs', 'cors', 'dotenv', 'zod']
      },
      files: [
        { path: 'package.json', type: 'json', description: 'Dependencies and scripts configuration' },
        { path: '.env.example', type: 'env', description: 'Environment variable template (JWT_SECRET, FRONTEND_URL, PORT)' },
        { path: 'src/server.ts', type: 'ts', description: 'Express application server entrypoint' },
        { path: 'src/auth/jwt.ts', type: 'ts', description: 'JWT token signing and verification middleware' },
        { path: 'src/routes/auth.ts', type: 'ts', description: 'User login and registration API routes' },
        { path: 'src/routes/protected.ts', type: 'ts', description: 'Protected resource API endpoints' },
        { path: 'README.md', type: 'md', description: 'Project documentation and setup guide' }
      ]
    };
  }

  // Frontend-only SPA prompts (todo / task / kanban boards): no backend.
  // The old fallback claimed "Node.js Express" with a backend file list that was
  // never actually generated — which is how Express code ended up in index.html.
  if (pLower.includes('todo') || pLower.includes('task') || pLower.includes('kanban') ||
      pLower.includes('dashboard') || pLower.includes('landing page') || pLower.includes('portfolio')) {
    return {
      stack: {
        frontend: 'React 19 + Tailwind CSS (Vite)',
        backend: 'None',
        database: 'In-Memory / LocalStorage',
        auth: 'None',
        language: 'JavaScript',
        libraries: ['react', 'react-dom', 'tailwindcss', 'vite']
      },
      files: [
        { path: 'package.json', type: 'json', description: 'Project setup and dependencies' },
        { path: 'vite.config.js', type: 'js', description: 'Vite + React + Tailwind configuration' },
        { path: 'index.html', type: 'html', description: 'HTML entrypoint mounting the React app' },
        { path: 'src/main.jsx', type: 'jsx', description: 'React application entry point' },
        { path: 'src/App.jsx', type: 'jsx', description: 'Main application layout and state' },
        { path: 'src/components/Task.jsx', type: 'jsx', description: 'Reusable task card component' },
        { path: 'src/styles/tailwind.css', type: 'css', description: 'Tailwind CSS global styles' },
        { path: 'README.md', type: 'md', description: 'Usage instructions and guide' }
      ]
    };
  }

  // General default fallback — frontend SPA unless the prompt clearly wants a server.
  if (pLower.includes('backend') || pLower.includes('api') || pLower.includes('server') ||
      pLower.includes('database') || pLower.includes('crud') || pLower.includes('microservice')) {
    return {
      stack: {
        frontend: 'React / Vite Client',
        backend: 'Express.js',
        database: 'In-Memory / SQLite',
        auth: 'JWT Authentication',
        language: 'TypeScript',
        libraries: ['express', 'jsonwebtoken', 'bcryptjs', 'cors', 'dotenv', 'zod']
      },
      files: [
        { path: 'package.json', type: 'json', description: 'Project dependencies and scripts' },
        { path: 'src/server.ts', type: 'ts', description: 'Express application server entrypoint' },
        { path: 'src/routes/index.ts', type: 'ts', description: 'API route definitions' },
        { path: 'src/types.ts', type: 'ts', description: 'Shared TypeScript interfaces' },
        { path: 'README.md', type: 'md', description: 'Project guide and instructions' }
      ]
    };
  }

  // Coherent frontend SPA default
  return {
    stack: {
      frontend: 'React + Vite',
      backend: 'None',
      database: 'In-Memory Store',
      auth: 'None',
      language: 'JavaScript',
      libraries: ['react', 'react-dom', 'vite', 'lucide-react']
    },
    files: [
      { path: 'package.json', type: 'json', description: 'Project dependencies and scripts' },
      { path: 'vite.config.js', type: 'js', description: 'Vite build configuration' },
      { path: 'index.html', type: 'html', description: 'HTML entrypoint' },
      { path: 'src/main.jsx', type: 'jsx', description: 'Application entry point' },
      { path: 'src/App.jsx', type: 'jsx', description: 'Main application component' },
      { path: 'src/styles/global.css', type: 'css', description: 'Global styles' },
      { path: 'README.md', type: 'md', description: 'Project guide and instructions' }
    ]
  };
}

function isBackendStack(stack: TechStack): boolean {
  const b = (stack.backend || '').toLowerCase();
  return b.includes('express') || b.includes('node') || b.includes('fastify') || b.includes('hono');
}

function packageJsonFor(stack: TechStack, prompt: string): string {
  const name = prompt.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'generated-app';

  const frontend = (stack.frontend || '').toLowerCase();
  const isReact = frontend.includes('react') || (stack.libraries || []).some((l) => l.includes('react'));

  if (isReact && !isBackendStack(stack)) {
    const isTs = (stack.language || '').toLowerCase() === 'typescript';
    return JSON.stringify(
      {
        name,
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: {
          '@tailwindcss/vite': '^4.1.14',
          '@vitejs/plugin-react': '^5.0.4',
          tailwindcss: '^4.1.14',
          vite: '^6.2.3',
          ...(isTs
            ? { typescript: '~5.8.2', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' }
            : {})
        }
      },
      null,
      2
    );
  }

  // Backend / full-stack fallback
  return JSON.stringify(
    {
      name,
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'tsx src/server.ts',
        build: 'tsc',
        start: 'node dist/server.js'
      },
      dependencies: {
        express: '^4.21.2',
        jsonwebtoken: '^9.0.2',
        bcryptjs: '^2.4.3',
        cors: '^2.8.5',
        dotenv: '^17.2.3',
        zod: '^3.23.8'
      },
      devDependencies: {
        '@types/express': '^4.17.21',
        '@types/jsonwebtoken': '^9.0.6',
        '@types/node': '^22.14.0',
        tsx: '^4.21.0',
        typescript: '^5.8.2'
      }
    },
    null,
    2
  );
}

/**
 * File-type-aware fallback code generator.
 *
 * Fixed: content is now dispatched by file EXTENSION first, so an HTML file gets
 * an HTML shell, a CSS file gets CSS, a .js file gets valid JavaScript, etc.
 * Previously, `index.html` matched the "server/index" substring rule and received
 * an Express server, while .css and .js files fell through to a TypeScript
 * interface template — producing the broken exports we saw.
 */
export function fallbackCoder(
  filePath: string,
  prompt: string,
  stack: TechStack,
  existingFiles: Record<string, string>
): string {
  const lower = filePath.toLowerCase();

  if (lower === 'package.json' || lower.endsWith('/package.json')) {
    return packageJsonFor(stack, prompt);
  }

  // -------- HTML --------
  if (lower.endsWith('.html')) {
    const react = (stack.frontend || '').toLowerCase().includes('react');
    const ts = (stack.language || '').toLowerCase() === 'typescript';
    const entry = ts ? '/src/main.tsx' : '/src/main.jsx';
    // Escape the user's prompt before it lands in the HTML <title>.
    const title = (prompt.slice(0, 40) || 'Generated App')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    ${react ? '<div id="root"></div>' : ''}
    <script type="module" src="${entry}"></script>
  </body>
</html>
`;
  }

  // -------- CSS --------
  if (lower.endsWith('.css')) {
    return `/* Global styles */
:root {
  color-scheme: light dark;
  --bg: #f4f4f5;
  --card: #ffffff;
  --text: #18181b;
  --muted: #71717a;
  --accent: #6366f1;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

#app,
#root {
  min-height: 100vh;
}

button {
  cursor: pointer;
}
`;
  }

  // -------- Markdown --------
  if (lower.endsWith('.md') || lower === 'readme') {
    return `# ${prompt.slice(0, 60) || 'Generated Project'}

> Generated by **CodeForge V2** Multi-Agent Pipeline.

## System Architecture

- **Frontend:** ${stack.frontend || 'React / Vite'}
- **Backend:** ${stack.backend || 'None'}
- **Authentication:** ${stack.auth || 'None'}
- **Language:** ${stack.language || 'JavaScript'}

## Getting Started

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Run development server:
   \`\`\`bash
   npm run dev
   \`\`\`
`;
  }

  // -------- React entry point (src/main.jsx, src/index.jsx, …) --------
  if (/(?:^|\/)main\.(jsx|tsx)$/.test(lower) || /(?:^|\/)index\.(jsx|tsx)$/.test(lower)) {
    const ts = lower.endsWith('.tsx');
    return `// ${filePath}
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App${ts ? '.tsx' : '.jsx'}';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;
  }

  // -------- React components (jsx / tsx) --------
  if (lower.endsWith('.jsx') || lower.endsWith('.tsx')) {
    const ts = lower.endsWith('.tsx');
    // Capitalize the component name so React treats it as a component, not an
    // intrinsic HTML element (e.g. index.jsx -> Index, navbar.jsx -> Navbar).
    const raw = filePath.split('/').pop()!.replace(/\.(jsx|tsx)$/, '') || 'Component';
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);
    const props = ts ? `{ title }: { title: string }` : `{ title = 'Hello' }`;
    return `// ${filePath}
${ts ? '' : "import { useState } from 'react';\n"}
export default function ${name}(${props}) {
  ${ts ? 'return <h1>{title}</h1>;\n' : `const [count, setCount] = useState(0);
  return (
    <div style={{ textAlign: 'center', padding: '2rem' }}>
      <h1>{title}</h1>
      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>
    </div>
  );
`}
}
`;
  }

  // -------- .env.example --------
  if (lower.endsWith('.env.example') || lower.endsWith('.env')) {
    return `# Copy this file to .env and fill in real values.
# Never commit .env to version control.

# Required for JWT auth - generate with: openssl rand -hex 32
JWT_SECRET=replace-with-a-long-random-secret

# Allowed CORS origin for the frontend
FRONTEND_URL=http://localhost:5173

# Server port
PORT=3000
`;
  }

  // -------- Vite config --------
  if (lower === 'vite.config.js' || lower === 'vite.config.ts') {
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
`;
  }

  // -------- Backend files (only for genuine backend stacks, .ts/.js only) --------
  if (isBackendStack(stack) && (lower.endsWith('.ts') || lower.endsWith('.js'))) {
    if (lower.includes('jwt') || (lower.includes('auth') && !lower.includes('routes/'))) {
      return `import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

// No hardcoded fallback secret: refuse to boot when JWT_SECRET is missing.
// Copy .env.example to .env and set a long random value in production.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required. Copy .env.example to .env and set a long random value.');
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export function generateToken(payload: { id: string; email: string; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h', issuer: 'codeforge', audience: 'codeforge-client' });
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedRequest['user'];
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}
`;
    }

    if (lower.includes('server') || lower.endsWith('/index.ts') || lower.endsWith('/index.js') || lower === 'index.ts' || lower === 'index.js') {
      return `import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Restrict CORS to the configured frontend origin instead of allowing all.
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '256kb' }));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Centralized error handler - never leak internal stack traces.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start Server
app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
});

export default app;
`;
    }

    if (lower.includes('routes/auth')) {
      return `import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { generateToken } from '../auth/jwt.js';

const router = Router();

// Demo in-memory user store (real apps should use a database)
const users = new Map<string, { id: string; email: string; passwordHash: string }>();

router.post('/register', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (users.has(email)) {
    return res.status(400).json({ error: 'User already exists' });
  }

  // Real bcrypt hashing (cost factor 12) - never store plaintext or prefixes.
  const passwordHash = await bcrypt.hash(password, 12);
  const user = { id: 'user_' + Date.now(), email, passwordHash };
  users.set(email, user);

  const token = generateToken({ id: user.id, email: user.email, role: 'user' });
  return res.status(201).json({ message: 'User registered successfully', token, user: { id: user.id, email: user.email } });
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = users.get(email);

  if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken({ id: user.id, email: user.email, role: 'user' });
  return res.json({ message: 'Login successful', token });
});

export default router;
`;
    }

    if (lower.includes('routes/protected')) {
      return `import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../auth/jwt.js';

const router = Router();

router.get('/profile', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    message: 'Protected user profile retrieved',
    user: req.user
  });
});

router.get('/dashboard', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    stats: {
      totalRequests: 142,
      activeSessions: 3,
      securityStatus: 'Encrypted (JWT)'
    }
  });
});

export default router;
`;
    }
  }

  // -------- Plain .js / .ts modules --------
  if (lower.endsWith('.ts')) {
    return `// ${filePath}
export interface Config {
  env: string;
  version: string;
}

export const defaultConfig: Config = {
  env: process.env.NODE_ENV || 'development',
  version: '1.0.0'
};

export function logInfo(msg: string) {
  console.log(\`[\${new Date().toISOString()}] \${msg}\`);
}
`;
  }

  if (lower.endsWith('.js')) {
    // Valid JavaScript — no TypeScript syntax (the old template was invalid in .js files)
    return `// ${filePath}
export const defaultConfig = {
  env: process.env.NODE_ENV || 'development',
  version: '1.0.0'
};

export function logInfo(msg) {
  console.log(\`[\${new Date().toISOString()}] \${msg}\`);
}
`;
  }

  // -------- Unknown extension --------
  return `// ${filePath} - Generated by CodeForge V2
// Content type could not be inferred; edit this placeholder.
`;
}

/** A single deterministic SAST rule used by the fallback scanner. */
interface ScanRule {
  id: string;
  severity: SecurityIssue['severity'];
  type: string;
  message: string;
  recommendation: string;
  /** Matched against the whole file body. */
  re: RegExp;
}

/**
 * Rule-based OWASP heuristics. This scanner is the SAFETY NET that runs
 * whenever the LLM scanner fails or returns garbage — and the ONLY scan that
 * build-repair rounds get — so it must catch the classic vulnerability
 * classes deterministically without an LLM.
 */
const SCAN_RULES: ScanRule[] = [
  {
    id: 'SEC-EVAL',
    severity: 'critical',
    type: 'Code Injection',
    message: 'Use of eval() executes arbitrary strings as code — a critical remote-code-execution vector.',
    recommendation: 'Remove eval(); use JSON.parse, explicit lookup maps, or a purpose-built parser instead.',
    re: /\beval\s*\(/
  },
  {
    id: 'SEC-FNCONSTRUCTOR',
    severity: 'critical',
    type: 'Code Injection',
    message: 'new Function() compiles arbitrary strings into executable code, equivalent to eval().',
    recommendation: 'Replace new Function() with static functions or a safe expression evaluator.',
    re: /\bnew\s+Function\s*\(/
  },
  {
    id: 'SEC-CMDINJ',
    severity: 'high',
    type: 'Command Injection',
    message: 'Shell command built from interpolated/concatenated values — injected input can execute arbitrary commands.',
    recommendation: 'Avoid string-built shell commands; pass an argv array to execFile/spawn without a shell.',
    re: /\bexec(?:Sync)?\s*\([^)]*(?:`\$\{|\$\{|['"]\s*\+)/
  },
  {
    id: 'SEC-XSS-INNERHTML',
    severity: 'high',
    type: 'Cross-Site Scripting (XSS)',
    message: 'Direct innerHTML assignment renders unsanitized HTML — user data here enables script injection.',
    recommendation: 'Use textContent, sanitize with DOMPurify, or build DOM nodes programmatically.',
    re: /\.innerHTML\s*=/
  },
  {
    id: 'SEC-XSS-DANGEROUS',
    severity: 'high',
    type: 'Cross-Site Scripting (XSS)',
    message: 'dangerouslySetInnerHTML injects raw HTML into the DOM — unsanitized data enables XSS.',
    recommendation: 'Render content as text or sanitize the HTML before injecting it.',
    re: /dangerouslySetInnerHTML/
  },
  {
    id: 'SEC-WEAKHASH',
    severity: 'medium',
    type: 'Insecure Cryptography',
    message: 'MD5/SHA-1 are cryptographically broken — unsuitable for passwords, tokens, or signatures.',
    recommendation: 'Use bcrypt/argon2 for passwords and SHA-256+ for hashing.',
    re: /\b(md5|sha1)\b|createHash\(\s*['"](md5|sha1)['"]\s*\)/i
  },
  {
    id: 'SEC-CORSWILD',
    severity: 'medium',
    type: 'CORS Misconfiguration',
    message: 'CORS configured with a wildcard origin allows any website to call this API with user credentials.',
    recommendation: 'Restrict origin to an explicit allow-list of trusted domains.',
    re: /origin\s*:\s*['"]\*['"]/
  },
  {
    id: 'SEC-WEAKRANDOM',
    severity: 'medium',
    type: 'Insecure Randomness',
    message: 'Security-sensitive value derived from Math.random(), which is predictable and not cryptographically secure.',
    recommendation: 'Use crypto.randomBytes / crypto.getRandomValues for tokens, secrets, and nonces.',
    re: /(token|secret|password|nonce|otp|session_?id)[^\n]{0,40}Math\.random|Math\.random[^\n]{0,40}(token|secret|password)/i
  }
];

/** Regex that matches hardcoded credential assignments (per-line scanning). */
const HARDCODED_SECRET_RE =
  /\b(password|passwd|pwd|secret|api_?key|apikey|auth_?token|access_?token|private_?key|client_?secret|encryption_?key)\s*["']?\s*[:=]\s*["']([^"'\n]{4,})["']/i;

/** Find the 1-based line number of the first match of a regex in code. */
function firstMatchLine(code: string, re: RegExp): number | undefined {
  const m = code.match(re);
  if (!m || m.index === undefined) return undefined;
  return code.slice(0, m.index).split('\n').length;
}

export function fallbackSecurityScan(filePath: string, code: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  // Legacy checks preserved for compatibility with existing findings consumers.
  if (code.includes('dev_fallback_secret_change_in_production') || code.includes('secret = "')) {
    issues.push({
      id: 'SEC-001',
      line: 4,
      severity: 'medium',
      type: 'Fallback Secret Used',
      message: 'JWT secret utilizes fallback string. Ensure JWT_SECRET environment variable is set in production.',
      recommendation: 'Enforce process.env.JWT_SECRET throw error if undefined in production runtime.'
    });
  }

  if (code.includes('req.body') && !code.includes('zod') && !code.includes('validate')) {
    issues.push({
      id: 'SEC-002',
      line: 15,
      severity: 'low',
      type: 'Unsanitized Request Body',
      message: 'Direct usage of req.body properties without explicit schema validation.',
      recommendation: 'Implement Zod or express-validator middleware to enforce request body type safety.'
    });
  }

  // Hardcoded credentials — scanned PER LINE so assignments pulled from
  // process.env on the same line don't trigger false positives.
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/process\.env/.test(line)) continue;
    const m = line.match(HARDCODED_SECRET_RE);
    if (m) {
      issues.push({
        id: 'SEC-HARDCRED',
        line: i + 1,
        severity: 'high',
        type: 'Hardcoded Credential',
        message: `Credential "${m[1]}" appears to be hardcoded as a literal string.`,
        recommendation: 'Load credentials from environment variables or a secret manager; rotate any committed values.'
      });
      break; // one finding per file is enough signal
    }
  }

  // Deterministic rule sweep.
  for (const rule of SCAN_RULES) {
    const m = code.match(rule.re);
    if (m) {
      issues.push({
        id: rule.id,
        line: firstMatchLine(code, rule.re),
        severity: rule.severity,
        type: rule.type,
        message: rule.message,
        recommendation: rule.recommendation
      });
    }
  }

  return issues;
}

export function fallbackCodeReview(files: Record<string, string>): CodeReviewResult {
  const contents = Object.values(files);
  const fileCount = contents.length;

  let qualityScore = 90;
  let securityScore = 92;
  let flagged = 0;

  for (const code of contents) {
    if (/password\s*[:=]\s*['"][^'"]{4,}['"]|secret\s*[:=]/.test(code)) {
      flagged++;
      securityScore -= 14;
    }
    if (/sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/.test(code)) {
      flagged++;
      securityScore -= 18;
    }
    if (/TODO|FIXME|placeholder|coming soon/i.test(code)) qualityScore -= 4;
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(code)) qualityScore -= 3;
    if (!code.trim() || code.trim().length < 60) qualityScore -= 5;
  }

  if (fileCount === 0) {
    qualityScore = 40;
    securityScore = 40;
  }

  qualityScore = Math.max(30, qualityScore);
  securityScore = Math.max(30, securityScore);
  const perfScore = Math.max(30, 92 - Math.floor(fileCount / 2));
  const maintainabilityScore = Math.max(30, qualityScore - 2);

  const overallScore = Math.round((qualityScore + securityScore + perfScore + maintainabilityScore) / 4);
  const passed = overallScore >= 70 && flagged === 0;
  const overallGrade = overallScore >= 90 ? 'A' : overallScore >= 80 ? 'B' : overallScore >= 70 ? 'C' : overallScore >= 60 ? 'D' : 'F';

  return {
    overallGrade: overallGrade as CodeReviewResult['overallGrade'],
    overallScore,
    qualityScore,
    securityScore,
    perfScore,
    maintainabilityScore,
    suggestions: [
      'Add strict Zod input validation schemas on express request payloads.',
      'Implement global Express error-handling middleware to prevent leak of internal stack traces.',
      'Add unit test suite using Vitest or Jest for JWT token validation.'
    ],
    passed
  };
}
