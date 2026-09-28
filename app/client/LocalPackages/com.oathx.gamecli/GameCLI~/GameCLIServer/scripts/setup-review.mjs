import pg from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, scryptSync } from 'node:crypto';
import { parseEnv } from 'node:util';

// Explicit maintenance command: connect using a database administrator supplied through PG variables.
const pool = new pg.Pool();
async function config(name, defaults)
{
    const file = new URL('../'+name,import.meta.url);
    try
    {
        return parseEnv(await readFile(file,'utf8'));
    }
    catch (error)
    {
        if (error.code !== 'ENOENT')
        {
            throw error;
        }
        await writeFile(file,Object.entries(defaults).map(([key,value]) => key+'='+value).join('\n')+'\n',{flag:'wx'});
        return defaults;
    }
}
try
{
    const writer = await config('.env.workflow',{PGUSER:'gameai_workflow',PGPASSWORD:randomBytes(24).toString('hex'),SUBMISSION_TOKEN:randomBytes(32).toString('hex')});
    const human = await config('.env.review-account',{USERNAME:'reviewer',PASSWORD:randomBytes(12).toString('hex')});
    const connection = await pool.connect();
    try
    {
        await connection.query('BEGIN');
        const exists = await connection.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[writer.PGUSER]);
        if (!exists.rowCount) await connection.query('CREATE ROLE '+pg.escapeIdentifier(writer.PGUSER)+' LOGIN');
        await connection.query('ALTER ROLE '+pg.escapeIdentifier(writer.PGUSER)+' PASSWORD '+pg.escapeLiteral(writer.PGPASSWORD));
        await connection.query('GRANT USAGE ON SCHEMA gameai TO '+pg.escapeIdentifier(writer.PGUSER));
        await connection.query('GRANT SELECT ON ALL TABLES IN SCHEMA gameai TO '+pg.escapeIdentifier(writer.PGUSER));
        await connection.query('GRANT INSERT ON gameai.requirements,gameai.requirement_versions,gameai.artifacts,gameai.artifact_links,gameai.document_contents,gameai.idempotency_records,gameai.approvals,gameai.audit_events TO '+pg.escapeIdentifier(writer.PGUSER));
        await connection.query('GRANT UPDATE(title) ON gameai.requirements TO '+pg.escapeIdentifier(writer.PGUSER));
        await connection.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA gameai TO '+pg.escapeIdentifier(writer.PGUSER));
        await connection.query('GRANT SELECT ON gameai.document_contents TO gameai_track');
        const user = (await connection.query("INSERT INTO gameai.users(subject,display_name,enabled) VALUES($1,'本机人工审批人',true) ON CONFLICT(subject) DO UPDATE SET enabled=true RETURNING id",[human.USERNAME])).rows[0];
        const salt=randomBytes(16).toString('hex');
        await connection.query('INSERT INTO gameai.human_credentials(user_id,password_hash) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash',[user.id,salt+':'+scryptSync(human.PASSWORD,salt,32).toString('hex')]);
        await connection.query("INSERT INTO gameai.user_roles(project_id,user_id,role_code) SELECT id,$1,'Design' FROM gameai.projects WHERE project_key=$2 ON CONFLICT DO NOTHING",[user.id,process.env.GAMEAI_PROJECT_KEY ?? 'DEMO']);
        await connection.query('COMMIT');
    }
    catch(error) { await connection.query('ROLLBACK');throw error; }
    finally
    {
        connection.release();
    }
    console.log('已配置独立提交服务账号与人工审批账户；登录信息保存在被忽略的 .env.review-account。');
}
finally
{
    await pool.end();
}
