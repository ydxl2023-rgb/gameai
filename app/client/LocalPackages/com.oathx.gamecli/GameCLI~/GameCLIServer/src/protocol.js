import { randomUUID } from 'node:crypto';

export const protocolVersion = 1;
export const projectPattern = /^[A-Z][A-Z0-9_]{0,63}$/;
const issuePattern = /^[A-Z][A-Z0-9_]{0,63}-[1-9][0-9]*$/;

export function message(type, payload)
{
    return {
        protocol_version: protocolVersion,
        message_id: randomUUID(),
        type,
        sent_at: new Date().toISOString(),
        payload
    };
}

export function parseMessage(bytes)
{
    const value = JSON.parse(bytes.toString('utf8'));
    if (value?.protocol_version !== protocolVersion || typeof value.message_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.message_id) || !Number.isFinite(Date.parse(value.sent_at)) || typeof value.type !== 'string' || !value.payload || Array.isArray(value.payload) || typeof value.payload !== 'object')
    {
        throw new Error('消息协议无效。');
    }
    return value;
}

function shortText(value, maximum = 200)
{
    return typeof value === 'string' ? value.slice(0, maximum) : null;
}

// Forward a bounded event hint, never credentials, descriptions, comments or user profiles.
export function normalizeJiraEvent(value)
{
    if (!['jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted'].includes(value?.webhookEvent))
    {
        return null;
    }
    const key = value.issue?.key;
    const fields = value.issue?.fields;
    const project = fields?.project?.key ?? (typeof key === 'string' ? key.slice(0, key.lastIndexOf('-')) : null);
    if (typeof key !== 'string' || !issuePattern.test(key) || typeof project !== 'string' || !projectPattern.test(project) || !key.startsWith(project + '-') || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0)
    {
        throw new Error('单据事件缺少有效的项目、编号或时间。');
    }
    const items = Array.isArray(value.changelog?.items) ? value.changelog.items : [];
    const change = items.find(item => item?.field === 'status' || item?.fieldId === 'status');
    const parent = fields?.parent?.key;
    return {
        project_key: project,
        issue_key: key,
        parent_key: typeof parent === 'string' && issuePattern.test(parent) ? parent : null,
        event_name: value.webhookEvent,
        jira_timestamp: value.timestamp,
        status: fields?.status ? { id: shortText(fields.status.id), name: shortText(fields.status.name) } : null,
        status_change: change ? { from: shortText(change.fromString), to: shortText(change.toString) } : null
    };
}
