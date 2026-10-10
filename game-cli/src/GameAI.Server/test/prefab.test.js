import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePmPlan} from '../src/database/pm-plans.js';
import {discoverSkills,loadSkillInstructions,canUseExtraSkill} from '../src/database/skill-catalog.js';
import {validateQaReport} from '../src/database/qa-repairs.js';

test('UI production graph supports whitebox, art, assembly and prefab QA without circular dependencies',()=>
{
    const task=(id,role,depends_on=[])=>({id,role,depends_on,title:id,description:'交付',source_refs:['view-01'],acceptance:{preconditions:'前置',steps:'操作',success:'成功',failure:'失败',recovery:'恢复',tests:'测试'}});
    const plan={summary:'UI',tasks:[task('WHITE','Prefab'),task('ART','Art',['WHITE']),task('ASSEMBLY','Prefab',['WHITE','ART']),task('QA','QA',['ASSEMBLY'])]};
    assert.equal(validatePmPlan(plan).tasks.at(-1).id,'QA');
    plan.tasks[0].depends_on=['ASSEMBLY'];
    assert.throws(()=>validatePmPlan(plan),/循环/);
});

test('Prefab skill chain cannot import other roles and PM references do not import Design execution rules',async()=>
{
    const catalog=(await discoverSkills()).map(s=>({...s,enabled:true}));
    const prefab=catalog.find(s=>s.skill_key==='prefab/PrefabAgent01');
    assert.equal(prefab.role_code,'Prefab');
    assert.equal(canUseExtraSkill(catalog.find(s=>s.skill_key==='art/MasayoshiSuto/art-2d'),'Prefab'),false);
    for(const key of ['prefab/PrefabAgent01','pm/PMAgent01'])
    {
        const text=await loadSkillInstructions([catalog.find(s=>s.skill_key===key)],catalog);
        assert.equal(text.includes('技能来源：skills/design/ShigeruMiyamoto/SKILL.md'),false);
        assert.equal(text.includes('技能来源：skills/development/JohnCarmack/SKILL.md'),false);
    }
});

test('QA accepts traceable Prefab defects but rejects unrelated source tasks',()=>
{
    const context={retests:[],dependencies:[{id:'p',role_code:'Prefab',task_key:'F-0000001',execution_id:'e',agent_id:'a'}]};
    validateQaReport(context,{retests:[],defects:[{case_key:'C1',source_task_key:'F-0000001'}]});
    assert.throws(()=>validateQaReport(context,{retests:[],defects:[{case_key:'C1',source_task_key:'F-0000002'}]}));
});
