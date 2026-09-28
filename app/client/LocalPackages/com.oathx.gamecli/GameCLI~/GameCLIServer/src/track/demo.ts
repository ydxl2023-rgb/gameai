import { createGameCliServer } from '../server.js';
import { handleTrackRequest } from './http.js';

const port = Number(process.env.GAMECLI_TRACK_PORT ?? 8090);
if (!Number.isInteger(port) || port < 1 || port > 65535)
{
    throw new Error('GAMECLI_TRACK_PORT 必须是有效端口。');
}
const app = createGameCliServer({
    additionalHttpHandler: handleTrackRequest,
    log: (message: string) => console.log(message)
});
app.server.on('error', (error: Error) =>
{
    console.error(error.message);
    process.exitCode = 1;
    void app.close();
});
app.server.listen(port, '127.0.0.1', () => console.log(`GameAI Track：http://127.0.0.1:${port}/track；MCP：/mcp；数据源：${process.env.GAMEAI_STORAGE === 'postgres' ? 'PostgreSQL' : '演示'}`));
process.once('SIGINT', () => void app.close());
process.once('SIGTERM', () => void app.close());
