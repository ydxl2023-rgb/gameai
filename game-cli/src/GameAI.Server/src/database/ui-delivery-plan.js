import { parse } from 'parse5';
import { z } from 'zod';
import { ReviewError } from './requirements.js';

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,19}$/);
const reference = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,19}\/[A-Za-z][A-Za-z0-9_-]{0,39}$/);
const anchor = z.string().regex(/^#[A-Za-z][A-Za-z0-9_-]*$/);
const label = z.string().trim().min(1).max(200);
const control = z.object({
    id:reference, parent:reference.nullable(), type:label,
    image_mode:z.enum(['static','sliced','solid']).nullable(), sibling_index:z.number().int().nonnegative(), anchor
}).strict();
const resource = z.object({
    id, owner_window:id, target_controls:z.array(reference).min(1), generate:z.boolean(),
    kind:z.enum(['static','sliced']), size:z.tuple([z.number().int().positive(),z.number().int().positive()]),
    slice_border:z.tuple(Array.from({length:4}, () => z.number().int().nonnegative())).nullable()
}).strict();
const delivery = z.object({
    id:z.string(), phase:z.enum(['whitebox','art','assembly']), role:z.enum(['Prefab','Art']), depends_on:z.array(z.string())
}).strict();
const schemaV1 = z.object({
    schema_version:z.literal(1), requirement_version:label, scope:z.literal('ui-only'),
    windows:z.array(z.object({
        id:z.string().regex(/^W[A-Z0-9-]{1,19}$/), name:label, independent:z.boolean(), parent_window:id.nullable(), anchor,
        controls:z.array(control), resources:z.array(resource), deliveries:z.array(delivery)
    }).strict()).min(1).max(100)
}).strict();
const nodeName = z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(80);
const schemaV2 = schemaV1.extend({
    schema_version:z.literal(2),
    windows:z.array(schemaV1.shape.windows.element.extend({
        prefab_name:z.string().regex(/^UI[A-Z][A-Za-z0-9]*\.prefab$/).max(96).nullable(),
        controls:z.array(control.extend({name:nodeName}))
    })).min(1).max(100)
});
const schema = z.discriminatedUnion('schema_version',[schemaV1,schemaV2]);

function requireValid(condition, message)
{
    if (!condition)
    {
        throw new ReviewError('UI 交付清单：'+message);
    }
}

function sameList(actual, expected)
{
    return actual.length === expected.length && new Set(actual).size === actual.length &&
        [...actual].sort().every((item,index) => item === [...expected].sort()[index]);
}

function stages(window)
{
    const prefix = window.id;
    return [
        {id:prefix+'-WHITEBOX',phase:'whitebox',role:'Prefab',depends_on:[]},
        {id:prefix+'-ART',phase:'art',role:'Art',depends_on:[prefix+'-WHITEBOX']},
        {id:prefix+'-ASSEMBLY',phase:'assembly',role:'Prefab',depends_on:[prefix+'-WHITEBOX',prefix+'-ART']}
    ];
}

function inside(node, ancestor)
{
    for (let current = node; current; current = current.parentNode)
    {
        if (current === ancestor)
        {
            return true;
        }
    }
    return false;
}

function parseManifest(text)
{
    const value = JSON.parse(text);
    // JSON.parse accepts repeated keys; reject them instead of accepting the last value silently.
    const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g);
    let position = 0;
    function visit()
    {
        const token = tokens[position++];
        if (token === '{')
        {
            const keys = new Set();
            while (tokens[position] !== '}')
            {
                const key = JSON.parse(tokens[position++]);
                requireValid(!keys.has(key), 'JSON 字段重复：'+key);
                keys.add(key);
                position++;
                visit();
                if (tokens[position] === ',')
                {
                    position++;
                }
            }
            position++;
        }
        else if (token === '[')
        {
            while (tokens[position] !== ']')
            {
                visit();
                if (tokens[position] === ',')
                {
                    position++;
                }
            }
            position++;
        }
    }
    visit();
    return value;
}

