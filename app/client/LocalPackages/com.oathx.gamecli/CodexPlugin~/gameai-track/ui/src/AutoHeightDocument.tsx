import { useEffect, useRef, useState } from 'react';

/** Preserves document styles while letting the containing drawer own scrolling. */
export function AutoHeightDocument({ html, title }: { html: string; title: string })
{
    const frame = useRef<HTMLIFrameElement>(null);
    const observer = useRef<ResizeObserver | null>(null);
    const [height, setHeight] = useState(1);
    useEffect(() => () => observer.current?.disconnect(), []);
    function measureDocument()
    {
        observer.current?.disconnect();
        const doc = frame.current?.contentDocument;
        const view = frame.current?.contentWindow;
        if (!doc?.body || !view) return;
        // Same-origin enables host measurement only; sandbox and CSP still prohibit all document scripts.
        const style = doc.createElement('style');
        style.textContent = 'html,body{height:auto!important;min-height:0!important;overflow:hidden!important}';
        doc.head.appendChild(style);
        const measure = () =>
        {
            const body = doc.body;
            const css = view.getComputedStyle(body);
            const margins = (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0);
            const next = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height) + margins + 2);
            setHeight(previous => previous === next ? previous : Math.max(1, next));
        };
        observer.current = new ResizeObserver(measure);
        observer.current.observe(doc.body);
        measure();
    }
    const policy = '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; font-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;">';
    return <iframe ref={frame} title={title} sandbox="allow-same-origin" scrolling="no" referrerPolicy="no-referrer"
        style={{ height }} onLoad={measureDocument} srcDoc={'<!doctype html>' + policy + html.replace(/<!doctype[^>]*>/i, '')} />;
}
