import {z} from 'zod';
import {ReviewError} from './requirements.js';
import {DeliveryError} from './delivery-errors.js';
const text=z.string().trim().min(1).max(12000);
const defect=z.object({case_key:text.max(100),source_task_key:text.max(50),title:text.max(200),preconditions:text,steps:text,expected:text,actual:text,evidence_path:text,fix_acceptance:text}).strict();
const failure=z.object({code:z.enum(['ENVIRONMENT_UNAVAILABLE','CONTRACT_CONFLICT','TASK_VALIDATION_FAILED','UPSTREAM_INVALID','DECISION_REQUIRED','TOOL_FAILURE','UNKNOWN_FAILURE']),step:text.max(200),evidence_path:text,repair:text,source_task_key:text.max(50).nullable().optional()}).strict();
const schema=z.object({verdict:z.enum(['pass','fail','blocked']),summary:text,deliverables:z.array(z.string()),files:z.array(text).max(100),questions:z.array(z.string()),checks:z.array(z.object({name:text,passed:z.boolean(),evidence_path:text}).strict()),failure:failure.nullable().optional(),defects:z.array(defect).max(50).default([]),retests:z.array(z.object({defect_id:z.uuid(),passed:z.boolean(),evidence_path:text}).strict()).max(100).default([])}).strict();
export function parseTaskResult(raw)
{
    const parsed=schema.safeParse(raw);
    if (!parsed.success) throw new ReviewError('执行结果或缺陷字段不完整。');
    return parsed.data;
}
export function validateTaskResult(raw,role)
{
    const value=parseTaskResult(raw);
    if (value.failure)
    {
        if (value.verdict==='pass' || !value.files.includes(value.failure.evidence_path)) throw new ReviewError('结构化失败与通过结论或证据清单冲突。');
        throw new DeliveryError(value.failure.code,value.summary+'；'+value.failure.repair,[value.failure]);
    }
    if (value.verdict==='blocked' || value.questions.length) throw new ReviewError('执行阻塞：'+(value.questions.join('；') || value.summary));
    if (!value.files.length || !value.checks.length || value.checks.some(c=>!value.files.includes(c.evidence_path)) || value.defects.some(d=>!value.files.includes(d.evidence_path)) || value.retests.some(r=>!value.files.includes(r.evidence_path))) throw new ReviewError('缺少真实交付文件或检查证据。');
    if (value.verdict==='pass' && (value.checks.some(c=>!c.passed) || value.defects.length || value.retests.some(r=>!r.passed))) throw new ReviewError('通过结论与测试结果冲突。');
    if (role!=='QA' && (value.verdict!=='pass' || value.defects.length || value.retests.length)) throw new ReviewError('专业交付检查未通过：'+value.summary+'；失败检查：'+value.checks.filter(c=>!c.passed).map(c=>c.name).join('；'));
    if (role==='QA' && value.verdict==='fail' && (!value.defects.length || !value.checks.some(c=>!c.passed))) throw new ReviewError('QA 缺陷必须包含失败测试、复现步骤与证据；环境阻塞不能建缺陷。');
    if (new Set(value.defects.map(d=>d.source_task_key+':'+d.case_key)).size!==value.defects.length || new Set(value.retests.map(r=>r.defect_id)).size!==value.retests.length) throw new ReviewError('缺陷或复测记录重复。');
    return value;
}
