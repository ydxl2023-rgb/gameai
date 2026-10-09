import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * Hosts platform endpoints without maintaining a second workflow store.
 * @param {{additionalHttpHandler?: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<boolean>, log?: (message: string, details: object) => void}} options
 */
export function createGameCliServer({ additionalHttpHandler, log = (_message, _details) => {} } = {})
{
    const server = createServer(async (request, response) =>
    {
        const requestId = randomUUID();
        const started = Date.now();
        response.setHeader('X-Request-Id', requestId);
        // Never log query strings, request bodies or authentication headers.
        log('收到 HTTP 请求。', { request_id: requestId, method: request.method });
        response.once('finish', () => log('HTTP 请求完成。', { request_id: requestId, status: response.statusCode, duration_ms: Date.now() - started }));
        try
        {
            if (additionalHttpHandler && await additionalHttpHandler(request, response))
            {
                return;
            }
            const path = new URL(request.url ?? '/', 'http://localhost').pathname;
            if (path === '/health' && request.method === 'GET')
            {
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ ok: true, service: 'gamecli-server' }));
                return;
            }
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: '接口不存在。' }));
        }
        catch
        {
            log('HTTP 请求处理失败。', { level: 'error', request_id: requestId });
            if (!response.headersSent)
            {
                response.writeHead(500, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ error: '服务处理失败。' }));
            }
            else
            {
                response.destroy();
            }
        }
    });
    server.on('upgrade', (_request, socket) =>
    {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    });
    let closing;
    return {
        server,
        close()
        {
            // Closing twice or after a startup failure must be safe.
            closing ??= new Promise(resolve =>
            {
                server.close(resolve);
                server.closeAllConnections();
            });
            return closing;
        }
    };
}
