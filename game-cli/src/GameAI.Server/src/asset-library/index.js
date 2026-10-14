import { hash, canonical } from '../ui-library/library.js';

async function request(base, pathname, method = 'GET', body, key)
{
    const response = await fetch(new URL(pathname, base), {
        method,
        headers: { 'content-type': 'application/json', ...(key ? { 'api-key': key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
    });
    if (!response.ok)
    {
        throw new Error(`Remote ${pathname} returned HTTP ${response.status}`);
    }
    return response.json();
}

function settings()
{
    const ollama = process.env.ASSET_OLLAMA_URL;
    const qdrant = process.env.ASSET_QDRANT_URL;
    const key = process.env.ASSET_QDRANT_KEY;
    if (!ollama || !qdrant || !key)
    {
        throw new Error('ASSET_OLLAMA_URL, ASSET_QDRANT_URL and ASSET_QDRANT_KEY are required.');
    }
    return { ollama, qdrant, key, model: process.env.ASSET_EMBEDDING_MODEL ?? 'qwen3-embedding:0.6b' };
}

export function validateVector(vector, dimensions)
{
    if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every(Number.isFinite)
        || !vector.some(value => value !== 0))
    {
        throw new Error('Invalid embedding dimensions or values.');
    }
    return vector;
}

async function embed(config, text, query = false)
{
    const input = query ? `Instruct: Retrieve a game UI template matching the requested function and layout.\nQuery: ${text}` : text;
    const data = await request(config.ollama, '/api/embed', 'POST', { model: config.model, input, truncate: false });
    const vector = data.embeddings?.[0];
    if (!vector?.length)
    {
        throw new Error('Embedding server returned no vector.');
    }
    return validateVector(vector, vector.length);
}

async function discover(config)
{
    const tags = await request(config.ollama, '/api/tags');
    const model = tags.models?.find(item => item.name === config.model);
    if (!model?.digest)
    {
        throw new Error('Configured local embedding model is not installed.');
    }
    const sample = await embed(config, '登录界面 login window');
    const profile = { model: config.model, digest: model.digest, dimensions: sample.length, distance: 'Cosine', summaryVersion: 1, queryInstructionVersion: 1 };
    return { profile, id: `ui_${hash(profile).slice(0,24)}` };
}

export async function initializeIndex(pool)
{
    const config = settings();
    const { profile, id } = await discover(config);
    const collections = await request(config.qdrant, '/collections', 'GET', undefined, config.key);
    if (!collections.result.collections.some(item => item.name === id))
    {
        await request(config.qdrant, `/collections/${id}`, 'PUT', { vectors: { size: profile.dimensions, distance: profile.distance } }, config.key);
    }
    const existing = await request(config.qdrant, `/collections/${id}`, 'GET', undefined, config.key);
    const vectors = existing.result.config.params.vectors;
    if (vectors.size !== profile.dimensions || vectors.distance !== profile.distance)
    {
        throw new Error('Collection vector configuration mismatch.');
    }
    for (const field of ['source', 'category', 'versionId'])
    {
        await request(config.qdrant, `/collections/${id}/index`, 'PUT', { field_name: field, field_schema: 'keyword' }, config.key);
    }
    await pool.query('INSERT INTO search.embedding_profiles VALUES($1,$2) ON CONFLICT DO NOTHING', [id, profile]);
    await pool.query('INSERT INTO search.index_jobs(version_id,profile_id) SELECT version_id,$1 FROM search.documents ON CONFLICT DO NOTHING', [id]);
    return { success: true, profileId: id, profile };
}

async function checkedProfile(pool, id)
{
    if (!/^ui_[a-f0-9]{24}$/.test(id ?? ''))
    {
        throw new Error('Explicit embedding profile ID required.');
    }
    const { rows: [row] } = await pool.query('SELECT configuration FROM search.embedding_profiles WHERE id=$1', [id]);
    if (!row)
    {
        throw new Error('Unknown embedding profile.');
    }
    const config = settings();
    const tags = await request(config.ollama, '/api/tags');
    if (config.model !== row.configuration.model || !tags.models?.some(model => model.name === config.model && model.digest === row.configuration.digest))
    {
        throw new Error('Model changed: create a new embedding profile, do not mix vectors.');
    }
    return { config, profile: row.configuration };
}

export async function indexPending(pool, id)
{
    const { config, profile } = await checkedProfile(pool, id);
    const client = await pool.connect();
    const results = [];
    try
    {
        // Session lock serializes workers even across remote calls; dropped connections release the lock.
        await client.query('SELECT pg_advisory_lock(70928152)');
        const { rows } = await client.query(`SELECT j.version_id,d.summary,d.metadata,t.name,s.source_key
            FROM search.index_jobs j JOIN search.documents d USING(version_id)
            JOIN catalog.template_versions v ON v.id=j.version_id
            JOIN catalog.templates t ON t.id=v.template_id JOIN catalog.sources s ON s.id=t.source_id
            WHERE j.profile_id=$1 AND j.status!='done' ORDER BY j.version_id LIMIT 100`, [id]);
        for (const row of rows)
        {
            try
            {
                const vector = validateVector(await embed(config, row.summary), profile.dimensions);
                await request(config.qdrant, `/collections/${id}/points?wait=true`, 'PUT', {
                    points: [{ id: row.version_id, vector, payload: { versionId: row.version_id, name: row.name, source: row.source_key, category: row.metadata.category, readiness: row.metadata.readiness } }],
                }, config.key);
                await client.query("UPDATE search.index_jobs SET status='done',attempts=attempts+1,last_error=NULL,updated_at=now() WHERE version_id=$1 AND profile_id=$2", [row.version_id, id]);
                results.push({ versionId: row.version_id, status: 'done' });
            }
            catch (error)
            {
                await client.query("UPDATE search.index_jobs SET status='failed',attempts=attempts+1,last_error=$3,updated_at=now() WHERE version_id=$1 AND profile_id=$2", [row.version_id, id, error.message]);
                results.push({ versionId: row.version_id, status: 'failed', error: error.message });
            }
        }
    }
    finally
    {
        await client.query('SELECT pg_advisory_unlock(70928152)');
        client.release();
    }
    return { success: results.every(result => result.status === 'done'), profileId: id, results };
}

export async function search(pool, id, query)
{
    if (!query?.trim() || query.length > 4000)
    {
        throw new Error('Query must contain 1–4000 characters.');
    }
    const { config, profile } = await checkedProfile(pool, id);
    const vector = validateVector(await embed(config, query, true), profile.dimensions);
    const result = await request(config.qdrant, `/collections/${id}/points/query`, 'POST', { query: vector, limit: 10, with_payload: true }, config.key);
    const hits = [];
    for (const point of result.result.points)
    {
        const { rows: [row] } = await pool.query(`SELECT v.id,v.quality,t.name,d.metadata FROM catalog.template_versions v
            JOIN catalog.templates t ON t.id=v.template_id JOIN search.documents d ON d.version_id=v.id
            WHERE v.id=$1`, [point.id]);
        if (row)
        {
            hits.push({ ...row, score: point.score });
        }
    }
    return { success: true, profileId: id, query, hits, note: 'Similarity ranks candidates; it is not an acceptance score.' };
}
