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
  ],
  { stdio: 'inherit', env: process.env }
);

gateway.on('exit', (code) => {
  console.error(`supergateway exited with code ${code}`);
  process.exit(1);
});

// Give supergateway a moment to start
await new Promise((r) => setTimeout(r, 2000));

const app = express();

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

// Proxy everything to supergateway
app.use(
  createProxyMiddleware({
    target: `http://localhost:${GATEWAY_PORT}`,
    changeOrigin: true,
    // Required for SSE / streaming responses
    on: {
      proxyRes: (proxyRes) => {
        proxyRes.headers['cache-control'] = 'no-cache';
      },
    },
  })
);

app.listen(8080, () =>
  console.log('[auth-proxy] Listening on :8080, forwarding to supergateway on :' + GATEWAY_PORT)
);
