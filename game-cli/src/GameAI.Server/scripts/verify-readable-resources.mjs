import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {projectRoot} from '../src/paths.js';
import {loadAssetAliases,resolveAssetAlias} from '../src/database/asset-path-aliases.js';

const aliases=await loadAssetAliases(projectRoot);
for(const alias of aliases) await resolveAssetAlias(projectRoot,'app/client/'+alias.from,aliases);
const git=(...args)=>execFileSync('git',args,{cwd:projectRoot,maxBuffer:48*1024*1024});
const files=git('ls-files','-z','--','app/client/Assets/UI/Widgets/UILogin').toString('utf8').split('\0').filter(Boolean);
const changed=[];
for(const file of files)
{
    const digest=value=>createHash('sha256').update(value).digest('hex');
    if(digest(await readFile(join(projectRoot,file)))!==digest(git('show','HEAD:'+file))) changed.push(file);
}
const clientChanges=git('status','--short','--untracked-files=no','--','app/client').toString('utf8').trim().split(/\r?\n/).filter(Boolean);
const report={schemaVersion:'ui-resource-reproducibility/1',verifiedAt:new Date().toISOString(),aliasesVerified:aliases.length,
    trackedWidgetFiles:files.length,filesDifferentFromCommittedBytes:changed,existingClientChanges:clientChanges,
    scope:'Verifies committed widget bytes and alias identity; not a clean Unity checkout/build proof. Existing scene, package and settings changes are retained.'};
if(process.argv[2])
{
    const output=resolve(process.argv[2]);
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify(report,null,2));
}
console.log(JSON.stringify({aliasesVerified:aliases.length,trackedWidgetFiles:files.length,changedWidgetFiles:changed.length,existingClientChanges:clientChanges.length}));
if(changed.length) process.exitCode=1;
