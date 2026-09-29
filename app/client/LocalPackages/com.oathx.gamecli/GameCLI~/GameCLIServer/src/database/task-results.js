import {z} from 'zod';
import {ReviewError} from './requirements.js';
const text=z.string().trim().min(1).max(12000);
const defect=z.object({case_key:text.max(100),source_task_key:text.max(50),title:text.max(200),preconditions:text,steps:text,expected:text,actual:text,evidence_path:text,fix_acceptance:text}).strict();
const schema=z.object({verdict:z.enum(['pass','fail','blocked']),summary:text,deliverables:z.array(z.string()),files:z.array(text).max(100),questions:z.array(z.string()),checks:z.array(z.object({name:text,passed:z.boolean(),evidence_path:text}).strict()),defects:z.array(defect).max(50).default([]),retests:z.array(z.object({defect_id:z.uuid(),passed:z.boolean(),evidence_path:text}).strict()).max(100).default([])}).strict();
export function validateTaskResult(raw,role)
{
    const parsed=schema.safeParse(raw);
    if (!parsed.success) throw new ReviewError('执行结果或缺陷字段不完整。');
    const value=parsed.data;
    if (value.verdict==='blocked' || value.questions.length) throw new ReviewError('执行阻塞：'+(value.questions.join('；') || value.summary));
    if (!value.files.length || !value.checks.length || value.checks.some(c=>!value.files.includes(c.evidence_path)) || value.defects.some(d=>!value.files.includes(d.evidence_path)) || value.retests.some(r=>!value.files.includes(r.evidence_path))) throw new ReviewError('缺少真实交付文件或检查证据。');
    if (value.verdict==='pass' && (value.checks.some(c=>!c.passed) || value.defects.length || value.retests.some(r=>!r.passed))) throw new ReviewError('通过结论与测试结果冲突。');
    if (role!=='QA' && (value.verdict!=='pass' || value.defects.length || value.retests.length)) throw new ReviewError('专业交付检查未通过。');
    if (role==='QA' && value.verdict==='fail' && (!value.defects.length || !value.checks.some(c=>!c.passed))) throw new ReviewError('QA 缺陷必须包含失败测试、复现步骤与证据；环境阻塞不能建缺陷。');
    if (new Set(value.defects.map(d=>d.source_task_key+':'+d.case_key)).size!==value.defects.length || new Set(value.retests.map(r=>r.defect_id)).size!==value.retests.length) throw new ReviewError('缺陷或复测记录重复。');
    return value;
}
