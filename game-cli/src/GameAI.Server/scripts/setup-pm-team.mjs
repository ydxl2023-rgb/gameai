import {createPool} from '../src/database/connection.js';
const pool=createPool();const c=await pool.connect();
try {
 await c.query('BEGIN');
 const p=(await c.query("SELECT id FROM gameai.projects WHERE project_key='DEMO'")).rows[0];
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))',[p.id]);
 const members=(await c.query("SELECT id FROM gameai.agents WHERE project_id=$1 AND role_code='PM' AND display_name=ANY($2)",[p.id,['Mr.UI','Mr.Art','Mr.Program']])).rows;
 for(const a of members) {
  const history=await c.query('SELECT 1 FROM gameai.agent_conversations WHERE agent_id=$1 UNION ALL SELECT 1 FROM gameai.executions WHERE agent_id=$1',[a.id]);
  if(history.rowCount) throw new Error('Member has execution history; refusing to erase history automatically');
  await c.query('DELETE FROM gameai.agent_skills WHERE agent_id=$1',[a.id]);
  await c.query('DELETE FROM gameai.agent_grants WHERE agent_id=$1',[a.id]);
  await c.query('DELETE FROM gameai.agents WHERE id=$1',[a.id]);
 }
 await c.query('COMMIT');console.log('Removed specialist PM members: '+members.length);
} catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();await pool.end();}
