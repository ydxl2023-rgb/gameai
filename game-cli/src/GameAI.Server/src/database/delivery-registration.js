import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {projectRoot} from '../paths.js';
import {inspectTaskFiles} from './task-files.js';
import {requiredAnimationFiles} from './ui-visual-delivery.js';
import {DeliveryError} from './delivery-errors.js';

// Receipts must themselves belong to this execution's verified output. Do not
// scan directories or accept an existing file as proof of current delivery.
export async function registerContractAssets(input, artifacts, {inspect=inspectTaskFiles,read=path=>readFile(resolve(projectRoot,path))} = {})
{
    if (!input || !['art-resources','prefab-assembly'].includes(input.type)) return artifacts;
    const required = requiredAnimationFiles(input.window);
    const registered = new Map(artifacts.map(a=>[a.path,a]));
    const missing = required.filter(path=>!registered.has(path));
    if (!missing.length) return artifacts;
    const expected = new Map();
    for (const artifact of artifacts.filter(a=>a.path.endsWith('.json')))
    {
        const bytes = await read(artifact.path);
        if (createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)
        {
            throw new DeliveryError('DELIVERY_HASH_MISMATCH','交付记录在校验后发生变化',[artifact.path]);
        }
        let entries;
        try { entries = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')); }
        catch { continue; }
        // A flat path/hash receipt is the supported transport contract. Arbitrary
        // nested JSON and ZIP contents are never interpreted as implicit assets.
        if (!Array.isArray(entries)) continue;
        for (const entry of entries)
        {
            if (!entry || !missing.includes(entry.path) || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) continue;
            if (expected.has(entry.path) && expected.get(entry.path)!==entry.sha256)
            {
                throw new DeliveryError('DELIVERY_RECEIPT_CONFLICT','交付记录中的文件哈希相互冲突',[entry.path]);
            }
            expected.set(entry.path,entry.sha256);
        }
    }
    const unrecorded = missing.filter(path=>!expected.has(path));
    if (unrecorded.length) throw new DeliveryError('DELIVERY_REGISTRATION_MISSING','契约资产缺少当前执行的路径和哈希记录',unrecorded);
    const additions = [];
    for (const path of missing)
    {
        let files;
        try { files = await inspect([path]); }
        catch (cause)
        {
            if (cause.code==='ENOENT') throw new DeliveryError('DELIVERY_FILE_MISSING','契约交付文件不存在',[path]);
            throw cause;
        }
        const file = files[0];
        if (file.sha256!==expected.get(path)) throw new DeliveryError('DELIVERY_HASH_MISMATCH','契约资产与本次交付记录哈希不一致',[path]);
        additions.push(file);
    }
    return [...artifacts,...additions];
}
