import {z} from 'zod';
import {digest} from './ui-production-contract.js';
import {ReviewError} from './requirements.js';

const text=z.string().trim().min(1).max(2000);
const patch=z.discriminatedUnion('kind',[
    z.object({kind:z.literal('position'),nodeId:text,before:z.array(z.number().finite()).length(2),after:z.array(z.number().finite()).length(2)}).strict(),
    z.object({kind:z.literal('raycast'),nodeId:text,componentId:text,before:z.number().int().min(0).max(1),after:z.number().int().min(0).max(1)}).strict(),
    z.object({kind:z.literal('raycaster'),nodeId:text,componentId:text}).strict()
]);
export const amendmentSchema=z.object({baseHash:z.string().regex(/^[a-f0-9]{64}$/),reason:text,authorizationReference:text,
    patches:z.array(patch).min(1).max(20),evidenceDirectory:z.string().regex(/^deliveries\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/),
    simulation:z.object({id:text,width:z.number().int().positive(),height:z.number().int().positive(),safeArea:z.array(z.number().finite()).length(4)}).strict()
}).strict();

// Preserve the original frozen bytes. Only explicitly reviewed input deltas are composed.
export function applyAmendment(input,raw)
{
    const amendment=amendmentSchema.parse(raw);
    if (digest(input)!==amendment.baseHash || input.type!=='prefab-assembly') throw new ReviewError('增补基线不匹配或任务不是最终装配');
    const result=structuredClone(input);
    const touched=new Set();
    for (const change of amendment.patches)
    {
        const key=change.nodeId+':'+change.kind+':'+(change.componentId ?? '');
        if (touched.has(key)) throw new ReviewError('重复增补字段');
        touched.add(key);
        const node=result.window.nodes.find(n=>n.id===change.nodeId);
        if (!node) throw new ReviewError('增补节点不存在');
        if (change.kind==='position')
        {
            if (digest(node.rect.anchoredPosition)!==digest(change.before)) throw new ReviewError('增补位置旧值不匹配');
            node.rect.anchoredPosition=change.after;
        }
        else if (change.kind==='raycast')
        {
            const component=node.components.find(c=>c.id===change.componentId && c.type==='UnityEngine.UI.Image');
            if (!component || component.properties.m_RaycastTarget!==change.before) throw new ReviewError('增补射线旧值不匹配');
            component.properties.m_RaycastTarget=change.after;
        }
        else
        {
            if (!node.components.some(c=>c.type==='UnityEngine.Canvas') || node.components.some(c=>c.id===change.componentId || c.type==='UnityEngine.UI.GraphicRaycaster')) throw new ReviewError('射线组件必须添加到未配置该组件的 Canvas');
            node.components.push({id:change.componentId,type:'UnityEngine.UI.GraphicRaycaster',properties:{m_Enabled:1,m_IgnoreReversedGraphics:1,m_BlockingObjects:0}});
        }
    }
    const [x,y,w,h]=amendment.simulation.safeArea;
    if (x<0 || y<0 || w<=0 || h<=0 || x+w>amendment.simulation.width || y+h>amendment.simulation.height) throw new ReviewError('模拟安全区越出屏幕');
    result.taskAmendments=[...(result.taskAmendments ?? []),amendment];
    return result;
}

export async function authorizeTaskAmendment(pool,taskId,userId,raw)
{
    const amendment=amendmentSchema.parse(raw);
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const task=(await c.query('SELECT * FROM gameai.tasks WHERE id=$1',[taskId])).rows[0];
        if (!task) throw new ReviewError('任务不存在');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[task.project_id]);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[task.project_id]);
        const permission=await c.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
            JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code WHERE u.id=$1 AND u.enabled AND ur.project_id=$2 AND rp.permission_code='requirement.approve'`,[userId,task.project_id]);
        if (!permission.rowCount) throw new ReviewError('需要人工审批权限');
        const current=(await c.query('SELECT * FROM gameai.tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];
        if (!['pending','blocked','failed'].includes(current.status) || current.role_code!=='Prefab') throw new ReviewError('仅未执行或失败的预制任务可增补');
        const active=await c.query(`SELECT 1 FROM gameai.executions WHERE project_id=$1 AND state IN ('assigned','running','unknown')`,[task.project_id]);
        if (active.rowCount) throw new ReviewError('项目有活动或未核实执行');
        const approved=await c.query(`SELECT 1 FROM gameai.plan_versions p JOIN gameai.requirement_versions v ON v.id=p.requirement_version_id
            JOIN gameai.approvals a ON a.version_id=v.id AND a.decision='approved' WHERE p.id=$1 AND p.state='published'
            AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions n WHERE n.requirement_id=v.requirement_id AND n.ordinal>v.ordinal)`,[task.plan_version_id]);
        if (!approved.rowCount) throw new ReviewError('当前计划或需求审批已失效');
        const downstream=await c.query(`WITH RECURSIVE d(id) AS (SELECT task_id FROM gameai.task_dependencies WHERE depends_on_id=$1 UNION SELECT e.task_id FROM gameai.task_dependencies e JOIN d ON e.depends_on_id=d.id)
            SELECT 1 FROM d JOIN gameai.tasks t ON t.id=d.id WHERE t.status IN ('running','review','completed')`,[taskId]);
        if (downstream.rowCount) throw new ReviewError('已执行下游需要返修流程');
        const {readTaskInput}=await import('./ui-task-plans.js');
        const input=await readTaskInput(c,taskId);
        const amended=applyAmendment(input.content,amendment);
        const revision=current.content_revision+1;
        await c.query(`INSERT INTO gameai.task_edits(project_id,task_id,revision,field,before_value,after_value,edited_by,reason)
            VALUES($1,$2,$3,'production-amendment',$4,$5,$6,$7)`,[task.project_id,taskId,revision,JSON.stringify({sha256:input.sha256}),JSON.stringify(amendment),userId,amendment.reason]);
        await c.query(`UPDATE gameai.tasks SET content_revision=$2,dispatch_revision=dispatch_revision+1,dispatch_allowed=false,dispatch_selected_by=NULL,dispatch_selected_at=NULL WHERE id=$1`,[taskId,revision]);
        await c.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'原任务契约增补已授权',$3)`,[task.project_id,'human:'+userId,{task:task.task_key,task_id:taskId,revision,base_hash:input.sha256,input_hash:digest(amended),authorizationReference:amendment.authorizationReference}]);
        await c.query('COMMIT');
        return {task:task.task_key,revision,sha256:digest(amended)};
    }
    catch(error) {await c.query('ROLLBACK');throw error;}
    finally {c.release();}
}
