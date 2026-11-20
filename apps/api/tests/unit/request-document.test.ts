import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {filledDocx, originalTemplate, sameSnapshot} from '../../src/request-document.js';
import type {DocumentSnapshot} from '../../src/schema.js';

test('source templates retain all 16 checksums; filling preserves logos/styles and escapes untrusted text', async()=>{
  const base=new URL('../../assets/request-templates/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  assert.equal(Object.keys(manifest).length,16);
  for(const [type,entry] of Object.entries(manifest)) {
    assert.equal(createHash('sha256').update(await originalTemplate(type)).digest('hex'),(entry as {sha256:string}).sha256);
  }
  await assert.rejects(originalTemplate('other'));
  await assert.rejects(originalTemplate('../schema'));
  for(const documentType of ['study','retake'] as const) {
    const parts=unzipSync(await readFile(new URL(`fillable/${documentType}.docx`,base)));
    const keys=[...strFromU8(parts['word/document.xml']!).matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m=>m[1]!);
    const fields=Object.fromEntries(keys.map(k=>[k,'Тест <данные> & "значение"']));
    const snapshot:DocumentSnapshot={fullName:'Тест',faculty:'Тест',program:'Тест',year:1,groupName:'Тест',purpose:'Тест',templateVersion:'test',documentType,fields};
    const result=unzipSync(await filledDocx(snapshot));
    const xml=strFromU8(result['word/document.xml']!);
    assert.ok(xml.includes('&lt;данные&gt; &amp; &quot;значение&quot;'));
    assert.ok(!xml.includes('{{FULL_NAME}}'));
    for(const [path,data] of Object.entries(parts)) if(path!=='word/document.xml') assert.deepEqual(result[path],data,path);
    const original=unzipSync(await originalTemplate(documentType));
    for(const [path,data] of Object.entries(original)) if(path!=='word/document.xml') assert.deepEqual(result[path],data,path);
    const reordered={...snapshot,fields:Object.fromEntries(Object.entries(fields).reverse())};
    assert.ok(sameSnapshot(reordered,snapshot),'JSONB key order must not invalidate a snapshot');
    await assert.rejects(filledDocx({...snapshot,fields:{}}));
  }
});
