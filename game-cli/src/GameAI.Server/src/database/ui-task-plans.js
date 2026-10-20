import {validateDesignDocument} from './design-contract.js';
import {applyAmendment} from './task-amendments.js';
import {createHash} from 'node:crypto';
import {validateContract,readApprovedContract,compilePlan,planSchema,digest} from './ui-production-contract.js';

async function transaction(pool,action,existingClient=null)
{
    if (existingClient) return action(existingClient);
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const result=await action(c);
        await c.query('COMMIT');
        return result;
    }
    catch(error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
}
async function authority(c,projectId,versionId,userId)
{
    // Same project lock as approval, clear and dispatch prevents check/write races.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[projectId]);
    const permission=await c.query(`SELECT 1 FROM gameai.users u JOIN gameai.user_roles ur ON ur.user_id=u.id
        JOIN gameai.role_permissions rp ON rp.role_code=ur.role_code WHERE u.id=$1 AND u.enabled
        AND ur.project_id=$2 AND rp.permission_code='requirement.approve'`,[userId,projectId]);
    if (!permission.rowCount) throw new Error('Human approval permission required');
    const version=(await c.query(`SELECT v.* FROM gameai.requirement_versions v JOIN gameai.approvals a ON a.version_id=v.id AND a.decision='approved'
        WHERE v.project_id=$1 AND v.id=$2 AND NOT EXISTS(SELECT 1 FROM gameai.requirement_versions n WHERE n.requirement_id=v.requirement_id AND n.ordinal>v.ordinal)`,[projectId,versionId])).rows[0];
    if (!version) throw new Error('Latest approved requirement version required');
    const docs=(await c.query(`SELECT a.sha256,d.bytes FROM gameai.artifact_links l JOIN gameai.artifacts a ON a.id=l.artifact_id
        JOIN gameai.document_contents d ON d.artifact_id=a.id WHERE l.requirement_version_id=$1 AND a.media_type='text/html' AND a.verified_at IS NOT NULL`,[versionId])).rows;
    if (docs.length!==1 || createHash('sha256').update(docs[0].bytes).digest('hex')!==docs[0].sha256) throw new Error('Approved document unavailable or hash mismatch');
    return docs[0];
}
export async function registerContract(pool,raw,userId,existingClient=null)
{
    const contract=validateContract(raw);
    return transaction(pool,async c=>
    {
        const doc=await authority(c,contract.projectId,contract.requirementVersionId,userId);
        if (digest(readApprovedContract(doc.bytes.toString('utf8')))!==digest(contract)) throw new Error('Contract is not the exact contract in approved HTML');
        validateDesignDocument(doc.bytes.toString('utf8'),{projectId:contract.projectId,versionId:contract.requirementVersionId});
        const params=[contract.projectId,contract.id,contract.version];
        const old=(await c.query('SELECT sha256 FROM gameai.ui_production_contracts WHERE project_id=$1 AND contract_id=$2 AND version=$3',params)).rows[0];
        const sha=digest(contract);
        if (old && old.sha256!==sha) throw new Error('Immutable contract version conflict');
        if (!old)
        {
            await c.query('INSERT INTO gameai.ui_production_contracts(project_id,contract_id,version,requirement_version_id,sha256,document_sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7)',[...params,contract.requirementVersionId,sha,doc.sha256,contract]);
            await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'生产契约已登记',$3)",[contract.projectId,'human:'+userId,{contract_id:contract.id,version:contract.version,sha256:sha}]);
        }
        return {id:contract.id,version:contract.version,sha256:sha,created:!old};
    },existingClient);
}
export async function submitTaskPlan(pool,raw,userId,commit=false,existingClient=null)
{
    const plan=planSchema.parse(raw);
    return transaction(pool,async c=>
    {
        const doc=await authority(c,plan.projectId,plan.requirementVersionId,userId);
        const contract=(await c.query('SELECT * FROM gameai.ui_production_contracts WHERE project_id=$1 AND contract_id=$2 AND version=$3',[plan.projectId,plan.contract.id,plan.contract.version])).rows[0];
        if (!contract || contract.document_sha256!==doc.sha256 || digest(contract.content)!==contract.sha256) throw new Error('Registered contract missing or invalid');
        const compiled=compilePlan(plan,contract.content);
        const parent=(await c.query(`SELECT t.*,p.requirement_version_id,p.state plan_state FROM gameai.tasks t JOIN gameai.plan_versions p ON p.id=t.plan_version_id WHERE t.id=$1 AND t.project_id=$2`,[plan.parentTaskId,plan.projectId])).rows[0];
        if (!parent || parent.parent_id || parent.role_code!=='PM' || parent.plan_state!=='published' || parent.requirement_version_id!==plan.requirementVersionId) throw new Error('Parent must be a root task of this approved published plan');
        const requestHash=digest(plan);
        const old=(await c.query('SELECT * FROM gameai.ui_task_plan_requests WHERE project_id=$1 AND request_id=$2',[plan.projectId,plan.requestId])).rows[0];
        if (old)
        {
            if (old.request_hash!==requestHash) throw new Error('Idempotency key reused with different content');
            return {...old.result,replayed:true};
        }
        const conflict=await c.query('SELECT 1 FROM gameai.tasks WHERE parent_id=$1 AND window_id=ANY($2::text[])',[parent.id,plan.windows.map(w=>w.windowId)]);
        if (conflict.rowCount) throw new Error('Window tasks already exist; do not duplicate or overwrite');
        if (!commit) return {valid:true,committed:false,tasks:compiled.tasks};
        const ids=new Map();
        const tasks=[];
        for (const t of compiled.tasks)
        {
            const criteria=t.acceptance.checks.map(text=>({kind:'contract',text}));
            const row=(await c.query(`INSERT INTO gameai.tasks(project_id,plan_version_id,parent_id,title,role_code,description,delivery_criteria,status,logical_id,window_id,delivery_phase)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,task_key`,[plan.projectId,parent.plan_version_id,parent.id,t.title,t.role,'Execute frozen production contract '+plan.contract.id+' v'+plan.contract.version,JSON.stringify(criteria),t.dependsOn.length?'blocked':'pending',t.logicalId,t.windowId,t.phase])).rows[0];
            // Public task IDs and delivery paths are assigned by code, never by the model.
            const input={...t.input,taskId:row.id,taskKey:row.task_key,deliveryDirectory:'deliveries/'+row.task_key,dependencies:t.dependsOn.map(key=>ids.get(key))};
            await c.query('INSERT INTO gameai.ui_task_contracts(task_id,project_id,contract_id,contract_version,contract_hash,input_hash,input) VALUES($1,$2,$3,$4,$5,$6,$7)',[row.id,plan.projectId,plan.contract.id,plan.contract.version,plan.contract.sha256,digest(input),input]);
            for (const key of t.dependsOn) await c.query('INSERT INTO gameai.task_dependencies(project_id,task_id,depends_on_id) VALUES($1,$2,$3)',[plan.projectId,row.id,ids.get(key)]);
            ids.set(t.logicalId,row.id);
            tasks.push({...row,type:t.type,inputHash:digest(input)});
        }
        const result={valid:true,committed:true,tasks};
        await c.query('INSERT INTO gameai.ui_task_plan_requests(project_id,request_id,request_hash,parent_task_id,result) VALUES($1,$2,$3,$4,$5)',[plan.projectId,plan.requestId,requestHash,parent.id,result]);
        await c.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,$2,'CLI 已事务性创建契约任务',$3)",[plan.projectId,'human:'+userId,{request_id:plan.requestId,contract:plan.contract,tasks}]);
        return result;
    },existingClient);
}
export async function readTaskInput(c,taskId)
{
    const row=(await c.query('SELECT input,input_hash FROM gameai.ui_task_contracts WHERE task_id=$1',[taskId])).rows[0];
    if (!row) return null;
    if (digest(row.input)!==row.input_hash) throw new Error('Frozen task input hash mismatch');
    let content=row.input;
    const amendments=(await c.query("SELECT after_value FROM gameai.task_edits WHERE task_id=$1 AND field='production-amendment' ORDER BY revision",[taskId])).rows;
    for (const amendment of amendments) content=applyAmendment(content,amendment.after_value);
    return {sha256:digest(content),content};
}
