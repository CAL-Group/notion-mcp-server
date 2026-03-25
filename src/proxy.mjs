import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn } from 'child_process';

const API_KEY = process.env.MCP_API_KEY?.trim();
const GATEWAY_PORT = 3001;

if (!API_KEY) throw new Error('MCP_API_KEY environment variable is required');

// Trim secrets — Secret Manager sometimes includes a trailing newline
if (process.env.NOTION_TOKEN) process.env.NOTION_TOKEN = process.env.NOTION_TOKEN.trim();

let ready = false;

const app = express();

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-api-key, mcp-session-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Return 503 while supergateway is still starting
app.use((req, res, next) => {
  if (!ready) {
    res.setHeader('Retry-After', '5');
    res.status(503).json({ error: 'Server starting, retry in a few seconds' });
    return;
  }
  next();
});

// API key validation
app.use((req, res, next) => {
  const key =
    req.headers['x-api-key'] ??
    req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (key !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// Proxy to supergateway
app.use(
  createProxyMiddleware({
    target: `http://localhost:${GATEWAY_PORT}`,
    changeOrigin: true,
    on: {
      error: (err, req, res) => {
        console.error('[proxy] error:', err.message);
        res.status(502).json({ error: 'Bad gateway', detail: err.message });
      },
    },
  })
);

// Start listening immediately so Cloud Run health checks pass
app.listen(8080, () => {
  console.log('[auth-proxy] Listening on :8080 (warming up supergateway...)');
  startGateway();
});

function startGateway() {
  const gateway = spawn(
    'npx',
    [
      '-y', 'supergateway',
      '--stdio', 'npx -y @notionhq/notion-mcp-server',
      '--port', String(GATEWAY_PORT),
      '--outputTransport', 'streamableHttp',
      '--streamableHttpPath', '/mcp',
      '--cors',
    ],
    { stdio: 'inherit', env: process.env }
  );

  gateway.on('exit', (code) => {
    console.error(`supergateway exited with code ${code}`);
    ready = false;
    // Restart after a short delay
    setTimeout(startGateway, 2000);
  });

  pollUntilReady();
}

async function pollUntilReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${GATEWAY_PORT}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 0, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'healthcheck', version: '0' } },
        }),
      });
      if (res.status < 500) {
        ready = true;
        console.log('[auth-proxy] supergateway ready — accepting requests');
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error('[auth-proxy] supergateway did not become ready in 60s, restarting');
  process.exit(1);
}