/** The approved document, not the model's proposal, owns task identity and edges. */
export function buildUiDeliverySkeleton(html, version)
{
    const nodes = [];
    function walk(node)
    {
        nodes.push(node);
        for (const child of node.childNodes ?? [])
        {
            walk(child);
        }
    }
    walk(parse(html));
    const attr = (node,name) => node.attrs?.find(a => a.name === name)?.value;
    const manifests = nodes.filter(node => attr(node,'id') === 'ui-delivery-manifest');
    requireValid(manifests.length === 1, '必须存在唯一 ui-delivery-manifest，旧文档请修订后重新审批。');
    const element = manifests[0];
    requireValid(element.tagName === 'script' && attr(element,'type') === 'application/json', '清单必须使用 application/json script。');
    let raw;
    try
    {
        raw = parseManifest(element.childNodes.map(node => node.value ?? '').join(''));
    }
    catch
    {
        throw new ReviewError('UI 交付清单：JSON 无效。');
    }
    const parsed = schema.safeParse(raw);
    requireValid(parsed.success, '字段不符合清单契约：'+(parsed.error?.issues[0]?.path.join('.') ?? ''));
    const manifest = parsed.data;
    requireValid(manifest.requirement_version === version, '需求版本与批准版本不一致。');
    const anchors = new Map();
    for (const node of nodes)
    {
        const value = attr(node,'id');
        if (value)
        {
            anchors.set('#'+value,[...(anchors.get('#'+value) ?? []),node]);
        }
    }
    function resolve(value)
    {
        requireValid(anchors.get(value)?.length === 1, '锚点缺失或重复：'+value);
        const node = anchors.get(value)[0];
        requireValid(!['script','style'].includes(node.tagName), '锚点必须指向可见正文：'+value);
        return node;
    }
    const windows = new Map(manifest.windows.map(window => [window.id,window]));
    requireValid(windows.size === manifest.windows.length, '窗口编号重复。');
    const independent = manifest.windows.filter(window => window.independent).sort((a,b) => a.id < b.id ? -1 : 1);
    requireValid(independent.length > 0 && independent.length <= 33, '独立窗口数量须为 1～33。');
    const controls = new Map();
    const resourceIds = new Set();
    const tasks = [];
    const prefabNames = new Set();
    for (const window of manifest.windows)
    {
        const section = resolve(window.anchor);
        if (!window.independent)
        {
            requireValid(manifest.schema_version === 1 || window.prefab_name === null, '内部区域不得声明独立预制名称。');
            const owner = windows.get(window.parent_window);
            requireValid(owner?.independent && inside(section,resolve(owner.anchor)), '内部区域必须属于声明的独立窗口：'+window.id);
            requireValid(window.deliveries.length === 0 && window.controls.length === 0 && window.resources.length === 0, '内部区域不得重复定义控件、资源或交付：'+window.id);
            continue;
        }
        requireValid(window.parent_window === null && section.tagName === 'section', '独立窗口必须拥有 section 且无所属窗口：'+window.id);
        if (manifest.schema_version === 2)
        {
            requireValid(window.prefab_name && !prefabNames.has(window.prefab_name.toLowerCase()), '预制名称缺失或重复：'+window.id);
            prefabNames.add(window.prefab_name.toLowerCase());
        }
        requireValid(!independent.some(other => other.id !== window.id && inside(section,resolve(other.anchor))), '独立窗口章节不能互相嵌套。');
        requireValid(window.controls.length > 0, '缺少完整控件树：'+window.id);
        const siblings = new Set();
        const siblingNames = new Set();
        for (const item of window.controls)
        {
            requireValid(item.id.startsWith(window.id+'/') && !controls.has(item.id), '控件编号重复或所属错误：'+item.id);
            requireValid(inside(resolve(item.anchor),section), '控件锚点不在窗口章节：'+item.id);
            requireValid(item.type === 'Image' ? item.image_mode !== null : item.image_mode === null, '图片模式与控件类型不一致：'+item.id);
            const order = (item.parent ?? '')+':'+item.sibling_index;
            requireValid(!siblings.has(order), '同级绘制顺序重复：'+item.id);
            siblings.add(order);
            if (manifest.schema_version === 2)
            {
                const namedPath = (item.parent ?? '')+'/'+item.name.toLowerCase();
                requireValid(!siblingNames.has(namedPath), '同父节点名称重复：'+item.name);
                siblingNames.add(namedPath);
            }
            controls.set(item.id,item);
        }
        const roots = window.controls.filter(item => item.parent === null);
        requireValid(roots.length === 1 && roots[0].type === 'Panel', '每窗口必须只有一个 Panel 根节点。');
        requireValid(manifest.schema_version === 1 || [window.prefab_name.slice(0,-7), window.prefab_name.slice(0,-7).replace(/^UI/, 'ui')].includes(roots[0].name), '根节点名必须为预制名称或其 ui 前缀小驼峰形式。');
        for (const item of window.controls)
        {
            const seen = new Set();
            let current = item;
            while (current)
            {
                requireValid(!seen.has(current.id), '控件父子关系成环：'+item.id);
                seen.add(current.id);
                if (current.parent === null)
                {
                    break;
                }
                requireValid(current.parent.startsWith(window.id+'/') && controls.has(current.parent), '控件父节点不存在或跨窗口：'+current.id);
                current = controls.get(current.parent);
            }
        }

    }
    // Cross-window image reuse is explicit: assembly waits for its resource owner's Art task.
    const resourceOwners = new Map(independent.map(window => [window.id,new Set()]));
    const mappedControls = new Set();
    for (const window of independent)
    {
        for (const item of window.resources)
        {
            requireValid(!resourceIds.has(item.id) && item.owner_window === window.id, '资源重复或生产归属错误：'+item.id);
            resourceIds.add(item.id);
            requireValid(new Set(item.target_controls).size === item.target_controls.length, '资源目标重复：'+item.id);
            requireValid(item.kind === 'sliced' ? item.slice_border !== null : item.slice_border === null, '切片边距与资源类型不一致：'+item.id);
            if (item.slice_border)
            {
                requireValid(item.slice_border[0]+item.slice_border[2] < item.size[0] && item.slice_border[1]+item.slice_border[3] < item.size[1], '九宫格边距超出图片尺寸：'+item.id);
            }
            for (const target of item.target_controls)
            {
                const mapped = controls.get(target);
                requireValid(mapped?.type === 'Image' && mapped.image_mode === item.kind, '资源必须映射同模式图片控件：'+target);
                requireValid(!mappedControls.has(target), '图片控件存在多个资源来源：'+target);
                mappedControls.add(target);
                resourceOwners.get(target.split('/')[0]).add(window.id);
            }
        }
    }
    for (const item of controls.values())
    {
        requireValid(item.type !== 'Image' || item.image_mode === 'solid' || mappedControls.has(item.id), '图片控件缺少资源映射：'+item.id);
    }
    for (const window of independent)
    {
        for (const stage of stages(window))
        {
            const dependencies = [...stage.depends_on];
            if (stage.phase === 'assembly')
            {
                dependencies.push(...[...resourceOwners.get(window.id)].filter(owner => owner !== window.id).sort().map(owner => owner+'-ART'));
            }
            requireValid(window.deliveries.length === 3 && new Set(window.deliveries.map(item => item.id)).size === 3, '每窗口必须恰有三个阶段：'+window.id);
            const actual = window.deliveries.find(item => item.id === stage.id);
            requireValid(actual && actual.phase === stage.phase && actual.role === stage.role && sameList(actual.depends_on,dependencies), '阶段标识、角色或依赖错误：'+stage.id);
            tasks.push({...stage,window_id:window.id,source_refs:[window.anchor],depends_on:dependencies,
                ...(manifest.schema_version === 2 ? {prefab_name:window.prefab_name} : {})});
        }
    }
    return {schema_version:manifest.schema_version,requirement_version:version,scope:'ui-only',tasks};
}

/** Fail closed; never repair the proposal by silently replacing a changed structural field. */
export function validateUiDeliveryPlan(plan, skeleton)
{
    requireValid(plan.tasks.length === skeleton.tasks.length, 'PM 增加或遗漏任务。');
    const tasks = new Map(plan.tasks.map(task => [task.id,task]));
    requireValid(tasks.size === plan.tasks.length, 'PM 任务编号重复。');
    const ordered = [];
    const pending = new Set(skeleton.tasks.map(task => task.id));
    for (const expected of skeleton.tasks)
    {
        const actual = tasks.get(expected.id);
        requireValid(actual && actual.role === expected.role && sameList(actual.source_refs,expected.source_refs) && sameList(actual.depends_on,expected.depends_on), 'PM 改动任务身份、角色、来源或依赖：'+expected.id);
    }
    while (pending.size)
    {
        const ready = skeleton.tasks.find(task => pending.has(task.id) && task.depends_on.every(id => !pending.has(id)));
        requireValid(ready, '任务依赖成环。');
        ordered.push({...tasks.get(ready.id),source_refs:ready.source_refs,depends_on:ready.depends_on});
        pending.delete(ready.id);
    }
    return {...plan,tasks:ordered};
}
