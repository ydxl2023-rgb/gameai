import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createPool} from '../src/database/connection.js';

test('workflow can store and reuse task HTML without permission to rewrite artifact identity',async()=>
{
    const pool=createPool();
    const c=await pool.connect();
    try
    {
        await c.query('BEGIN');
        const key='ARTIFACT-PERM-'+randomUUID();
        // Run with .env.workflow, not an owner/superuser that would hide missing grants.
        const project=(await c.query('SELECT id FROM gameai.projects WHERE project_key=$1 AND is_test',[process.env.GAMEAI_PROJECT_KEY ?? 'DEMO'])).rows[0]?.id;
        assert.ok(project,'A seeded test project is required');
        const bytes=Buffer.from('<!doctype html><p>任务说明</p>');
        const hash=createHash('sha256').update(bytes).digest('hex');
        const sql=`INSERT INTO gameai.artifacts(project_id,storage_key,sha256,byte_size,media_type,verified_at)
            VALUES($1,$2,$3,$4,'text/html',now()) ON CONFLICT(project_id,storage_key)
            DO UPDATE SET verified_at=gameai.artifacts.verified_at
            WHERE gameai.artifacts.sha256=EXCLUDED.sha256 RETURNING id,verified_at`;
        const args=[project,'permission-test/'+key+'.html',hash,bytes.length];
        const first=(await c.query(sql,args)).rows[0];
        await c.query('INSERT INTO gameai.document_contents(artifact_id,bytes) VALUES($1,$2) ON CONFLICT(artifact_id) DO NOTHING',[first.id,bytes]);
        const repeated=(await c.query(sql,args)).rows[0];
        assert.deepEqual(repeated,first);
        assert.equal((await c.query(sql,[project,args[1],'0'.repeat(64),bytes.length])).rowCount,0);
        const rights=(await c.query(`SELECT current_user AS role,
            has_column_privilege(current_user,'gameai.artifacts','verified_at','UPDATE') AS verification,
            has_column_privilege(current_user,'gameai.artifacts','sha256','UPDATE') AS hash,
            has_column_privilege(current_user,'gameai.artifacts','storage_key','UPDATE') AS path`)).rows[0];
        assert.deepEqual(rights,{role:'gameai_workflow',verification:true,hash:false,path:false});
        for (const column of ['logical_id','window_id','delivery_phase'])
        {
            const allowed=(await c.query("SELECT has_column_privilege(current_user,'gameai.tasks',$1,'UPDATE') AS allowed",[column])).rows[0].allowed;
            assert.equal(allowed,true,'Missing delivery identity permission: '+column);
        }
    }
    finally
    {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
    }
});
