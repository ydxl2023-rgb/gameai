import {parse} from 'parse5';
import {createHash} from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Data travels inside the immutable document, never through machine-local file references.
export function readUiTemplateContext(html)
{
    const found = [];
    function walk(node)
    {
        if (node.attrs?.some(a => a.name === 'id' && a.value === 'ui-template-context')) found.push(node);
        for (const child of node.childNodes ?? []) walk(child);
    }
    walk(parse(html));
    if (!found.length) return null;
    if (found.length !== 1 || found[0].tagName !== 'script' || !found[0].attrs.some(a => a.name === 'type' && a.value === 'application/json'))
    {
        throw new Error('Invalid or duplicate UI template context block.');
    }
    const envelope = JSON.parse(found[0].childNodes.map(n => n.value ?? '').join(''));
    if (envelope.schema_version !== 1 || !envelope.payload || envelope.sha256 !== digest(envelope.payload))
    {
        throw new Error('UI template context hash mismatch.');
    }
    return envelope;
}

export function embedUiTemplateContext(html, payload)
{
    const prior = readUiTemplateContext(html);
    if (prior)
    {
        if (prior.sha256 !== digest(payload)) throw new Error('UI template context cannot change during document repair.');
        return html;
    }
    if (!/<\/body\s*>/i.test(html)) throw new Error('UI template context requires a complete HTML document.');
    const json = JSON.stringify({schema_version:1,sha256:digest(payload),payload}).replace(/</g,'\\u003c');
    return html.replace(/<\/body\s*>/i,() => `<script id="ui-template-context" type="application/json">${json}</script></body>`);
}

export function preserveUiTemplateContext(sourceHtml, targetHtml)
{
    const context = readUiTemplateContext(sourceHtml);
    return context ? embedUiTemplateContext(targetHtml,context.payload) : targetHtml;
}

// The extraction snapshot and the adapted change-guard baseline are different artifacts.
// Pin the exact UTF-8 text used by the approval; reserializing it changes its identity.
export function validateUiTemplateGuardContext(html)
{
    const payload = readUiTemplateContext(html)?.payload;
    if (!payload?.authorizedChanges) return;
    if (typeof payload.guardBaselineJson !== 'string')
    {
        throw new Error('UI_TEMPLATE_GUARD_BASELINE_MISSING: include the exact guardBaselineJson paired with authorizedChanges, not the database extraction snapshot.');
    }
    const hash = createHash('sha256').update(payload.guardBaselineJson,'utf8').digest('hex');
    if (hash !== payload.authorizedChanges.sourceSha256)
    {
        throw new Error('UI_TEMPLATE_GUARD_BASELINE_MISMATCH: baseline bytes do not match authorizedChanges.sourceSha256.');
    }
    if (JSON.parse(payload.guardBaselineJson)?.schemaVersion !== 'ui-template/1')
    {
        throw new Error('UI template guard baseline must use ui-template/1.');
    }
}
