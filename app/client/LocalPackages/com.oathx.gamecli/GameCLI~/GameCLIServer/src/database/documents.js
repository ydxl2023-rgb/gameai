import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repository = fileURLToPath(new URL('../../../../../../../../', import.meta.url));

export async function readDesignHtml(storageKey)
{
    const root = await realpath(resolve(repository, 'app/desgin'));
    const file = await realpath(resolve(repository, storageKey));
    const inside = relative(root, file);
    if (isAbsolute(storageKey) || isAbsolute(inside) || inside.startsWith('..') || extname(file).toLowerCase() !== '.html')
    {
        throw new Error('仅允许关联 app/desgin 中的 HTML 策划文档。');
    }
    const bytes = await readFile(file);
    return { bytes, hash: createHash('sha256').update(bytes).digest('hex') };
}

export async function linkDesignHtml(pool, projectKey, requirementKey, version, storageKey)
{
    const { bytes, hash } = await readDesignHtml(storageKey);
    const client = await pool.connect();
    try
    {
        await client.query('BEGIN');
        const target = (await client.query(`SELECT v.id,v.project_id FROM gameai.requirement_versions v
            JOIN gameai.requirements r ON r.id=v.requirement_id JOIN gameai.projects p ON p.id=r.project_id
            WHERE p.project_key=$1 AND r.requirement_key=$2 AND v.version=$3 FOR UPDATE OF v`, [projectKey, requirementKey, version])).rows[0];
        if (!target) throw new Error('需求版本不存在。');
        const prior = await client.query('SELECT 1 FROM gameai.approvals WHERE version_id=$1', [target.id]);
        if (prior.rowCount) throw new Error('已审批版本不能更换原文。');
        const linked = await client.query(`SELECT a.storage_key,a.sha256 FROM gameai.artifact_links l
            JOIN gameai.artifacts a ON a.id=l.artifact_id WHERE l.requirement_version_id=$1 AND a.media_type='text/html'`, [target.id]);
        if (linked.rowCount)
        {
            if (linked.rows[0].storage_key !== storageKey || linked.rows[0].sha256 !== hash) throw new Error('该版本已有不同原文，请创建新版本。');
            await client.query('COMMIT');
            return;
        }
        const artifact = (await client.query(`INSERT INTO gameai.artifacts(project_id,storage_key,sha256,byte_size,media_type,verified_at)
            VALUES($1,$2,$3,$4,'text/html',now()) ON CONFLICT(project_id,storage_key) DO UPDATE
            SET verified_at=gameai.artifacts.verified_at WHERE gameai.artifacts.sha256=EXCLUDED.sha256 RETURNING id`, [target.project_id, storageKey, hash, bytes.length])).rows[0];
        if (!artifact) throw new Error('文件已修改，请使用新的版本文件名。');
        await client.query('INSERT INTO gameai.artifact_links(project_id,artifact_id,requirement_version_id) VALUES($1,$2,$3)', [target.project_id, artifact.id, target.id]);
        await client.query("INSERT INTO gameai.audit_events(project_id,actor,event,payload) VALUES($1,'system:document-link','关联策划原始 HTML 文档',$2)", [target.project_id, { requirement: requirementKey, version, path: storageKey, sha256: hash }]);
        await client.query('COMMIT');
    }
    catch (error)
    {
        await client.query('ROLLBACK');
        throw error;
    }
    finally
    {
        client.release();
    }
}

export async function readLinkedHtml(pool, projectKey, artifactId)
{
    const artifact = (await pool.query(`SELECT a.* FROM gameai.artifacts a JOIN gameai.projects p ON p.id=a.project_id
        WHERE p.project_key=$1 AND a.id=$2 AND a.media_type='text/html'
        AND EXISTS(SELECT 1 FROM gameai.artifact_links l WHERE l.artifact_id=a.id AND l.requirement_version_id IS NOT NULL)`, [projectKey, artifactId])).rows[0];
    if (!artifact) return null;
    const uploaded = (await pool.query('SELECT bytes FROM gameai.document_contents WHERE artifact_id=$1', [artifact.id])).rows[0];
    const result = uploaded ? { bytes: uploaded.bytes, hash: createHash('sha256').update(uploaded.bytes).digest('hex') } : await readDesignHtml(artifact.storage_key);
    if (result.hash !== artifact.sha256 || BigInt(result.bytes.length) !== BigInt(artifact.byte_size)) throw new Error('原文已改变，请登记新版本。');
    return result.bytes;
}
