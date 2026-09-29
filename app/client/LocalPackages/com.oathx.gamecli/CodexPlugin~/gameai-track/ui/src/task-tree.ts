import type { Task } from './model';

export type TaskNode = Task & { children?:TaskNode[]; group?:{total:number;completed:number;blocked:number} };

/** Role folders are view-only; task IDs and persisted dependency edges stay unchanged. */
export function groupTaskTree(tasks:Task[], allTasks:Task[]):TaskNode[]
{
    const roles = ['Design','Art','Development','QA','PM'];
    return buildTaskTree(tasks,allTasks).map(root =>
    {
        if (!root.children?.length) return root;
        const groups = new Map<string,TaskNode[]>();
        for (const child of root.children)
        {
            const members = groups.get(child.role) ?? [];
            members.push(child);
            groups.set(child.role,members);
        }
        return {...root,children:[...groups.entries()]
            .sort(([a],[b]) => (roles.indexOf(a)<0 ? 99 : roles.indexOf(a))-(roles.indexOf(b)<0 ? 99 : roles.indexOf(b)))
            .map(([role,children]) => ({
                id:`role-group:${root.id}:${role}`,title:role,role,agent:null,status:'',version:'',progress:0,dependencies:[],children,
                group:{total:children.length,completed:children.filter(t=>t.status==='已完成').length,blocked:children.filter(t=>t.status==='依赖阻塞').length},
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
