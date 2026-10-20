import {readFile} from 'node:fs/promises';
import {createPool} from '../src/database/connection.js';
import {authorizeTaskAmendment} from '../src/database/task-amendments.js';
import {readTaskInput} from '../src/database/ui-task-plans.js';

// Explicit server maintenance command; does not dispatch or mark delivery complete.
const [taskKey,subject,file]=process.argv.slice(2);
const pool=createPool();
try
{
    if (!taskKey || !subject || !file) throw new Error('Usage: amend-task <task-key> <human-subject> <amendment.json>');
    const tasks=(await pool.query('SELECT id FROM gameai.tasks WHERE task_key=$1',[taskKey])).rows;
    const users=(await pool.query('SELECT id FROM gameai.users WHERE subject=$1 AND enabled',[subject])).rows;
    if (tasks.length!==1 || users.length!==1) throw new Error('Unique task and enabled human required');
    const input=await readTaskInput(pool,tasks[0].id);
    const amendment=JSON.parse(await readFile(file,'utf8'));
    if (amendment.baseHash!==input.sha256) throw new Error('Review current base hash before authorization');
    console.log(JSON.stringify(await authorizeTaskAmendment(pool,tasks[0].id,users[0].id,amendment)));
}
finally {await pool.end();}
