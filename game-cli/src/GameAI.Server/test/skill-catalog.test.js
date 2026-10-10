import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverSkills,readSkill,loadSkillInstructions,canUseExtraSkill,isPrimarySkill} from '../src/database/skill-catalog.js';

test('nested specialists inherit roles; loading includes parents and shared rules but not sibling specialties', async () =>
{
    const skills = await discoverSkills();
    assert.ok(skills.some(s => s.skill_key === 'design/ShigeruMiyamoto/design-system'));
    const child = skills.find(s => s.skill_key === 'development/JohnCarmack/dev-web');
    assert.equal(child.name, 'dev-web');
    assert.equal(child.role_code, 'Development');
    assert.equal(isPrimarySkill(child), false);
    assert.equal(canUseExtraSkill(child, 'Development'), true);
    assert.equal(canUseExtraSkill(child, 'QA'), false);
    assert.equal(canUseExtraSkill(skills.find(s => s.skill_key === 'development/JohnCarmack'), 'Development'), false);
    const catalog = skills.map(s => ({...s,enabled:true}));
    const design = await loadSkillInstructions([skills.find(s => s.skill_key === 'design/ShigeruMiyamoto')], catalog);
    assert.ok(design.includes('Design 自检修订'));
    assert.equal(design.includes('gameai-requirement-discovery'), false);
    const text = await loadSkillInstructions([child], catalog);
    assert.ok(text.includes('技能来源：skills/development/JohnCarmack/SKILL.md'));
    assert.ok(text.includes('技能来源：skills/common/SKILL.md'));
    assert.equal(text.includes('技能来源：skills/development/JohnCarmack/dev-unity/SKILL.md'), false);
    assert.ok(text.includes('技能来源：skills/common/gameai-csharp-standard/SKILL.md'));
    const common = await loadSkillInstructions([skills.find(s => s.skill_key === 'common')], catalog);
    assert.equal(common.includes('技能来源：skills/common/gameai-document-format/SKILL.md'), false);
    const repair = skills.find(s => s.skill_key === 'qa/QAAgent01/gameai-qa-repair');
    assert.equal(canUseExtraSkill(repair, 'Development'), false);
    assert.equal(canUseExtraSkill(skills.find(s=>s.skill_key==='development/JohnCarmack/dev-unity'),'QA'),false);
    const qa = await loadSkillInstructions([skills.find(s=>s.skill_key==='qa/QAAgent01')],catalog,undefined,'QA');
    assert.ok(qa.includes('## Unity 验证'));
    assert.equal(qa.includes('技能来源：skills/development/JohnCarmack/SKILL.md'),false);
    const qaSelected = await loadSkillInstructions([skills.find(s=>s.skill_key==='development/JohnCarmack/dev-unity')],catalog,undefined,'QA');
    assert.equal(qaSelected.includes('# Unity 开发'),false);
    assert.equal((text.match(/技能来源：skills\/development\/JohnCarmack\/SKILL.md/g) ?? []).length, 1);
    await assert.rejects(readSkill('../secret'), /路径无效/);
    await assert.rejects(loadSkillInstructions([child],catalog.map(s => s.skill_key===child.skill_key ? {...s,content_hash:'0'.repeat(64)} : s)), /技能已改变/);
    await assert.rejects(loadSkillInstructions([child],catalog.map(s => s.skill_key==='development/JohnCarmack' ? {...s,enabled:false} : s)), /已停用/);
});

test('roles exclude platform maintenance', async () => {
 const skills = (await discoverSkills()).map(s=>({...s,enabled:true}));
 for (const [key,role] of [['design/ShigeruMiyamoto','Design'],['pm/RodFergusson','PM'],['art/MasayoshiSuto','Art'],['prefab/PrefabAgent01','Prefab'],['development/JohnCarmack','Development'],['qa/QAAgent01','QA']]) {
 const text = await loadSkillInstructions([skills.find(s=>s.skill_key===key)],skills,undefined,role);
 assert.ok(text.includes('技能来源：skills/common/SKILL.md'));
 assert.ok(!text.includes('技能来源：skills/common/gameai-cli-development/SKILL.md'));
 assert.equal(text.includes('技能来源：skills/common/gameai-csharp-standard/SKILL.md'), ['Development','Prefab','QA'].includes(role));
 assert.equal(canUseExtraSkill(skills.find(s=>s.skill_key==='common'),role),false);
 }
});

test('single PM inherits UI and Art but does not load Program', async () => {
 const catalog=(await discoverSkills()).map(s=>({...s,enabled:true}));
 const text=await loadSkillInstructions([catalog.find(s=>s.skill_key==='pm/RodFergusson')],catalog,undefined,'PM');
 assert.ok(text.includes('技能来源：skills/pm/RodFergusson/ui/SKILL.md'));
 assert.ok(text.includes('技能来源：skills/pm/RodFergusson/art/SKILL.md'));
 assert.ok(!text.includes('技能来源：skills/pm/RodFergusson/program/SKILL.md'));
 assert.ok(!catalog.some(s=>['pm/Mr.Art','pm/Mr.UI','pm/Mr.Program'].includes(s.skill_key)));
});
