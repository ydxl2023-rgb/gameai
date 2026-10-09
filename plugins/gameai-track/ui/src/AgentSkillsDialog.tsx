import {useEffect,useState} from 'react';
import {Alert,Modal,Select,Typography} from 'antd';
import type {Agent} from './model';

export function AgentSkillsDialog({agent,close,saved}:{agent?:Agent;close:()=>void;saved:()=>void})
{
    const [options,setOptions]=useState<{capability:string;skills:{skill_key:string;name:string;role_code:string|null}[]}>();
    const [selected,setSelected]=useState<string[]>([]);
    const [error,setError]=useState('');
    const [saving,setSaving]=useState(false);
    useEffect(()=>
    {
        setOptions(undefined);setSelected([]);setError('');
        if(!agent) return;
        const controller=new AbortController();
        void fetch('/api/track/agent-options',{signal:controller.signal}).then(async response=>
        {
            const result=await response.json();
            if(!response.ok) throw new Error(result.error ?? '读取技能失败');
            if(!controller.signal.aborted) setOptions(result);
        }).catch(e=>{if(!controller.signal.aborted) setError(e.message);});
        return ()=>controller.abort();
    },[agent?.id]);
    async function save()
    {
        if(!agent || !options || saving || !selected.length) return;
        setSaving(true);setError('');
        try
        {
            const response=await fetch('/api/track/agent-skills',{method:'POST',headers:{'Content-Type':'application/json','X-GameAI-Agent-Capability':options.capability},body:JSON.stringify({agent:agent.id,skills:selected}),signal:AbortSignal.timeout(15000)});
            const result=await response.json();
            if(!response.ok) throw new Error(result.error ?? '技能保存失败');
            saved();
        }
        catch(e){setError(e instanceof Error ? e.message : '保存失败');}
        finally {setSaving(false);}
    }
    return <Modal title={`添加技能 · ${agent?.name ?? agent?.id ?? ''}`} open={!!agent} onCancel={saving?undefined:close} onOk={()=>void save()} okText="保存技能" cancelText="取消" confirmLoading={saving} okButtonProps={{disabled:!options || !selected.length}} cancelButtonProps={{disabled:saving}} closable={!saving} maskClosable={!saving} getContainer={false}>
        <Typography.Paragraph>保留已有主技能和辅助技能，新增技能在下一次任务执行时生效，不改变角色及权限。</Typography.Paragraph>
        {error && <Alert type="error" title={error} />}
        <Select aria-label="选择添加技能" mode="multiple" placeholder="选择本角色专业技能或公共技能" style={{width:'100%',marginTop:12}} loading={!options && !error} disabled={saving} value={selected} onChange={setSelected} options={options?.skills.filter(s=>(!s.role_code || (s.role_code === agent?.role && s.skill_key.includes('/'))) && !agent?.skills?.some(existing=>existing.key===s.skill_key)).map(s=>({value:s.skill_key,label:s.name}))} />
    </Modal>;
}
