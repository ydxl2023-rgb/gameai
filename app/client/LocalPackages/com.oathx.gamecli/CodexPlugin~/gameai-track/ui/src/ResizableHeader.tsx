import { useRef, type ThHTMLAttributes } from 'react';

type Props = ThHTMLAttributes<HTMLTableCellElement> & {
    resizeWidth?:number;
    minimumWidth?:number;
    resizeLabel?:string;
    onResizeWidth?:(width:number)=>void;
};

/** Pointer capture keeps header dragging local to its handle, including cancellation. */
export function ResizableHeader({resizeWidth,minimumWidth=72,resizeLabel,onResizeWidth,children,style,...rest}:Props)
{
    const drag = useRef<{x:number;width:number} | null>(null);
    const clamp = (width:number) => Math.max(minimumWidth,Math.min(800,Math.round(width)));
    const position = style?.position ?? (rest.className?.includes('ant-table-cell-fix-') ? 'sticky' : 'relative');
    return <th {...rest} style={{...style,position}}>
        {children}
        {resizeWidth !== undefined && onResizeWidth && <span role="separator" aria-orientation="vertical"
            aria-label={`调整 ${resizeLabel} 列宽`} aria-valuemin={minimumWidth} aria-valuemax={800} aria-valuenow={resizeWidth}
            tabIndex={0} title="拖动调整列宽；左右方向键微调"
            style={{position:'absolute',right:0,top:0,bottom:0,width:7,cursor:'col-resize',touchAction:'none',userSelect:'none',zIndex:2,borderRight:'1px solid rgba(125,224,189,0.25)'}}
            onClick={event=>event.stopPropagation()}
            onPointerDown={event=>
            {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                drag.current={x:event.clientX,width:resizeWidth};
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event=>
            {
                if (drag.current) onResizeWidth(clamp(drag.current.width+event.clientX-drag.current.x));
            }}
            onPointerUp={event=>
            {
                drag.current=null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={()=>{drag.current=null;}}
            onLostPointerCapture={()=>{drag.current=null;}}
            onKeyDown={event=>
            {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                {
                    event.preventDefault();
                    event.stopPropagation();
                    onResizeWidth(clamp(resizeWidth+(event.key === 'ArrowRight' ? 8 : -8)));
                }
            }} />}
    </th>;
}
