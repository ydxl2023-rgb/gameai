import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../../../../../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function prepareApprovedDocument(versionId, sha256, html, root = repository)
{
    if (!/^[0-9a-f-]{36}$/i.test(versionId) || !/^[0-9a-f]{64}$/.test(sha256) || typeof html !== 'string' || digest(Buffer.from(html, 'utf8')) !== sha256)
    {
        throw new Error('批准文档版本或内容哈希无效。');
    }
    const path = `app/desgin/approved/${versionId}-${sha256}.html`;
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await assertContained(root, dirname(target));
    try
    {
        // Never overwrite an existing version: a mismatch must stop dispatch.
        await writeFile(target, html, { encoding: 'utf8', flag: 'wx' });
    }
    catch (error)
    {
        if (error.code !== 'EEXIST') throw error;
    }
    const document = { requirement_version_id: versionId, path, sha256, authority: 'GameCLIServer', usage: '只使用本字段提供的实际路径；正文和任务描述中的其他需求文件名不是存储地址。不得修改本文件。' };
    await verifyApprovedDocument(document, root);
    return document;
}

async function assertContained(root, target)
{
    const local = relative(await realpath(root), await realpath(target));
    if (local.startsWith('..') || isAbsolute(local)) throw new Error('批准文档路径越出工程目录。');
}

export async function verifyApprovedDocument(document, root = repository)
{
    if (!document || !/^app\/desgin\/approved\/[0-9a-f-]{36}-[0-9a-f]{64}\.html$/i.test(document.path)) throw new Error('缺少宿主提供的批准文档路径。');
    const target = resolve(root, document.path);
    await assertContained(root, target);
    if (digest(await readFile(target)) !== document.sha256) throw new Error('已落盘的批准文档哈希不匹配，停止执行。');
}
