import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn } from 'child_process';

const API_KEY = process.env.MCP_API_KEY;
const GATEWAY_PORT = 3001;

if (!API_KEY) throw new Error('MCP_API_KEY environment variable is required');

// Start supergateway on internal port
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
  process.exit(1);
});

// Poll until supergateway is actually ready (up to 30s)
const waitForGateway = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${GATEWAY_PORT}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'healthcheck', version: '0' } } }),
      });
      if (res.status < 500) {
        console.log('[auth-proxy] supergateway ready');
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('supergateway did not become ready in 30s');
};

await waitForGateway();

const app = express();

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-api-key, mcp-session-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
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

app.listen(8080, () =>
  console.log('[auth-proxy] Listening on :8080, forwarding to supergateway on :' + GATEWAY_PORT)
);
