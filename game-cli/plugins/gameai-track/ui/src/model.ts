export type Identity = 'design' | 'admin' | 'art' | 'dev' | 'qa' | 'pm';
export interface Task { content_revision?:number; edit_history?:{revision:number;field:string;before_value:string|string[];after_value:string|string[];reason:string;created_at:string;actor:string}[]; requirement_version_id?:string; document_url?:string | null; executor_agent?:string | null; requirement_key?:string; repair?:{source_task:string;qa_task:string;state:string;rounds:number;details:{actual:string;evidence_path:string}} | null; bound_agent?:string | null; last_result?:string; task_uuid?: string; dispatch_allowed?: boolean; dispatch_revision?: number; parent_id?: string | null; description?: string; source_refs?: string[]; criteria?: {kind:string;text:string}[]; id: string; title: string; role: string; agent: string | null; status: string; progress: number; dependencies: string[]; version: string; }
export interface Agent { auto_execute?:boolean; automation_revision?:number; fixed?: boolean; name?: string; enabled?: boolean; skills?: { key: string; primary: boolean; hash: string }[]; id: string; role: string; status: string; task: string | null; used: number; capacity: number; station: string; read: boolean; write: boolean; }
export interface Version { version: string; status: string; change: string; reference: string; revision: string; content: { summary: string; rules: string[]; changes: string[] }; }
export interface RequirementRow { approval_workflow?:{state:string;error:string}; pm_job?: {state:'running'|'completed'|'failed'|'unknown';error:string;task_count:number;attempts:number} | null; version_id?: string; document_hash?: string | null; id: string; title: string; version: string; revision: string; status: string; document_path: string | null; document_url?: string | null; created_at: string | null; summary: string; rules: string[]; changes: string[]; }
export interface Activity { id:string; time:string; actor:string; requirement:string | null; task:string | null; level:string; message:string; }
export interface Workbench { activity?:Activity[]; flows?:{state:string;reason:string;requirement_key:string}[]; requirements?: RequirementRow[]; project: { key: string; name: string }; requirement: { title: string; version: string; revision: string; status: string; summary: string; rules: string[]; changes: string[] }; tasks: Task[]; agents: Agent[]; versions?: Version[]; audit?: Audit[]; }
export interface Snapshot { schema_version: 2; mode: 'demo' | 'postgres'; is_test?: boolean; server_time: string; request_id: string; workbench: Workbench; }
export interface Audit { id: number | string; time: string; actor: string; event: string; }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
export function parseSnapshot(value: unknown): Snapshot
{
    if (!object(value) || value.schema_version !== 2 || !['demo', 'postgres'].includes(String(value.mode)) || typeof value.server_time !== 'string' || !Number.isFinite(Date.parse(value.server_time)) || typeof value.request_id !== 'string' || !object(value.workbench)) throw new Error('快照协议不兼容，请重新连接新版 MCP 服务。');
    const w = value.workbench;
    if (!object(w.project) || typeof w.project.key !== 'string' || typeof w.project.name !== 'string' || !object(w.requirement)) throw new Error('项目或需求数据无效。');
    const r = w.requirement;
    if (!['title', 'version', 'revision', 'status', 'summary'].every(k => typeof r[k] === 'string') || !strings(r.rules) || !strings(r.changes)) throw new Error('需求版本字段无效。');
    if (!Array.isArray(w.tasks) || w.tasks.length > 1000 || !w.tasks.every(t => object(t) && ['id', 'title', 'role', 'status', 'version'].every(k => typeof t[k] === 'string') && (t.agent === null || typeof t.agent === 'string') && typeof t.progress === 'number' && t.progress >= 0 && t.progress <= 100 && strings(t.dependencies))) throw new Error('任务字段无效。');
    if (!Array.isArray(w.agents) || w.agents.length > 1000 || !w.agents.every(a => object(a) && ['id', 'role', 'status', 'station'].every(k => typeof a[k] === 'string') && (a.task === null || typeof a.task === 'string') && Number.isInteger(a.used) && Number.isInteger(a.capacity) && Number(a.used) >= 0 && Number(a.capacity) >= Number(a.used) && typeof a.read === 'boolean' && typeof a.write === 'boolean')) throw new Error('Agent 字段无效。');
    if (w.requirements !== undefined && (!Array.isArray(w.requirements) || !w.requirements.every(r => object(r) && ['id', 'title', 'version', 'revision', 'status', 'summary'].every(k => typeof r[k] === 'string') && (r.document_path === null || typeof r.document_path === 'string') && strings(r.rules) && strings(r.changes)))) throw new Error('需求列表字段无效。');
    return value as unknown as Snapshot;
}
export function canApprove(identity: Identity, version: string, data: Workbench): boolean
{
    return identity === 'design' && version === data.requirement.version && data.requirement.status === '待审批';
}
