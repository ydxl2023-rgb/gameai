import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tempRoot} from '../paths.js';
import {publishPmPlan} from '../database/pm-plans.js';

export async function recoverPmPublications(pool,publish=publishPmPlan,read=readFile)
{
    const jobs=(await pool.query(`SELECT j.*,p.project_key FROM gameai.pm_jobs j
        JOIN gameai.projects p ON p.id=j.project_id JOIN gameai.agent_runs r ON r.execution_id=j.execution_id
        WHERE j.recover_publication AND j.state IN ('running','failed') AND r.state='completed'
        AND j.publication_attempts<5 AND j.publication_retry_at<=now() ORDER BY j.publication_retry_at LIMIT 20`)).rows;
    for (const job of jobs)
    {
        try
        {
            // Only a fully validated plan is spooled to result.json by the publisher.
            let result=job.publication_result;
            if (!result)
            {
                try { result=JSON.parse(await read(join(tempRoot,'pm-jobs',job.execution_id,'result.json'),'utf8')); }
                catch (error)
                {
                    if (error.code==='ENOENT') continue;
                    throw error;
                }
                await pool.query('UPDATE gameai.pm_jobs SET publication_result=$2 WHERE id=$1 AND publication_result IS NULL',[job.id,result]);
            }
            await publish(pool,job.project_key,job,result,{recoverPublication:true});
        }
        catch (error)
        {
            await pool.query(`UPDATE gameai.pm_jobs SET publication_attempts=publication_attempts+1,
                publication_retry_at=now()+interval '30 seconds',error=$2 WHERE id=$1`,[job.id,'已保存 PM 结果，发布恢复失败：'+error.message]);
            console.error('PM 发布恢复等待处理',job.execution_id,error.message);
        }
    }
}
