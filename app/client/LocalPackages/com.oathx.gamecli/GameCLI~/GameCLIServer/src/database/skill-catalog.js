import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const roles = { 'gameai-design': 'Design', 'gameai-pm': 'PM', 'gameai-art': 'Art', 'gameai-dev': 'Development', 'gameai-qa': 'QA' };
export const skillRelocations = {
    'gameai-task-writing': 'gameai-common/gameai-task-writing',
    'gameai-task-delivery': 'gameai-common/gameai-task-delivery',
    'gameai-document-format': 'gameai-common/gameai-document-format',
    'gameai-mobile-requirements': 'gameai-common/gameai-mobile-requirements',
    'gameai-cli-development': 'gameai-common/gameai-cli-development',
    'gameai-requirement-discovery': 'gameai-design/gameai-requirement-discovery',
    'gameai-qa-repair': 'gameai-qa/gameai-qa-repair',
    'gameai-unity': 'gameai-dev/dev-unity',
    'gameai-dev/gameai-unity': 'gameai-dev/dev-unity'
};
export const skillRoot = fileURLToPath(new URL('../../../../game-cli/', import.meta.url));
export const skillKeyPattern = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

export function isPrimarySkill(skill)
{
    return !!roles[skill.skill_key];
}

export function canUseExtraSkill(skill, role)
{
    if (skill.skill_key === 'gameai-dev/dev-unity' && role === 'QA') return true;
    return !isPrimarySkill(skill) && (skill.role_code === null || skill.role_code === role);
}

export async function readSkill(key, root = skillRoot)
{
    if (!skillKeyPattern.test(key)) throw new Error('技能路径无效。');
    const base = await realpath(root);
    const path = await realpath(resolve(base, key, 'SKILL.md'));
    const location = relative(base, path);
    if (location.startsWith('..' + sep) || location === '..' || isAbsolute(location)) throw new Error('技能路径超出分发目录。');
    return readFile(path);
}

export async function discoverSkills(root = skillRoot)
{
    const result = [];
    async function visit(key)
    {
        let bytes;
        try { bytes = await readSkill(key, root); }
        catch (error)
        {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        const name = /^name:\s*([a-z0-9-]+)\s*$/m.exec(bytes.toString('utf8'))?.[1];
        if (name !== key.split('/').at(-1)) throw new Error('技能名称与目录不一致：' + key);
        result.push({ skill_key: key, name, path: 'game-cli/' + key + '/SKILL.md', role_code: key === 'gameai-qa/gameai-qa-repair' ? null : roles[key.split('/')[0]] ?? null,
            content_hash: createHash('sha256').update(bytes).digest('hex') });
        for (const child of (await readdir(resolve(root, key), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name)))
        {
            if (child.isDirectory() && /^[a-z0-9-]+$/.test(child.name)) await visit(key + '/' + child.name);
        }
    }
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name)))
    {
        if (entry.isDirectory() && entry.name.startsWith('gameai-')) await visit(entry.name);
    }
    return result;
}

export async function loadSkillInstructions(selected, catalog, root = skillRoot, role = null)
{
    const registered = new Map(catalog.map(skill => [skill.skill_key, skill]));
    const seen = new Set();
    const output = [];
    async function load(key, fragment = null)
    {
        const identity = key + (fragment ? '#' + fragment : '');
        if (seen.has(identity)) return;
        seen.add(identity);
        const skill = registered.get(key);
        if (!skill || !skill.enabled) throw new Error('依赖技能未登记或已停用：' + key);
        const bytes = await readSkill(key, root);
        if (createHash('sha256').update(bytes).digest('hex') !== skill.content_hash) throw new Error('技能已改变，请先同步技能目录：' + key);
        let text = bytes.toString('utf8');
        if (fragment)
        {
            if (fragment !== 'unity-validation' || key !== 'gameai-dev/dev-unity') throw new Error('不支持的技能章节引用。');
            const marker = '<a id="unity-validation"></a>';
            const position = text.indexOf(marker);
            if (position < 0) throw new Error('Unity 验证章节缺失。');
            text = text.slice(position + marker.length);
        }
        output.push('技能来源：game-cli/' + key + '/SKILL.md\n' + text);
        for (const match of text.matchAll(/\]\(([^)]+SKILL\.md(?:#[a-z0-9-]+)?)\)/g))
        {
            const [link, section] = match[1].split('#');
            const target = resolve(root, key, link);
            const dependency = relative(root, dirname(target)).split(sep).join('/');
            if (!skillKeyPattern.test(dependency)) throw new Error('技能引用超出目录：' + key);
            // Child links are routing choices, not instructions to load every specialty.
            if (dependency.startsWith(key + '/') && !dependency.split('/').at(-1).startsWith('gameai-')) continue;
            if (key === 'gameai-common' && dependency.startsWith(key + '/') && dependency !== 'gameai-common/gameai-cli-development') continue;
            await load(dependency, section ?? null);
        }
    }
    for (const skill of selected) await load(skill.skill_key, role === 'QA' && skill.skill_key === 'gameai-dev/dev-unity' ? 'unity-validation' : null);
    return output.join('\n\n');
}
