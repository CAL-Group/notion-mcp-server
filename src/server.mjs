import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

if (process.env.NOTION_TOKEN) process.env.NOTION_TOKEN = process.env.NOTION_TOKEN.trim();

// ── One persistent connection to notion-mcp-server ──────────────────────────
async function connectBackend() {
  const transport = new StdioClientTransport({
    command: 'notion-mcp-server',
    env: { ...process.env },
  });
  const client = new Client({ name: 'proxy', version: '1.0' }, { capabilities: {} });
  await client.connect(transport);
  console.log('[proxy] Connected to notion-mcp-server');
  return client;
}

let backend = await connectBackend();
const { tools } = await backend.listTools();
console.log(`[proxy] ${tools.length} Notion tools ready`);

// ── HTTP server ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-api-key, mcp-session-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.post('/mcp', async (req, res) => {
  const server = new Server(
    { name: 'notion-mcp-proxy', version: '1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return backend.callTool(request.params);
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(8080, () => console.log('[proxy] Listening on :8080'));
