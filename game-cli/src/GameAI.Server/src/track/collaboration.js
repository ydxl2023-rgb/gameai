import {createPool,databaseEnabled} from '../database/connection.js';
import {readCollaboration} from '../database/collaboration.js';
let pool;
export async function collaborationHistory(query={})
{
    if (!databaseEnabled()) return {messages:[],before:null};
    pool??=createPool();
    return readCollaboration(pool,process.env.GAMEAI_PROJECT_KEY??'DEMO',query);
}
