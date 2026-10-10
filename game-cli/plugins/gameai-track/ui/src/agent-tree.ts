import type { Agent } from './model';
export type AgentNode = Agent & { team?: boolean; skillRoots?: string; children?: AgentNode[] };
export function groupAgentTeams(agents: Agent[]): AgentNode[]
{
    const teams = [
        {key:'art',name:'美术',roles:['Art']},
        {key:'design',name:'策划',roles:['Design']},
        {key:'development',name:'开发',roles:['Development','Prefab']},
        {key:'pm',name:'PM',roles:['PM']},
        {key:'qa',name:'QA',roles:['QA']},
    ];
    return teams.map(team =>
    {
        const members = agents.filter(agent => team.roles.includes(agent.role));
        return {
            id:`team:${team.key}`,name:team.name,role:'',team:true,
            skillRoots:team.key === 'development' ? 'development / prefab' : team.key,
            status:'',task:null,station:'',read:false,write:false,
            used:members.reduce((sum,agent)=>sum+agent.used,0),
            capacity:members.reduce((sum,agent)=>sum+agent.capacity,0),
            children:members.length ? members.map(agent=>({...agent})) : undefined,
        };
    });
}
