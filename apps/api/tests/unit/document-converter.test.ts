import {test} from 'node:test';
import assert from 'node:assert/strict';
import {docxToPdf} from '../../src/document-converter.js';

test('missing converter returns a bounded error and releases its concurrency slot',async()=>{
  const previous=process.env.DOCUMENT_CONVERTER;
  process.env.DOCUMENT_CONVERTER='/nonexistent/mukpid-test-converter';
  try{
    for(let i=0;i<2;i++) await assert.rejects(docxToPdf(Buffer.from('not a real document')),error=>{
      assert.equal((error as {statusCode:number}).statusCode,503);
      assert.ok(!(error as Error).message.includes('/nonexistent'));
      assert.match((error as Error).message,/Не удалось сформировать/);
      return true;
    });
  }finally{
    if(previous===undefined)delete process.env.DOCUMENT_CONVERTER;else process.env.DOCUMENT_CONVERTER=previous;
  }
});
