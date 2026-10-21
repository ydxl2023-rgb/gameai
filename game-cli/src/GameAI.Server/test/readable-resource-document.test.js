import test from 'node:test';
import assert from 'node:assert/strict';
import {readableResourceDocument,encodedResourceNames} from '../src/database/readable-resource-document.js';

test('readable copy preserves frozen JSON, links, comments and embedded data byte for byte', () =>
{
    const name = 'a'.repeat(64) + '.ttc';
    const frozen = `<script type="application/json">{"path":"${name}"}</script>`;
    const link = `<a href="${name}">`;
    const comment = `<!-- ${name} -->`;
    const html = `<body>${frozen}${comment}${link}${name}</a><p>${'a'.repeat(64)}</p><img src="data:image/png;base64,AAAA"></body>`;
    const result = readableResourceDocument(html, [{from: 'Assets/' + name, to: 'Assets/MicrosoftYaHeiRegular.ttc'}]);
    assert.equal(result.changedTextNodes, 1);
    assert.ok(result.html.includes(frozen));
    assert.ok(result.html.includes(link));
    assert.ok(result.html.includes(comment));
    assert.ok(result.html.includes('data:image/png;base64,AAAA'));
    assert.ok(result.html.includes('>MicrosoftYaHeiRegular.ttc</a>'));
    assert.ok(result.html.includes('<p>' + 'a'.repeat(64) + '</p>'), 'bare verification hashes are not resource names');
    assert.ok(result.html.includes('不替代正式审批版本'));
});

test('compilation lint catches unmapped names but retains explicit source provenance and machine JSON', () =>
{
    const name = 'b'.repeat(64) + '.png';
    assert.deepEqual(encodedResourceNames(`<body><p>${name}</p><script>{"name":"${name}"}</script></body>`), [name]);
    assert.deepEqual(encodedResourceNames(`<body><details data-resource-provenance><p>${name}</p></details><script>{"name":"${name}"}</script></body>`), []);
    const html = `<body><p>${name}</p></body>`;
    assert.equal(readableResourceDocument(html,[{from:'A/'+name,to:'A/One.png'},{from:'B/'+name,to:'B/Two.png'}]).html,html);
    assert.equal(readableResourceDocument(html,[{from:'A/'+name,to:'A/One.png'}],{notice:false}).html,'<body><p>One.png</p></body>');
});
