import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const roles = { design:'Design', pm:'PM', prefab:'Prefab', art:'Art', development:'Development', qa:'QA' };
export const skillRelocations = {
    "gameai-art": "art/MasayoshiSuto",
    "gameai-common": "common",
    "gameai-design": "design/ShigeruMiyamoto",
    "gameai-dev": "development/JohnCarmack",
    "gameai-pm": "pm/PMAgent01",
    "gameai-prefab": "prefab/PrefabAgent01",
    "gameai-qa": "qa/QAAgent01",
    "gameai-art/art-2d": "art/MasayoshiSuto/art-2d",
    "gameai-art/art-3d": "art/MasayoshiSuto/art-3d",
    "gameai-art/art-animation": "art/MasayoshiSuto/art-animation",
    "gameai-art/art-ui": "art/MasayoshiSuto/art-ui",
    "gameai-art/art-vfx": "art/MasayoshiSuto/art-vfx",
    "gameai-art/art-2d/art-2d-itembox": "art/MasayoshiSuto/art-2d/art-2d-itembox",
    "gameai-common/gameai-cli-development": "common/gameai-cli-development",
    "gameai-common/gameai-csharp-standard": "common/gameai-csharp-standard",
    "gameai-common/gameai-document-format": "common/gameai-document-format",
    "gameai-common/gameai-mobile-requirements": "common/gameai-mobile-requirements",
    "gameai-common/gameai-task-delivery": "common/gameai-task-delivery",
    "gameai-common/gameai-task-writing": "common/gameai-task-writing",
    "gameai-design/design-battle": "design/ShigeruMiyamoto/design-battle",
    "gameai-design/design-excel": "design/ShigeruMiyamoto/design-excel",
    "gameai-design/design-system": "design/ShigeruMiyamoto/design-system",
    "gameai-dev/dev-cocos": "development/JohnCarmack/dev-cocos",
    "gameai-dev/dev-godot": "development/JohnCarmack/dev-godot",
    "gameai-dev/dev-unity": "development/JohnCarmack/dev-unity",
    "gameai-dev/dev-web": "development/JohnCarmack/dev-web",
    "gameai-pm/pm-art-breakdown": "pm/PMAgent01/pm-art-breakdown",
    "gameai-qa/gameai-qa-repair": "qa/QAAgent01/gameai-qa-repair",
    "gameai-qa/qa-cocos": "qa/QAAgent01/qa-cocos",
    "gameai-qa/qa-godot": "qa/QAAgent01/qa-godot",
    "gameai-qa/qa-unity": "qa/QAAgent01/qa-unity",
    "gameai-qa/qa-web": "qa/QAAgent01/qa-web"
};
export const skillRoot = fileURLToPath(new URL('../../../../skills/', import.meta.url));
export const skillKeyPattern = /^[a-zA-Z0-9-]+(?:\/[a-zA-Z0-9-]+)*$/;

export function isPrimarySkill(skill)
{
    return skill.skill_key.split('/').length === 2 && !!roles[skill.skill_key.split('/')[0]];
}

export function canUseExtraSkill(skill, role)
{
    const root = Object.keys(roles).find(key => roles[key] === role);
    return !!root && skill.skill_key.startsWith(root + '/') && skill.skill_key.split('/').length > 2;
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
            if (error.code === 'ENOENT')
            {
                for (const child of await readdir(resolve(root, key), {withFileTypes:true}))
                {
                    if (child.isDirectory() && /^[a-zA-Z0-9-]+$/.test(child.name)) await visit(key + '/' + child.name);
                }
                return;
            }
            throw error;
        }
        const name = /^name:\s*([a-z0-9-]+)\s*$/m.exec(bytes.toString('utf8'))?.[1];
        if (!name) throw new Error('技能名称与目录不一致：' + key);
        result.push({ skill_key: key, name, path: 'skills/' + key + '/SKILL.md', role_code: key === 'qa/QAAgent01/gameai-qa-repair' ? null : Object.entries(roles).find(([prefix]) => key === prefix || key.startsWith(prefix + '/'))?.[1] ?? null,
            content_hash: createHash('sha256').update(bytes).digest('hex') });
        for (const child of (await readdir(resolve(root, key), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name)))
        {
            if (child.isDirectory() && /^[a-zA-Z0-9-]+$/.test(child.name)) await visit(key + '/' + child.name);
        }
    }
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name)))
    {
        if (entry.isDirectory() && ['design','art','development','prefab','pm','qa','common'].includes(entry.name)) await visit(entry.name);
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
            if (fragment !== 'unity-validation' || key !== 'development/JohnCarmack/dev-unity') throw new Error('不支持的技能章节引用。');
            const marker = '<a id="unity-validation"></a>';
            const position = text.indexOf(marker);
            if (position < 0) throw new Error('Unity 验证章节缺失。');
            text = text.slice(position + marker.length);
        }
        output.push('技能来源：skills/' + key + '/SKILL.md\n' + text);
        for (const match of text.matchAll(/\]\(([^)]+SKILL\.md(?:#[a-z0-9-]+)?)\)/g))
        {
            const [link, section] = match[1].split('#');
            const target = resolve(root, key, link);
            const dependency = relative(root, dirname(target)).split(sep).join('/');
            if (!skillKeyPattern.test(dependency)) throw new Error('技能引用超出目录：' + key);
            // Child links are routing choices, not instructions to load every specialty.
            if (dependency.startsWith(key + '/') && !dependency.split('/').at(-1).startsWith('gameai-')) continue;
            if (key === 'common' && dependency.startsWith(key + '/')) continue;
            // Cross-role links describe collaboration; they must not import another role's execution instructions.
            const owner = role ?? selected.find(s => s.role_code)?.role_code;
            const dependencyRole = registered.get(dependency)?.role_code ?? Object.entries(roles).find(([prefix]) => dependency === prefix || dependency.startsWith(prefix + '/'))?.[1];
            if (owner && dependencyRole && dependencyRole !== owner && section !== 'unity-validation') continue;
            await load(dependency, section ?? null);
        }
    }
    for (const skill of selected) await load(skill.skill_key, role === 'QA' && skill.skill_key === 'development/JohnCarmack/dev-unity' ? 'unity-validation' : null);
    return output.join('\n\n');
}
