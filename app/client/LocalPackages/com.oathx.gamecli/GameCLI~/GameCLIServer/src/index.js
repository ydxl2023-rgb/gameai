import { createGameCliServer } from './server.js';

try
{
    const port = Number(process.env.GAMECLI_PORT ?? 8088);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
    {
        throw new Error('服务端口无效。');
    }
    const host = process.env.GAMECLI_HOST ?? '127.0.0.1';
    const projects = (process.env.GAMECLI_PROJECT_KEYS ?? '').split(',').map(value => value.trim()).filter(Boolean);
    function log(message, details = {})
    {
        const { level = 'info', ...fields } = details;
        const levels = { info: '信息', warn: '警告', error: '错误' };
        console.log('[' + new Date().toLocaleString('zh-CN', { hour12: false }) + '] [' + levels[level] + '] ' + message + ' ' + JSON.stringify(fields));
    }
    const app = createGameCliServer({
        webhookToken: process.env.GAMECLI_WEBHOOK_TOKEN,
        projects,
        logHeartbeats: process.env.GAMECLI_LOG_HEARTBEATS === 'true',
        log
    });
    app.server.on('error', error =>
    {
        log('服务监听失败，请检查地址和端口。', { level: 'error', error_code: error.code, host, port });
        process.exitCode = 1;
        void app.close();
    });
    app.server.listen(port, host, () =>
    {
        log('服务已启动，等待 JIRA 通知和客户端连接。', { type: 'server.started', protocol_version: 1, host, port, projects, process_id: process.pid, node_version: process.versions.node });
        if (host === '127.0.0.1' || host === 'localhost' || host === '::1')
        {
            log('当前仅监听本机；JIRA 位于其他机器时，请将 GAMECLI_HOST 设置为 0.0.0.0 后重启。');
        }
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
