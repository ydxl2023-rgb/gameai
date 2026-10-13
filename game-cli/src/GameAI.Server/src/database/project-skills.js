import {readFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {projectRoot} from '../paths.js';

export async function loadProjectSkills(projectKey,root=resolve(projectRoot,'app/skills'))
{
    let manifest;
    try {manifest=JSON.parse(await readFile(resolve(root,'project-skills.json'),'utf8'));}
    catch(error) {if(error.code==='ENOENT') return [];throw error;}
    if(manifest.project_key!==projectKey) throw new Error('项目技能配置与当前项目不匹配');
    if(!Array.isArray(manifest.skills)) throw new Error('项目技能清单无效');
    const snapshots=[];
    for(const entry of manifest.skills)
    {
        if(typeof entry.path!=='string' || typeof entry.version!=='string') throw new Error('项目技能缺少路径或版本');
        const file=await realpath(resolve(root,entry.path));
        const local=relative(await realpath(root),file);
        if(local.startsWith('..') || isAbsolute(local)) throw new Error('项目技能路径越界');
        const content=await readFile(file,'utf8');
        if(!content.includes('版本：'+entry.version)) throw new Error('项目技能版本与清单不一致');
        snapshots.push({path:entry.path,version:entry.version,sha256:createHash('sha256').update(content).digest('hex'),content});
    }
    return snapshots;
}
