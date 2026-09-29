import {Table, type TableProps} from 'antd';
import {useEffect,useState} from 'react';
import {ResizableHeader} from './ResizableHeader';

type Props<T extends object> = TableProps<T> & {storageKey:string;minimumWidths?:number[]};

/** All workbench data lists share persisted column resizing without changing row behavior. */
function ResizableTableState<T extends object>({storageKey,columns=[],minimumWidths=[],scroll,components,...props}:Props<T>)
{
    const [saved,setSaved]=useState<Record<string,number>>(()=>
    {
        try
        {
            const value=JSON.parse(localStorage.getItem(storageKey) ?? '{}');
            if(value && typeof value==='object') return value;
        }
        catch { /* Embedded hosts may deny local storage. */ }
        return {};
    });
    useEffect(()=>
    {
        try {localStorage.setItem(storageKey,JSON.stringify(saved));}
        catch { /* Resizing still works in memory. */ }
    },[storageKey,saved]);
    let index=0;
    let total=0;
    function resize(list:NonNullable<TableProps<T>['columns']>):NonNullable<TableProps<T>['columns']>
    {
        return list.map(column=>
        {
            if('children' in column) return {...column,children:resize(column.children)};
            const position=index++;
            const key=String(column.key ?? column.dataIndex ?? column.title ?? position);
            const minimum=minimumWidths[position] ?? 60;
            const initial=typeof column.width==='number' ? column.width : 180;
            // Accept the previous task/agent array storage as a migration fallback.
            const stored=saved[key] ?? saved[position];
            const width=Math.max(minimum,Math.min(800,Number.isFinite(stored)?stored:initial));
            total+=width;
            return {...column,width,onHeaderCell:c=>
            {
                const original=column.onHeaderCell?.(c) ?? {};
                return {...original,style:{...original.style,width},resizeWidth:width,minimumWidth:minimum,
                    resizeLabel:typeof column.title==='string'?column.title:key,
                    onResizeWidth:(next:number)=>setSaved(old=>({...old,[key]:next}))};
            }};
        });
    }
    const resized=resize(columns);
    return <Table<T> {...props} tableLayout="fixed" columns={resized} components={{...components,header:{...components?.header,cell:ResizableHeader}}} scroll={{...scroll,x:total}} />;
}

export function ResizableTable<T extends object>(props:Props<T>)
{
    return <ResizableTableState<T> key={props.storageKey} {...props} />;
}
