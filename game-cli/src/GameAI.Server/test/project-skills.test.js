import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProjectSkills} from '../src/database/project-skills.js';

test('project rules carry reproducible content and version independently of role skills',async()=>
{
    const first=await loadProjectSkills('DEMO');
    const second=await loadProjectSkills('DEMO');
    assert.deepEqual(first,second);
    assert.equal(first[0].version,'1.0.0');
    assert.match(first[0].sha256,/^[a-f0-9]{64}$/);
    assert.match(first[0].content,/原神/);
});
test('rules from another project cannot silently become defaults',async()=>
{
    await assert.rejects(loadProjectSkills('OTHER'),/不匹配/);
});
