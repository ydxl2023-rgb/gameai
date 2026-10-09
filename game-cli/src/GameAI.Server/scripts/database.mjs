import { linkDesignHtml } from '../src/database/documents.js';
import { syncSkillCatalog } from '../src/database/agents.js';
import { createPool } from '../src/database/connection.js';
import { migrate } from '../src/database/migrate.js';
import { seed } from '../src/database/seed.js';
import { readWorkbench } from '../src/database/store.js';

const pool = createPool();
try
{
    switch (process.argv[2])
    {
        case 'sync-skills':
            await syncSkillCatalog(pool);
            console.log('技能目录与内容版本已同步。');
            break;
        case 'link-html':
            await linkDesignHtml(pool, process.env.GAMEAI_PROJECT_KEY ?? 'DEMO', process.argv[3], process.argv[4], process.argv[5]);
            console.log('原始 HTML 已关联指定需求版本。');
            break;
        case 'migrate':
            await migrate(pool);
            console.log('数据库迁移完成。');
            break;
        case 'seed':
            console.log((await seed(pool)).inserted ? '测试数据已事务性入库。' : '测试项目已存在，未覆盖任何数据。');
            break;
        case 'status':
        {
            const result = await readWorkbench(pool, process.env.GAMEAI_PROJECT_KEY ?? 'DEMO');
            console.log(JSON.stringify({ storage: 'postgres', test_data: result.is_test, tasks: result.workbench.tasks.length, agents: result.workbench.agents.length, versions: result.workbench.versions.length, audit: result.workbench.audit.length }));
            break;
        }
        default:
            throw new Error('使用 migrate、seed 或 status。');
    }
}
catch (error)
{
    console.error('数据库操作失败，错误代码：' + (error.code ?? 'CONFIG_OR_MIGRATION'));
    process.exitCode = 1;
}
finally
{
    await pool.end();
}
