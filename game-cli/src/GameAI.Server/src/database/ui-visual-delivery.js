import {DeliveryError} from './delivery-errors.js';
// Asset responsibilities follow the frozen window, never project-specific names or counts.
export const artVisualScope = 'Art 必须交付冻结 window 的完整视觉资产：resourceSlots，以及 animations/effects 所需的实际动画片段、控制器和其他声明资产。通过 Unity CLI 按批准参数制作或核验复用；仅参数、路径和绑定交接不算资产交付。不得修改最终预制。Prefab 负责消费这些资产、绑定并验证动态效果。实际资产须逐项列入 files，或在本次 files 中提交包含 path、sha256 的 JSON 数组交付记录；服务器按冻结契约核验实际文件后补登记。ZIP 仅作下载包，不能代替可校验的文件交接。';

export function requiredAnimationFiles(window)
{
    const paths = new Set();
    for (const animation of window.animations ?? [])
    {
        const spec = animation.specification ?? {};
        const found = new Set();
        if (spec.controllerPath) found.add(spec.controllerPath);
        for (const command of spec.commands ?? [])
        {
            if (!Array.isArray(command)) throw new Error('Animation command must be an argument array');
            for (let i=0;i<command.length-1;i++)
            {
                if (['--controller','--clip'].includes(command[i])) found.add(command[i+1]);
            }
        }
        if (!found.size) throw new Error('Animation asset specification unsupported: '+animation.id);
        for (const path of found)
        {
            if (typeof path!=='string' || !path.startsWith('Assets/') || path.split('/').some(p=>!p || p==='..') || path.includes('\\') || !/\.(anim|controller)$/.test(path)) throw new Error('Invalid animation asset path');
            paths.add('app/client/'+path);
        }
    }
    return [...paths].sort();
}

export function validateVisualDelivery(input, artifacts)
{
    if (!input || !['art-resources','prefab-assembly'].includes(input.type)) return;
    const delivered = new Set((artifacts ?? []).map(a=>a.path));
    const missing = requiredAnimationFiles(input.window).filter(path=>!delivered.has(path));
    if (missing.length) throw new DeliveryError('DELIVERY_REGISTRATION_MISSING','动画资产未完整交付（仅参数或绑定记录不算完成）：'+missing.join('；'),missing);
}
