export function manifestFixture(count = 1, version = 'v1')
{
    return {schema_version:1,requirement_version:version,scope:'ui-only',windows:Array.from({length:count},(_,index) =>
    {
        const id = 'W'+String(index+1).padStart(2,'0');
        return {id,name:'窗口 '+id,independent:true,parent_window:null,anchor:'#window-'+id,
            controls:[{id:id+'/Root',parent:null,type:'Panel',image_mode:null,sibling_index:0,anchor:'#root-'+id}],resources:[],
            deliveries:[
                {id:id+'-WHITEBOX',phase:'whitebox',role:'Prefab',depends_on:[]},
                {id:id+'-ART',phase:'art',role:'Art',depends_on:[id+'-WHITEBOX']},
                {id:id+'-ASSEMBLY',phase:'assembly',role:'Prefab',depends_on:[id+'-WHITEBOX',id+'-ART']}
            ]};
    })};
}

export function htmlFixture(manifest)
{
    return '<!doctype html><html><head><title>测试</title></head><body>'+manifest.windows.map(window =>
        `<section id="window-${window.id}"><h2>${window.name}</h2><p>完整窗口说明</p>${window.controls.map(control => `<p id="${control.anchor.slice(1)}">${control.id} ${control.type}</p>`).join('')}</section>`).join('')+
        `<script type="application/json" id="ui-delivery-manifest">${JSON.stringify(manifest)}</script></body></html>`;
}

export function planFixture(skeleton)
{
    const acceptance = {preconditions:'已批准',steps:'按窗口完整原文制作',success:'布局与槽位一致',failure:'失败报告原因',recovery:'修订后复核',tests:'检查层级与输出'};
    return {summary:'UI 窗口交付',tasks:skeleton.tasks.map(task => ({id:task.id,title:task.id,role:task.role,source_refs:task.source_refs,depends_on:task.depends_on,description:'按完整窗口章节交付',acceptance}))};
}
