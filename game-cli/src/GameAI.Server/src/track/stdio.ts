import { readFile } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './http.js';

// Codex owns this process. stdout is reserved exclusively for MCP frames.
const html = await readFile(new URL('../../public/track.html', import.meta.url), 'utf8');
const server = createMcpServer(html);
await server.connect(new StdioServerTransport());
process.stdin.once('end', () => void server.close());
process.once('SIGINT', () => void server.close());
process.once('SIGTERM', () => void server.close());
