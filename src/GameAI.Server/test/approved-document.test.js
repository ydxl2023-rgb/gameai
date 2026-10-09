import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareApprovedDocument, verifyApprovedDocument } from '../src/database/approved-document.js';

test('approved HTML is materialized exactly, reused and guarded against invalid content', async () =>
{
    const root = await mkdtemp(join(tmpdir(), 'gameai-document-'));
    try
    {
        const html = '<html>批准原文：中文</html>\r\n';
        const hash = createHash('sha256').update(html).digest('hex');
        const version = '9911ae61-32f4-48bc-bd30-48f3275d1258';
        const doc = await prepareApprovedDocument(version, hash, html, root);
        assert.equal(await readFile(join(root, doc.path), 'utf8'), html);
        assert.deepEqual(await prepareApprovedDocument(version, hash, html, root), doc);
        await assert.rejects(prepareApprovedDocument(version, hash, html + 'changed', root));
        await assert.rejects(prepareApprovedDocument('../outside', hash, html, root));
        await writeFile(join(root, doc.path), 'tampered');
        await assert.rejects(verifyApprovedDocument(doc, root));
        await assert.rejects(prepareApprovedDocument(version, hash, html, root));
    }
    finally
    {
        await rm(root, { recursive: true, force: true });
    }
});
