import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ReviewError } from './requirements.js';

const kinds = ['preconditions','steps','success','failure','recovery','tests'];
const labels = {
    scope: ['任务范围','范围'],
    start: ['启动条件','条件'],
    deliverable: ['交付内容','交付物'],
    completion: ['完成条件','完成门禁']
};
const schema = z.object({
    task_id:z.uuid(), revision:z.number().int().nonnegative(),
    field:z.enum(['title','scope','start','deliverable','completion','dependencies',...kinds]),
    value:z.union([z.string().trim().min(1).max(6000),z.array(z.uuid()).max(100)]),
    reason:z.string().trim().max(500).optional()
}).strict();

export async function canEditTasks(pool, projectKey, userId)
{
    const result = await pool.query(`SELECT 1 FROM gameai.users u
        JOIN gameai.user_roles ur ON ur.user_id=u.id
        JOIN gameai.projects p ON p.id=ur.project_id
        JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code
        WHERE u.id=$1 AND u.enabled AND p.project_key=$2 AND rp.permission_code='task.edit'`,[userId,projectKey]);
    return !!result.rowCount;
}

function descriptionField(description, field, value)
{
    const aliases = labels[field];
    const lines = (description ?? '').split(/\r?\n/);
    const index = lines.findIndex(line => aliases.some(label => line.trim().startsWith(label+'：') || line.trim().startsWith(label+':')));
    const before = index < 0 ? '' : lines[index].replace(/^[^：:]+[:：]\s*/,'');
    // One section per line keeps legacy PM text readable and independently editable.
    const updated = aliases[0]+'：'+value.replace(/\r?\n/g,' ');
    if (index < 0)
    {
        lines.push(updated);
    }
    else
    {
        lines[index] = updated;
    }
    return { before, description:lines.join('\n') };
}

export async function editTaskField(pool, projectKey, userId, raw)
{
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
    {
        throw new ReviewError('任务修改参数无效。');
    }
    const input = parsed.data;
    if ((input.field==='dependencies') !== Array.isArray(input.value))
    {
        throw new ReviewError('字段内容类型无效。');
    }
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        const project = (await client.query('SELECT id FROM gameai.projects WHERE project_key=$1',[projectKey])).rows[0];
        if (!project || !await canEditTasks(client,projectKey,userId))
        {
            throw new ReviewError('没有人工任务编辑权限。');
        }
        // Serialize with graph edits and dispatch before checking active executions.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[project.id]);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[project.id]);
        const task = (await client.query('SELECT * FROM gameai.tasks WHERE id=$1 AND project_id=$2 FOR UPDATE',[input.task_id,project.id])).rows[0];
        if (!task?.parent_id || !['pending','blocked','failed'].includes(task.status))
        {
            throw new ReviewError('仅未开始或失败的专业子任务可编辑；执行、验收和已完成任务不可修改。');
        }
        if (task.content_revision!==input.revision)
        {
            throw new ReviewError('任务已被修改，请刷新后重新编辑。');
        }
        const active = await client.query(`SELECT 1 FROM gameai.executions WHERE task_id=$1 AND state IN ('assigned','running','unknown')`,[task.id]);
        const downstream = await client.query(`WITH RECURSIVE dependents(id) AS (
            SELECT task_id FROM gameai.task_dependencies WHERE depends_on_id=$1
            UNION SELECT d.task_id FROM gameai.task_dependencies d JOIN dependents p ON d.depends_on_id=p.id
        ) SELECT 1 FROM gameai.tasks t JOIN dependents d ON d.id=t.id WHERE t.status IN ('running','review','completed')
            OR EXISTS(SELECT 1 FROM gameai.executions e WHERE e.task_id=t.id AND e.state IN ('assigned','running','unknown'))`,[task.id]);
        if (active.rowCount || downstream.rowCount)
        {
            throw new ReviewError('本任务或依赖它的任务已经执行，需通过返修流程修改。');
        }
        let before;
        let after = input.value;
        let description = task.description;
        let criteria = task.delivery_criteria;
        let title = task.title;
        if (input.field==='dependencies')
        {
            after = [...new Set(input.value)].sort();
            if (after.includes(task.id))
            {
                throw new ReviewError('任务不能依赖自己。');
            }
            before = (await client.query('SELECT depends_on_id FROM gameai.task_dependencies WHERE task_id=$1 ORDER BY depends_on_id',[task.id])).rows.map(row=>row.depends_on_id);
            const targets = await client.query('SELECT id FROM gameai.tasks WHERE id=ANY($1::uuid[]) AND project_id=$2 AND plan_version_id=$3 AND parent_id=$4',[after,project.id,task.plan_version_id,task.parent_id]);
            if (targets.rowCount!==after.length)
            {
                throw new ReviewError('依赖必须是同一主任务下的专业子任务。');
            }
        }
        else if (input.field==='title')
        {
            if (input.value.length>200)
            {
                throw new ReviewError('交付名称最多 200 字。');
            }
            before = title;
            title = input.value;
        }
        else if (kinds.includes(input.field))
        {
            before = criteria.find(c=>c.kind===input.field)?.text ?? '';
            criteria = [...criteria.filter(c=>c.kind!==input.field),{kind:input.field,text:input.value}];
        }
        else
        {
            const result = descriptionField(description,input.field,input.value);
            before = result.before;
            description = result.description;
        }
        if (isDeepStrictEqual(before,after))
        {
            await client.query('COMMIT');
            return {revision:task.content_revision,changed:false};
        }
        if (input.field==='dependencies')
        {
            await client.query('DELETE FROM gameai.task_dependencies WHERE task_id=$1',[task.id]);
            for (const id of after)
            {
                // The existing graph trigger rejects cyclic dependencies atomically.
                await client.query('INSERT INTO gameai.task_dependencies(project_id,task_id,depends_on_id) VALUES($1,$2,$3)',[project.id,task.id,id]);
            }
        }
        await client.query(`UPDATE gameai.tasks SET title=$2,description=$3,delivery_criteria=$4,
            content_revision=content_revision+1,dispatch_allowed=false,dispatch_revision=dispatch_revision+1,
            dispatch_selected_by=NULL,dispatch_selected_at=NULL,
            status=CASE WHEN status='failed' THEN status WHEN EXISTS(SELECT 1 FROM gameai.task_dependencies d JOIN gameai.tasks t ON t.id=d.depends_on_id WHERE d.task_id=$1 AND t.status<>'completed') THEN 'blocked' ELSE 'pending' END
            WHERE id=$1`,[task.id,title,description,JSON.stringify(criteria)]);
        await client.query(`INSERT INTO gameai.task_edits(project_id,task_id,revision,field,before_value,after_value,edited_by,reason)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[project.id,task.id,task.content_revision+1,input.field,JSON.stringify(before),JSON.stringify(after),userId,input.reason??'']);
        await client.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'人工修改任务，撤销派发许可',$3)`,[project.id,'human:'+userId,{task:task.task_key,field:input.field,revision:task.content_revision+1}]);
        await client.query('COMMIT');
        return {revision:task.content_revision+1,changed:true};
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        if (error.code==='P0001' || error.code==='23514')
        {
            throw new ReviewError('依赖不能形成循环，请重新选择。');
        }
        throw error;
    }
    finally
    {
        client.release();
    }
}
