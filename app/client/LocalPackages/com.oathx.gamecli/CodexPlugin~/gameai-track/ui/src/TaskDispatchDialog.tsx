import { useState } from 'react';
import { Alert,Checkbox,Modal,Table,Tag } from 'antd';
export interface DispatchRow {task_id:string;id?:string;title?:string;role?:string;agent?:string;ready:boolean;reason:string}
export function TaskDispatchDialog({rows,busy,confirm,close}:{rows:DispatchRow[]|undefined;busy:boolean;confirm:(automatic:boolean)=>void;close:()=>void})
{
    const [automatic,setAutomatic]=useState(true);
    const ready=rows?.filter(row=>row.ready).length ?? 0;
    return <Modal title="确认人工派发" open={!!rows} width={900} getContainer={false} onCancel={close} onOk={()=>confirm(automatic)}
        confirmLoading={busy} cancelButtonProps={{disabled:busy}} okButtonProps={{disabled:!ready || busy}}
        okText={`确认派发可执行任务（${ready}）`} cancelText="返回" destroyOnHidden>
        <Alert type="info" showIcon title="确认后启动固定 Agent；同一工作目录一次执行一个任务。失败任务仅在人工重新派发时重试，最多三次。" />
        <Checkbox checked={automatic} onChange={e=>setAutomatic(e.target.checked)}>交付校验通过后，自动推进同一计划内已勾选且依赖满足的任务（QA 完成后仍需最终验收）</Checkbox>
        <Table size="small" rowKey="task_id" dataSource={rows} pagination={false} scroll={{x:700,y:360}} columns={[
            {title:'Task',dataIndex:'id',width:115},{title:'交付内容',dataIndex:'title',ellipsis:true},
            {title:'Role',dataIndex:'role',width:115},{title:'Agent',dataIndex:'agent',width:100},
            {title:'派发检查',dataIndex:'reason',width:260,render:(text,row)=><><Tag color={row.ready?'green':'gold'}>{row.ready?'可派发':'暂不可派发'}</Tag>{text}</>},
        ]} />
    </Modal>;
}
