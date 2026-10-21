import {projectRoot,platformRoot} from '../paths.js';
import { createHash } from 'node:crypto';
import { readFile,realpath,stat } from 'node:fs/promises';
import { resolve,relative,isAbsolute,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {loadAssetAliases,resolveAssetAlias} from './asset-path-aliases.js';
const root = projectRoot;
export async function inspectTaskFiles(paths)
{
    if (!Array.isArray(paths) || paths.length<1 || paths.length>4096) throw new Error('实际交付文件数量必须为 1 至 4096；Agent 声明仍受结果 schema 上限约束。');
    const artifacts=[];
    const aliases=await loadAssetAliases(root);
    for (const path of paths)
    {
        if (typeof path!=='string' || isAbsolute(path) || path.split(/[\\/]/).some((p,index,parts)=>(p.startsWith('.') && !(p==='.gitignore' && index===parts.length-1)) || ['Library','Temp','Logs','node_modules','bin','obj'].includes(p))) throw new Error('交付路径必须是工作目录中的项目文件。');
        const resolved=await resolveAssetAlias(root,path,aliases);
        const actual=await realpath(resolve(root,resolved));
        const local=relative(await realpath(root),actual);
        if (local==='..' || local.startsWith('..'+sep) || isAbsolute(local)) throw new Error('交付文件越出项目范围。');
        const info=await stat(actual);
        if (!info.isFile() || info.size>32*1024*1024) throw new Error('交付文件不存在或超过 32MB。');
        artifacts.push({path:local.replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(actual)).digest('hex')});
    }
    return artifacts;
}
export async function verifyTaskFiles(artifacts)
{
    try
    {
        const current=await inspectTaskFiles(artifacts?.map(a=>a.path));
        return current.every((file,index)=>file.sha256===artifacts[index].sha256);
    }
    catch { return false; }
}
