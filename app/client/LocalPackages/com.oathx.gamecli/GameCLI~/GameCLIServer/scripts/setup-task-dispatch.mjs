import {createPool} from '../src/database/connection.js';
const pool=createPool();
const client=await pool.connect();
try
{
    await client.query('BEGIN');
    const result=await client.query(`INSERT INTO gameai.agent_grants(project_id,agent_id,permission_code)
        SELECT f.project_id,f.agent_id,'task.write_assigned' FROM gameai.fixed_agents f JOIN gameai.projects p ON p.id=f.project_id
        WHERE p.project_key=$1 AND f.role_code IN ('Art','Development','QA') ON CONFLICT DO NOTHING RETURNING agent_id`,[process.env.GAMEAI_PROJECT_KEY ?? 'DEMO']);
    if (result.rowCount) await client.query(`INSERT INTO gameai.audit_events(project_id,actor,event,payload)
        SELECT id,'setup','配置固定专业 Agent 的人工派发权限',$2 FROM gameai.projects WHERE project_key=$1`,[process.env.GAMEAI_PROJECT_KEY ?? 'DEMO',{agents:result.rows.map(r=>r.agent_id)}]);
    await client.query('COMMIT');
    console.log('固定专业 Agent 的授权任务权限已配置。');
}
catch(error) {await client.query('ROLLBACK');throw error;}
finally {client.release();await pool.end();}
