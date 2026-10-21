import {generateContract,prepareDesignDocument,sealDesignReview,validateDesignDocument} from '../src/database/design-contract.js';
import {readFile} from 'node:fs/promises';
import {validateContract,compilePlan,digest} from '../src/database/ui-production-contract.js';
import {registerContract,submitTaskPlan} from '../src/database/ui-task-plans.js';
import {loadAssetAliases,resolveAssetAlias} from '../src/database/asset-path-aliases.js';
import {readableResourceDocument,encodedResourceNames} from '../src/database/readable-resource-document.js';
import {projectRoot} from '../src/paths.js';
import {prepareDesignReviewPrompt} from '../src/database/ui-document-prompt.js';

let pool;
try
{
    const [group,action,...args]=process.argv.slice(2);
    if (!['contract','plan'].includes(group) || !(group==='contract'?['validate','register','generate','prepare','review','review-input','check-document']:['validate','submit']).includes(action)) throw new Error('Invalid task command');
    const options={};
    for (let i=0;i<args.length;i+=2)
    {
        if (!['--input','--contract','--user'].includes(args[i]) || !args[i+1] || options[args[i]]) throw new Error('Invalid or duplicate option');
        options[args[i]]=args[i+1];
    }
    if (options['--contract'] && (group!=='plan' || action!=='validate')) throw new Error('Offline contract only permitted for plan validate');
    async function json(path)
    {
        const bytes=await readFile(path);
        if (bytes.length>8*1024*1024) throw new Error('Input exceeds 8 MiB');
        return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    }
    const input=await json(options['--input']);
    let result;
    if (group==='contract' && action==='generate') result={contract:generateContract(input)};
    else if(group==='contract' && action==='prepare')
    {
        const aliases=await loadAssetAliases(projectRoot);
        for (const alias of aliases) await resolveAssetAlias(projectRoot,'app/client/'+alias.from,aliases);
        input.html=readableResourceDocument(input.html,aliases,{notice:false}).html;
        const encoded=encodedResourceNames(input.html);
        if (encoded.length) throw new Error('需求正文仍以哈希命名资源，请按用途或真实字体家族/字重编写；来源追溯放入 data-resource-provenance 附录：'+encoded.slice(0,8).join('、'));
        result=prepareDesignDocument(input);
    }
    else if(group==='contract' && action==='review-input') result={prompt:prepareDesignReviewPrompt(input.requirements,input.document)};
    else if(group==='contract' && action==='review') result=sealDesignReview(input);
    else if(group==='contract' && action==='check-document') result={valid:true,...validateDesignDocument(input.html)};
    else if (group==='contract' && action==='validate') result={valid:true,scope:'offline',sha256:digest(validateContract(input))};
    else if (action==='validate' && options['--contract']) result={valid:true,scope:'offline',...compilePlan(input,await json(options['--contract']))};
    else
    {
        if (!/^[0-9a-f-]{36}$/i.test(options['--user'] ?? '')) throw new Error('Human actor required');
        const {createPool}=await import('../src/database/connection.js');
        pool=createPool();
        result=group==='contract'?await registerContract(pool,input,options['--user']):await submitTaskPlan(pool,input,options['--user'],action==='submit');
    }
    console.log(JSON.stringify({success:true,...result}));
}
catch(error)
{
    console.error(JSON.stringify({success:false,code:error.code ?? 'TASK_CONTRACT_REJECTED',message:error.message}));
    process.exitCode=4;
}
finally { await pool?.end(); }
