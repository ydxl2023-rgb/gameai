import type { Task } from './model';

export type TaskProgress = { total:number; completed:number; failed:number; percent:number };
export type TaskNode = Task & { children?:TaskNode[]; group?:{total:number;completed:number;blocked:number}; aggregate?:TaskProgress };

/** Count real executable leaves once, using the full scope even when rows are filtered. */
export function taskProgress(rootId:string, tasks:Task[], role?:string):TaskProgress
{
    const parents = new Set(tasks.map(task => task.parent_id).filter(Boolean));
    const byId = new Map(tasks.map(task => [task.id,task]));
    const members = tasks.filter(task =>
    {
        if (task.id === rootId || parents.has(task.id) || (role && task.role !== role)) return false;
        let parent = task.parent_id;
        const seen = new Set<string>();
        while (parent && !seen.has(parent))
        {
            if (parent === rootId) return true;
            seen.add(parent);
            parent = byId.get(parent)?.parent_id;
        }
        return false;
    });
    const completed = members.filter(task => task.status === '已完成').length;
    return {total:members.length,completed,failed:members.filter(task => task.status === '失败').length,percent:members.length ? Math.floor(completed * 100 / members.length) : 0};
}

/** Role folders are view-only; task IDs and persisted dependency edges stay unchanged. */
export function groupTaskTree(tasks:Task[], allTasks:Task[]):TaskNode[]
{
    const roles = ['Design','Art','Development','QA','PM'];
    return buildTaskTree(tasks,allTasks).map(root =>
    {
        if (!root.children?.length) return root.role === 'PM' && !root.parent_id ? {...root,aggregate:taskProgress(root.id,allTasks)} : root;
        const groups = new Map<string,TaskNode[]>();
        for (const child of root.children)
        {
            const members = groups.get(child.role) ?? [];
            members.push(child);
            groups.set(child.role,members);
        }
        return {...root,aggregate:taskProgress(root.id,allTasks),children:[...groups.entries()]
            .sort(([a],[b]) => (roles.indexOf(a)<0 ? 99 : roles.indexOf(a))-(roles.indexOf(b)<0 ? 99 : roles.indexOf(b)))
            .map(([role,children]) => ({
                id:`role-group:${root.id}:${role}`,title:role,role,agent:null,status:'',version:'',progress:0,dependencies:[],children,
                group:{total:children.length,completed:children.filter(t=>t.status==='已完成').length,blocked:children.filter(t=>t.status==='依赖阻塞').length},
                aggregate:taskProgress(root.id,allTasks,role),
            }))};
    });
}

export function expandableTaskKeys(nodes:TaskNode[]):string[]
{
    return nodes.flatMap(node => node.children?.length ? [node.id,...expandableTaskKeys(node.children)] : []);
}

/** Keep ancestor context when search or column filters match only a descendant. */
export function buildTaskTree(tasks:Task[], allTasks:Task[]):TaskNode[]
{
    const byId = new Map(allTasks.map(task => [task.id,task]));
    const included = new Set<string>();
    for (const task of tasks)
    {
        let current:Task | undefined = task;
        while (current && !included.has(current.id))
        {
            included.add(current.id);
            current = current.parent_id ? byId.get(current.parent_id) : undefined;
        }
    }
    const nodes = new Map(allTasks.filter(task => included.has(task.id)).map(task => [task.id,{...task} as TaskNode]));
    const roots:TaskNode[] = [];
    for (const node of nodes.values())
    {
        const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
        if (parent && parent !== node)
        {
            (parent.children ??= []).push(node);
        }
        else
        {
            roots.push(node);
        }
    }
    return roots;
}
