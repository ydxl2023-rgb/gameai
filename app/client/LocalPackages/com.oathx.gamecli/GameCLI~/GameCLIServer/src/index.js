import { createGameCliServer } from './server.js';

try
{
    const port = Number(process.env.GAMECLI_PORT ?? 8088);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
    {
        throw new Error('服务端口无效。');
    }
    const app = createGameCliServer({
        clientToken: process.env.GAMECLI_SERVER_TOKEN,
        webhookToken: process.env.GAMECLI_WEBHOOK_TOKEN,
        projects: (process.env.GAMECLI_PROJECT_KEYS ?? '').split(',').map(value => value.trim()).filter(Boolean)
    });
    app.server.on('error', () =>
    {
        console.error('服务监听失败，请检查地址和端口。');
        process.exitCode = 1;
        void app.close();
    });
    app.server.listen(port, process.env.GAMECLI_HOST ?? '127.0.0.1', () =>
    {
        console.log(JSON.stringify({ type: 'server.started', protocol_version: 1, port }));
    });
    let stopping = false;
    async function stop()
    {
        if (!stopping)
        {
            stopping = true;
            await app.close();
        }
    }
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
catch (error)
{
    console.error(error.message);
    process.exitCode = 1;
}
