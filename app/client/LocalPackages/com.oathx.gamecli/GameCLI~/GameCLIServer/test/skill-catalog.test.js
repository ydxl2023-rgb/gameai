import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverSkills,readSkill,loadSkillInstructions,canUseExtraSkill,isPrimarySkill} from '../src/database/skill-catalog.js';

test('nested specialists inherit roles; loading includes parents and shared rules but not sibling specialties', async () =>
{
    const skills = await discoverSkills();
    assert.equal(skills.filter(s => s.skill_key.includes('/')).length, 23);
    const child = skills.find(s => s.skill_key === 'gameai-dev/dev-web');
    assert.equal(child.name, 'dev-web');
    assert.equal(child.role_code, 'Development');
    assert.equal(isPrimarySkill(child), false);
    assert.equal(canUseExtraSkill(child, 'Development'), true);
    assert.equal(canUseExtraSkill(child, 'QA'), false);
    assert.equal(canUseExtraSkill(skills.find(s => s.skill_key === 'gameai-dev'), 'Development'), false);
    const catalog = skills.map(s => ({...s,enabled:true}));
    const text = await loadSkillInstructions([child], catalog);
    assert.ok(text.includes('技能来源：game-cli/gameai-dev/SKILL.md'));
    assert.ok(text.includes('技能来源：game-cli/gameai-common/SKILL.md'));
    assert.equal(text.includes('技能来源：game-cli/gameai-dev/dev-unity/SKILL.md'), false);
    assert.ok(text.includes('技能来源：game-cli/gameai-common/gameai-cli-development/SKILL.md'));
    const common = await loadSkillInstructions([skills.find(s => s.skill_key === 'gameai-common')], catalog);
    assert.equal(common.includes('技能来源：game-cli/gameai-common/gameai-document-format/SKILL.md'), false);
    const repair = skills.find(s => s.skill_key === 'gameai-qa/gameai-qa-repair');
    assert.equal(canUseExtraSkill(repair, 'Development'), true);
    assert.equal(canUseExtraSkill(skills.find(s=>s.skill_key==='gameai-dev/dev-unity'),'QA'),true);
    const qa = await loadSkillInstructions([skills.find(s=>s.skill_key==='gameai-qa')],catalog,undefined,'QA');
    assert.ok(qa.includes('## Unity 验证'));
    assert.equal(qa.includes('技能来源：game-cli/gameai-dev/SKILL.md'),false);
    const qaSelected = await loadSkillInstructions([skills.find(s=>s.skill_key==='gameai-dev/dev-unity')],catalog,undefined,'QA');
    assert.equal(qaSelected.includes('# Unity 开发'),false);
    assert.equal((text.match(/技能来源：game-cli\/gameai-dev\/SKILL.md/g) ?? []).length, 1);
    await assert.rejects(readSkill('../secret'), /路径无效/);
    await assert.rejects(loadSkillInstructions([child],catalog.map(s => s.skill_key===child.skill_key ? {...s,content_hash:'0'.repeat(64)} : s)), /技能已改变/);
    await assert.rejects(loadSkillInstructions([child],catalog.map(s => s.skill_key==='gameai-dev' ? {...s,enabled:false} : s)), /已停用/);
});
