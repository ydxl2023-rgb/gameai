import { createGameCliServer } from './server.js';
import { handleTrackRequest } from './track/http.js';

const port = Number(process.env.GAMECLI_PORT ?? 8088);
if (!Number.isInteger(port) || port < 1 || port > 65535)
{
    throw new Error('服务端口无效。');
}
const host = process.env.GAMECLI_HOST ?? '127.0.0.1';
function log(message, details = {})
{
    console.log('[' + new Date().toISOString() + '] ' + message + ' ' + JSON.stringify(details));
}
const app = createGameCliServer({ additionalHttpHandler: handleTrackRequest, log });
app.server.on('error', error =>
{
    log('服务监听失败。', { error_code: error.code, host, port });
    process.exitCode = 1;
    void app.close();
});
app.server.listen(port, host, () => log('平台服务已启动。', { host, port, process_id: process.pid, track: '/track', mcp: '/mcp' }));
process.once('SIGINT', () => void app.close());
process.once('SIGTERM', () => void app.close());
