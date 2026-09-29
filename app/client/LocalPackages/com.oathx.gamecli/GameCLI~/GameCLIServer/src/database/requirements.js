import { createHash } from 'node:crypto';
import { z } from 'zod';

export class ReviewError extends Error {}
const submission = z.object({
    request_id: z.uuid(), requirement_key: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,63}$/),
    title: z.string().trim().min(1).max(200), version: z.string().regex(/^[a-zA-Z0-9._-]{1,40}$/),
    html: z.string().min(100).max(5 * 1024 * 1024), sha256: z.string().regex(/^[0-9a-f]{64}$/),
    execution_id: z.string().min(1).max(100), thread_id: z.string().min(1).max(200),
    summary: z.string().min(1).max(4000)
}).strict();
const decisionInput = z.object({ version_id: z.uuid(), revision: z.string().regex(/^[0-9a-f]{64}$/),
    document_hash: z.string().regex(/^[0-9a-f]{64}$/), decision: z.enum(['approved','rejected']),
    reason: z.string().trim().max(2000).default(''), auto_start:z.boolean().default(false) }).strict();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function parse(schema, raw)
{
    const value = schema.safeParse(raw);
    if (!value.success)
    {
        throw new ReviewError('提交字段无效。');
    }
    return value.data;
}
export async function submitRequirement(pool, projectKey, raw)
{
    const input = parse(submission, raw);
    const bytes = Buffer.from(input.html, 'utf8');
    if (bytes.length > 5 * 1024 * 1024 || hash(bytes) !== input.sha256 || !/<html[ >]/i.test(input.html) || !/<\/html>/i.test(input.html))
    {
        throw new ReviewError('HTML 大小、格式或哈希校验失败。');
    }
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        const project = (await client.query('SELECT id FROM gameai.projects WHERE project_key=$1', [projectKey])).rows[0];
        if (!project)
        {
            throw new ReviewError('项目不存在。');
        }
        // One project lock serializes version allocation and request replay.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [project.id]);
        const scope = 'requirement-submit:' + project.id;
        const requestHash = hash(JSON.stringify(input));
        const prior = (await client.query('SELECT * FROM gameai.idempotency_records WHERE scope=$1 AND key=$2', [scope,input.request_id])).rows[0];
        if (prior)
        {
            if (prior.request_hash !== requestHash)
            {
                throw new ReviewError('重复请求内容不一致。');
            }
            await client.query('COMMIT');
            return prior.response;
        }
        const fixed = (await client.query("SELECT agent_id FROM gameai.fixed_agents WHERE project_id=$1 AND role_code='Design'", [project.id])).rows[0];
        if (fixed)
        {
            const execution = await client.query(`SELECT 1 FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id
                WHERE r.execution_id=$1 AND r.state='completed' AND s.project_id=$2 AND s.requirement_key=$3
                AND s.role_code='Design' AND s.thread_id=$4 AND s.agent_id=$5`, [input.execution_id,project.id,input.requirement_key,input.thread_id,fixed.agent_id]);
            if (!execution.rowCount)
            {
                throw new ReviewError('文档必须来自该需求的固定 Design Agent 已完成执行。');
            }
        }
        const requirement = (await client.query(`INSERT INTO gameai.requirements(project_id,requirement_key,title) VALUES($1,$2,$3)
            ON CONFLICT(project_id,requirement_key) DO UPDATE SET title=gameai.requirements.title RETURNING id,title`, [project.id,input.requirement_key,input.title])).rows[0];
        if (requirement.title !== input.title)
        {
            throw new ReviewError('已有需求标题不一致，请使用原编号与标题。');
        }
        const ordinal = (await client.query('SELECT COALESCE(max(ordinal),0)+1 n FROM gameai.requirement_versions WHERE requirement_id=$1', [requirement.id])).rows[0].n;
        const content = { summary: input.summary, rules: [], changes: ['Design Agent 生成原始 HTML，等待人工审批'], execution_id: input.execution_id, thread_id: input.thread_id };
        const revision = hash(JSON.stringify({ content, html_hash: input.sha256, version: input.version }));
        const version = (await client.query(`INSERT INTO gameai.requirement_versions(project_id,requirement_id,version,ordinal,content,content_hash)
            VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [project.id,requirement.id,input.version,ordinal,content,revision])).rows[0];
        const storageKey = 'uploaded/' + version.id + '.html';
        const artifact = (await client.query(`INSERT INTO gameai.artifacts(project_id,storage_key,sha256,byte_size,media_type,verified_at)
            VALUES($1,$2,$3,$4,'text/html',now()) RETURNING id`, [project.id,storageKey,input.sha256,bytes.length])).rows[0];
        await client.query('INSERT INTO gameai.document_contents(artifact_id,bytes) VALUES($1,$2)', [artifact.id,bytes]);
        await client.query('INSERT INTO gameai.artifact_links(project_id,artifact_id,requirement_version_id) VALUES($1,$2,$3)', [project.id,artifact.id,version.id]);
        const result = { requirement_key: input.requirement_key, version_id: version.id, version: input.version, revision, document_hash: input.sha256, artifact_id: artifact.id, status: '待审批' };
        await client.query('INSERT INTO gameai.idempotency_records(scope,key,request_hash,response) VALUES($1,$2,$3,$4)', [scope,input.request_id,requestHash,result]);
        await client.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'agent:Design','提交策划文档，等待人工审批',$2)`, [project.id,result]);
        await client.query('COMMIT');
        return result;
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        if (error.code === '23505')
        {
            throw new ReviewError('需求版本已存在，请使用新版本或原请求编号重试。');
        }
        throw error;
    }
    finally
    {
        client.release();
    }
}
export async function reviewRequirement(pool, projectKey, userId, raw)
{
    const input = parse(decisionInput, raw);
    if (input.auto_start && input.decision!=='approved') throw new ReviewError('拒绝版本不能授权自动执行。');
    if (input.decision === 'rejected' && !input.reason)
    {
        throw new ReviewError('拒绝时必须填写原因。');
    }
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        const target = (await client.query(`SELECT v.* FROM gameai.requirement_versions v JOIN gameai.projects p ON p.id=v.project_id
            WHERE p.project_key=$1 AND v.id=$2`, [projectKey,input.version_id])).rows[0];
        if (!target)
        {
            throw new ReviewError('需求版本不存在。');
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [target.project_id]);
        const permission = await client.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
            JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code WHERE u.id=$1 AND u.enabled AND ur.project_id=$2 AND rp.permission_code='requirement.approve'`, [userId,target.project_id]);
        if (!permission.rowCount)
        {
            throw new ReviewError('当前人工账户没有审批权限。');
        }
        const latest = await client.query('SELECT 1 FROM gameai.requirement_versions WHERE requirement_id=$1 AND ordinal>$2', [target.requirement_id,target.ordinal]);
        if (latest.rowCount || target.content_hash !== input.revision)
        {
            throw new ReviewError('需求版本已更新，请刷新后重新审阅。');
        }
        const artifact = (await client.query(`SELECT a.*,d.bytes FROM gameai.artifact_links l JOIN gameai.artifacts a ON a.id=l.artifact_id
            JOIN gameai.document_contents d ON d.artifact_id=a.id WHERE l.requirement_version_id=$1 AND a.media_type='text/html'`, [target.id])).rows[0];
        if (!artifact || !artifact.verified_at || artifact.sha256 !== input.document_hash || hash(artifact.bytes) !== input.document_hash)
        {
            throw new ReviewError('原始上传文档未核验或内容不匹配。');
        }
        const prior = (await client.query('SELECT * FROM gameai.approvals WHERE version_id=$1', [target.id])).rows[0];
        if (prior)
        {
            const automatic=(await client.query('SELECT 1 FROM gameai.approval_workflows WHERE version_id=$1',[target.id])).rowCount>0;
            if (automatic!==input.auto_start) throw new ReviewError('此版本已审批，不能改变原自动执行授权。');
            if (prior.user_id !== userId || prior.decision !== input.decision || prior.reason !== input.reason)
            {
                throw new ReviewError('该版本已经审批，不能覆盖决定。');
            }
            await client.query('COMMIT');
            return { decision: prior.decision, repeated: true };
        }
        await client.query('INSERT INTO gameai.approvals(project_id,version_id,user_id,decision,reason) VALUES($1,$2,$3,$4,$5)', [target.project_id,target.id,userId,input.decision,input.reason]);
        if (input.auto_start) await client.query('INSERT INTO gameai.approval_workflows(version_id,project_id,requested_by,revision,document_hash) VALUES($1,$2,$3,$4,$5)',[target.id,target.project_id,userId,input.revision,input.document_hash]);
        await client.query('INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,$3,$4)', [target.project_id,'human:'+userId,input.decision === 'approved' ? '人工批准需求版本' : '人工退回需求版本',input]);
        await client.query('COMMIT');
        return { decision: input.decision, repeated: false };
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        throw error;
    }
    finally
    {
        client.release();
    }
}
