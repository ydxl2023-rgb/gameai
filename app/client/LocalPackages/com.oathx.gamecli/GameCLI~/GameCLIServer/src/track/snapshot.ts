import { randomUUID } from 'node:crypto';

export function createSnapshot()
{
    return {
        schema_version: 1,
        mode: 'demo',
        server_time: new Date().toISOString(),
        request_id: randomUUID(),
        project_key: 'DEMO',
        notice: '模拟数据：不代表 JIRA 任务或真实 Agent；本版本不创建任务、不启动执行。',
        tasks: [
            { agent: 'design-demo', role: 'Design', task: 'DEMO-1', status: '模拟执行中', activity: '演示需求分析', elapsed: '02:31' },
            { agent: 'pm-demo', role: 'PM', task: 'DEMO-2', status: '模拟等待', activity: '演示等待需求批准', elapsed: '—' },
            { agent: 'art-demo', role: 'Art', task: 'DEMO-3', status: '模拟空闲', activity: '演示可用节点', elapsed: '—' }
        ]
    };
}
