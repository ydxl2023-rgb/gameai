import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ReviewError} from './requirements.js';

const text = z.string().trim().min(1).max(4000);
const reportSchema = z.object({
    outcome:z.enum(['ready','revision_required','needs_input','execution_error']),
    summary:text,
    issues:z.array(z.object({section:text,evidence:text,impact:text,suggestion:text}).strict()).max(30),
    tasks:z.array(z.unknown())
}).strict();

export function parsePmOutcome(raw)
{
    // Historical successful proposals remain readable; empty legacy proposals are never silently repaired.
    if (!raw.outcome && raw.tasks?.length) return {outcome:'ready',summary:raw.summary,issues:[],tasks:raw.tasks};
    const report = reportSchema.parse(raw);
    if (report.outcome !== 'ready' && (report.tasks.length || !report.issues.length)) throw new ReviewError('PM 阻塞报告必须包含具体问题且不能包含任务。');
    if (report.outcome === 'ready' && (!report.tasks.length || report.issues.length)) throw new ReviewError('PM 成功结果必须包含任务且不能包含未解决问题。');
    return report;
}

export function issueFingerprint(issues)
{
    const normalized = issues.map(i => [i.section,i.evidence].map(s => s.normalize('NFKC').replace(/\s+/g,'').toLowerCase()).join('|')).sort();
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export async function recordPmBlock(pool, job, raw)
{
    const report = parsePmOutcome(raw);
    if (!['revision_required','needs_input'].includes(report.outcome)) throw new ReviewError('此结果不能进入需求修订。');
    const c = await pool.connect();
    try
    {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.project_id]);
        const current = (await c.query('SELECT * FROM gameai.pm_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
        if (!current || current.execution_id !== job.execution_id) throw new ReviewError('PM 执行已过期。');
        const proof = await c.query(`SELECT 1 FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id
            JOIN gameai.fixed_agents f ON f.project_id=s.project_id AND f.role_code='PM' AND f.agent_id=s.agent_id
            WHERE r.execution_id=$1 AND r.state='completed' AND s.project_id=$2`,[job.execution_id,job.project_id]);
        if (!proof.rowCount) throw new ReviewError('缺少固定 PM 已完成执行证据，不能自动修订。');
        const prior = (await c.query('SELECT * FROM gameai.requirement_revisions WHERE source_version_id=$1',[job.requirement_version_id])).rows[0];
        if (prior)
        {
            await c.query('COMMIT');
            return prior;
        }
        const source = (await c.query('SELECT * FROM gameai.requirement_versions WHERE id=$1',[job.requirement_version_id])).rows[0];
        const history = (await c.query(`SELECT r.* FROM gameai.requirement_revisions r JOIN gameai.requirement_versions v ON v.id=r.source_version_id WHERE v.requirement_id=$1`,[source.requirement_id])).rows;
        const fingerprint = issueFingerprint(report.issues);
        const round = history.length+1;
        const stale = (await c.query('SELECT 1 FROM gameai.requirement_versions WHERE requirement_id=$1 AND ordinal>$2',[source.requirement_id,source.ordinal])).rowCount;
        const design = (await c.query(`SELECT s.agent_id FROM gameai.agent_runs r JOIN gameai.agent_conversations s ON s.id=r.conversation_id WHERE r.execution_id=$1 AND s.project_id=$2 AND s.role_code='Design' AND r.state='completed'`,[source.content.execution_id,job.project_id])).rows[0];
        const reason = stale ? '已有较新需求版本，停止旧版本修订。' : report.outcome==='needs_input' ? '需要人工明确结论，请在初稿对话解决后提交新版本。' : round>2 ? '已达到两轮自动修订上限，需要人工处理。' : history.some(r=>r.fingerprint===fingerprint) ? '同一问题重复出现，需要人工处理。' : !design ? '无法确定原 Design Agent，需要人工核实。' : '';
        const state = stale ? 'superseded' : reason ? 'needs_input' : 'queued';
        const target = source.version.slice(0,20)+'-fix'+round;
        const saved = (await c.query(`INSERT INTO gameai.requirement_revisions(project_id,source_version_id,pm_job_id,design_agent_id,report,fingerprint,round,target_version,state,error)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[job.project_id,source.id,job.id,design?.agent_id??null,report,fingerprint,round,target,state,reason])).rows[0];
        const message = [report.summary,...report.issues.map(i=>`${i.section}：${i.evidence}；影响：${i.impact}；建议：${i.suggestion}`),reason].filter(Boolean).join('\n');
        await c.query("UPDATE gameai.pm_jobs SET state='revision_required',error=$2,finished_at=now() WHERE id=$1",[job.id,message]);
        await c.query("UPDATE gameai.approval_workflows SET state='failed',error=$2,updated_at=now() WHERE version_id=$1 AND state IN ('queued','pm')",[source.id,message]);
        await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'agent:PM','需求退回修订',$2)",[job.project_id,{revision_id:saved.id,version_id:source.id,state,report,reason,summary:message}]);
        await c.query('COMMIT');
        return saved;
    }
    catch (error)
    {
        await c.query('ROLLBACK');
        throw error;
    }
    finally
    {
        c.release();
    }
}
