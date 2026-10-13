import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {projectRoot} from '../paths.js';
import {verifyTaskFiles} from './task-files.js';

// Assembly updates the live Unity asset. Preserve the accepted whitebox bytes
// outside Assets first, so history stays verifiable without duplicating GUIDs.
export async function snapshotPrefabInputs(c,task)
{
    if (task.role_code !== 'Prefab' || task.delivery_phase !== 'assembly') return;
    const rows=(await c.query(`SELECT t.task_key,e.id,e.result FROM gameai.task_dependencies d
        JOIN gameai.tasks t ON t.id=d.depends_on_id
        JOIN LATERAL (SELECT id,result FROM gameai.executions WHERE task_id=t.id AND state='succeeded' ORDER BY started_at DESC LIMIT 1) e ON true
        WHERE d.task_id=$1 AND t.role_code='Prefab' AND t.status='completed'`,[task.id])).rows;
    for (const row of rows)
    {
        if (row.result.delivery_snapshot) continue;
        const artifacts=row.result.artifacts;
        if (!await verifyTaskFiles(artifacts)) throw new Error('白模交付已改变，不能创建装配快照');
        const snapshot=[];
        for (const artifact of artifacts)
        {
            const path=`deliveries/${row.task_key}/snapshots/${row.id}/${artifact.path}`;
            const bytes=await readFile(resolve(projectRoot,artifact.path));
            if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('白模快照读取期间文件改变');
            await mkdir(dirname(resolve(projectRoot,path)),{recursive:true});
            try { await writeFile(resolve(projectRoot,path),bytes,{flag:'wx'}); }
            catch (error)
            {
                if (error.code !== 'EEXIST') throw error;
                if (createHash('sha256').update(await readFile(resolve(projectRoot,path))).digest('hex') !== artifact.sha256) throw new Error('已有白模快照校验失败');
            }
            snapshot.push({path,sha256:artifact.sha256,source_path:artifact.path});
        }
        await c.query(`UPDATE gameai.executions SET result=jsonb_set(result,'{delivery_snapshot}',$2::jsonb) WHERE id=$1`,[row.id,JSON.stringify(snapshot)]);
    }
}
