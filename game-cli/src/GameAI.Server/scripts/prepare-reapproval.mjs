import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createPool} from '../src/database/connection.js';
import {readUiTemplateContext,embedUiTemplateContext} from '../src/database/ui-template-context.js';
import {runPmCli} from '../src/track/pm-dispatch.js';
import {submitRequirement} from '../src/database/requirements.js';
import {clearProjectTasks} from '../src/database/task-clear.js';
import {projectRoot,platformRoot,tempRoot} from '../src/paths.js';
import {prepareUiDocumentPrompt} from '../src/database/ui-document-prompt.js';
import {readApprovedContract} from '../src/database/ui-production-contract.js';

// Prepare a reviewed replacement version. Never records the final human approval.
const pool=createPool();
try
{
    const [projectKey,key,subject,targetVersion]=process.argv.slice(2);
    const source=(await pool.query(`SELECT v.*,r.title,d.bytes FROM gameai.projects p JOIN gameai.requirements r ON r.project_id=p.id
        JOIN gameai.requirement_versions v ON v.requirement_id=r.id JOIN gameai.artifact_links l ON l.requirement_version_id=v.id
        JOIN gameai.document_contents d ON d.artifact_id=l.artifact_id JOIN gameai.artifacts a ON a.id=l.artifact_id AND a.media_type='text/html'
        WHERE p.project_key=$1 AND r.requirement_key=$2 ORDER BY v.ordinal DESC LIMIT 1`,[projectKey,key])).rows[0];
    const user=(await pool.query('SELECT id FROM gameai.users WHERE subject=$1 AND enabled',[subject])).rows[0];
    if (!source || !user || !targetVersion) throw new Error('Source, human and target version required');
    const directory=join(tempRoot,'reapproval',targetVersion+'-'+Date.now());
    await mkdir(directory,{recursive:true});
    const html=source.bytes.toString('utf8');
    const payload=structuredClone(readUiTemplateContext(html).payload);
    const oldTarget=JSON.stringify(payload.targetSnapshot);
    const nodes=payload.targetSnapshot.prefab.nodes;
    // Historical attachment copies predate already-approved text/name fixes.
    // Recover these inherited values from the signed document's production contract.
    const approvedWindow=readApprovedContract(html).windows.find(w=>w.rootNodeId===payload.targetSnapshot.prefab.rootNodeId);
    if (!approvedWindow) throw new Error('Approved window missing');
    const approvedRoot=approvedWindow.nodes.find(n=>n.id===approvedWindow.rootNodeId);
    const windowSpec=structuredClone(approvedWindow);
    windowSpec.nodes.find(n=>n.id==='6305621391415780078').rect.anchoredPosition=[-80,60];
    const windowTips=windowSpec.nodes.find(n=>n.id==='7339243912597274077');
    windowTips.components.find(c=>c.id==='1893093729200777271').properties.m_RaycastTarget=1;
    windowTips.components.push({id:'repair-tips-raycaster',type:'UnityEngine.UI.GraphicRaycaster',properties:{m_Enabled:1,m_IgnoreReversedGraphics:1,m_BlockingObjects:0}});
    const windowFile=join(directory,'window-spec.json');
    await writeFile(windowFile,JSON.stringify([windowSpec]));
    nodes.find(n=>n.id===approvedWindow.rootNodeId).name=approvedRoot.name;
    payload.targetSnapshot.prefab.name=approvedRoot.name;
    for (const name of ['titleText','tipsDetail'])
    {
        const node=nodes.find(n=>n.name===name);
        const approved=approvedWindow.nodes.find(n=>n.id===node.id);
        const text=node.components.find(c=>c.type==='UnityEngine.UI.Text');
        const original=approved.components.find(c=>c.id===text.id);
        for (const property of name==='titleText' ? ['m_Color.r','m_Color.g','m_Color.b','m_Color.a'] : ['m_FontData.m_BestFit','m_FontData.m_FontSize'])
        {
            text.properties[property]=original.properties[property];
        }
    }
    const group=nodes.find(n=>n.id==='6305621391415780078');
    const tips=nodes.find(n=>n.id==='7339243912597274077');
    if (JSON.stringify(group.rect.anchoredPosition)!=='[0,0]' || tips.components.some(c=>c.type==='UnityEngine.UI.GraphicRaycaster')) throw new Error('Review source before applying known approved delta');
    group.rect.anchoredPosition=[-80,60];
    tips.components.find(c=>c.id==='1893093729200777271').properties.m_RaycastTarget=1;
    tips.components.push({id:'repair-tips-raycaster',type:'UnityEngine.UI.GraphicRaycaster',properties:{m_Enabled:1,m_IgnoreReversedGraphics:1,m_BlockingObjects:0}});
    const baseline=join(directory,'baseline.json');
    const candidate=join(directory,'candidate.json');
    await writeFile(baseline,payload.guardBaselineJson);
    await writeFile(candidate,JSON.stringify(payload.targetSnapshot));
    const auditPath=join(directory,'guard-audit.json');
    const auditRun=await runPmCli(['--baseline',baseline,'--candidate',candidate,'--output',auditPath],['ui-library','guard']);
    if (auditRun.code!==0) throw new Error('Guard audit failed');
    const auditText=await readFile(auditPath,'utf8');
    const audit=JSON.parse(auditText);
    // The candidate above is the fixed original target plus only the user-approved three deltas.
    // Every inherited diff remains covered by the pinned original change approval.
    const reference='当前对话已明确批准的三项最小修复；用户要求重新审批并完整走一次流程。保留旧源基线，统一白模、资源及最终装配目标。';
    payload.authorizedChanges={...payload.authorizedChanges,authorizationReference:reference,changes:audit.changes};
    const approvalPath=join(directory,'authorization.json');
    const assemblyPath=join(directory,'guard-assembly.json');
    // Keep exact large numeric values in inherited before-values; JavaScript Number may round them.
    const exactChanges=/"changes"\s*:\s*(\[[\s\S]*\])\s*\}$/.exec(auditText)?.[1];
    if (!exactChanges) throw new Error('Guard audit changes missing');
    const approvalText=JSON.stringify({...payload.authorizedChanges,changes:undefined}).slice(0,-1)+',"changes":'+exactChanges+'}';
    await writeFile(approvalPath,approvalText);
    payload.guardApprovalJson=approvalText;
    const guard=await runPmCli(['--baseline',baseline,'--candidate',candidate,'--approval',approvalPath,'--output',assemblyPath],['ui-library','guard']);
    if (guard.code!==0) throw new Error('Approved guard failed');
    payload.targetAssembly=JSON.parse(await readFile(assemblyPath,'utf8'));
    payload.reapprovalProvenance={sourceVersionId:source.id,sourceDocumentSha256:createHash('sha256').update(source.bytes).digest('hex'),originalTargetSha256:createHash('sha256').update(oldTarget).digest('hex'),authorizationReference:reference};
    let body=html.replace(/<script\b[^>]*\bid=["'](?:ui-template-context|ui-production-contract|design-contract-review)["'][^>]*>[\s\S]*?<\/script>/gi,'');
    body=embedUiTemplateContext(body,payload);
    const sourceFile=join(directory,'authorized-source.html');
    await writeFile(sourceFile,body);
    const prompt=join(directory,'prompt.txt');
    await writeFile(prompt,`批准初稿：登录窗口修复统一版 v1.4。用户原话：“那么先按你的提议优化吧”“继续修复，直到到任务完成”“好的，现在重新审批，走一次流程”。目标：以原需求${key}、原标题${source.title}、新版本${targetVersion}形成待人工审批的完整文档。待确认：无。\n保留原已批准功能、102节点、23槽资源、命名、GUID、动画特效、四状态和三阶段。不增加业务、不生图、不改变其他节点或文案。仅正式统一以下三项已批准修复到所有阶段的唯一目标：buttonGroup节点6305621391415780078的anchoredPosition由[0,0]改为[-80,60]；tips节点7339243912597274077的Image组件1893093729200777271的m_RaycastTarget由0改1；tips新增id=repair-tips-raycaster的UnityEngine.UI.GraphicRaycaster，属性m_Enabled=1,m_IgnoreReversedGraphics=1,m_BlockingObjects=0，总组件208。\n本次提供的ui-template-context已由宿主仅应用这三项差异，并通过原基线guard；完整附件是修订后的固定目标，不得恢复旧约束。原始源基线、模板版本和其他资源不变。正文、属性表、组件统计、线框、windowsJson和交付标准必须与新targetSnapshot完全一致，不要继承旧版“禁止修改命中结构”对这三项的冲突限制。\n模拟验收固定为项目自定义landscape-1920-safe80x40-v1，1920x1080，安全区Rect(80,40,1760,1040)，明确是项目合成配置，不冒充真实设备。检查四状态可见文字和有效点击区域完整处于安全区；装饰背景允许出血；原无Graphic槽位保持无Graphic，不额外补按钮。关闭由本地验证宿主连接，实际射线命中、隐藏窗口、同次触摸不穿透，遮罩拦截底层按钮。修复版预制允许在本轮白模阶段被明确替换为同一新目标的白模，然后Art和装配重新交付。\n依据：${sourceFile}；已通过的实际证据deliveries/F-0001011/retry-94ba78f0及optimization-20261020。不要重新调研或提出已解决问题。输出完整HTML和windowsJson，完成CLI编译及Design独立自检，再提交待审批；不能自批、建单或派工。\n原文需全文保留并同步上述修订，当前附件作为唯一新目标。`);
    const instructions=await readFile(prompt,'utf8');
    const reviewPrompt=join(directory,'review-requirements.txt');
    await writeFile(reviewPrompt,instructions+'\n原始完整可见业务文档（完整附件已包含在待审编译文档中，不重复传输）：\n'+html.replace(/<script\b[^>]*\bid=["'](?:ui-template-context|ui-production-contract|design-contract-review)["'][^>]*>[\s\S]*?<\/script>/gi,''));
    await writeFile(prompt,instructions+'\n以下是宿主已核验的完整原文与完整附件；$contextRef 按 definitions 无损展开，不需要调用工具读取路径。guardApprovalJson 和 targetAssembly 内的原始JSON字符串须按字节原样保留，避免大整数精度损失。\n'+prepareUiDocumentPrompt(body));
    const run=await runPmCli(['--project',projectRoot,'--project-id',source.project_id,'--window-spec',windowFile,'--source-document',sourceFile,'--review-prompt-file',reviewPrompt,'--prompt-file',prompt,'--key',key,'--version',targetVersion,'--skills',join(platformRoot,'skills'),'--timeout','900'],['design','draft']);
    await writeFile(join(directory,'output.json'),run.output ?? '');
    await writeFile(join(directory,'diagnostics.txt'),run.diagnostics ?? '');
    const result=JSON.parse(run.output);
    if (run.code!==0 || result.status!=='draft_saved') throw new Error('Design did not produce a reviewed document: '+JSON.stringify(result));
    const submission=JSON.parse((await readFile(result.submission,'utf8')).replace(/^\uFEFF/,''));
    if (submission.questions?.length) throw new Error('Unresolved questions');
    // Only reset stale business tasks after the reviewed replacement is ready.
    const cleared=await clearProjectTasks(pool,projectKey,user.id,{preserveRequirements:true,clearCollaboration:true});
    const saved=await submitRequirement(pool,projectKey,submission);
    await writeFile(join(directory,'submitted.json'),JSON.stringify(saved,null,2));
    console.log(JSON.stringify({cleared,...saved,awaitingHumanApproval:true}));
}
finally {await pool.end();}
