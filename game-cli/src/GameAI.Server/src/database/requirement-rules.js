import {digest} from './ui-production-contract.js';
import {loadSkillInstructions,isPrimarySkill} from './skill-catalog.js';


export async function captureRequirementRules(c,projectId,executionId)
{
    const catalog=(await c.query('SELECT * FROM gameai.skills')).rows;
    const bindings=(await c.query(`SELECT s.*,g.is_primary FROM gameai.fixed_agents f
        JOIN gameai.agent_skills g ON g.agent_id=f.agent_id JOIN gameai.skills s ON s.skill_key=g.skill_key
        WHERE f.project_id=$1`,[projectId])).rows;
    const recorded=(await c.query(`SELECT payload->'project_skills' snapshot FROM gameai.audit_events
        WHERE project_id=$1 AND event='固定 Agent 开始执行' AND payload->>'execution_id'=$2 ORDER BY id DESC LIMIT 1`,[projectId,executionId])).rows[0];
    const roles={};
    for (const role of ['Design','PM','Prefab','Art','Development','QA'])
    {
        const selected=bindings.filter(s=>s.role_code===role);
        const sources=selected.length?selected:catalog.filter(s=>s.enabled && s.role_code===role && isPrimarySkill(s));
        if (!sources.length) continue;
        roles[role]=await loadSkillInstructions(sources,catalog,undefined,role);
    }
    const content={schemaVersion:1,capturedAt:'requirement-submission',roles,projectSkills:recorded?.snapshot ?? []};
    return {content,sha256:digest(content)};
}

export async function readRequirementRules(c,versionId,role)
{
    if (!versionId) return null;
    const row=(await c.query('SELECT * FROM gameai.requirement_rule_snapshots WHERE version_id=$1',[versionId])).rows[0];
    const bound=(await c.query("SELECT content->>'rule_snapshot_hash' hash FROM gameai.requirement_versions WHERE id=$1",[versionId])).rows[0];
    if (!row && !bound?.hash) return null; // Legacy approvals have no invented historical snapshot.
    if (!row) throw new Error('需求规则快照缺失');
    if (bound?.hash!==row.sha256 || digest(row.content)!==row.sha256) throw new Error('需求规则快照绑定失效');
    if (!row.content.roles[role]) throw new Error('需求规则快照缺少角色：'+role);
    return {instructions:row.content.roles[role],projectSkills:row.content.projectSkills,sha256:row.sha256};
}
