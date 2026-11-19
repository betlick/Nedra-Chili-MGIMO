import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lessonChange, requestNotice} from '../../src/smart-notices.js';
import {prepareAiNote} from '../../src/request-ai.js';
test('notices identify requests, exact transitions and delivery',()=>{
 const r={id:'demo-123',type:'study',delivery:'pdf'};
 const n=requestNotice(r,'in_progress','ready');
 for(const expected of ['demo-123','Справка об обучении','В работе → Готова','PDF']) assert.ok(n.body.includes(expected));
 assert.ok(requestNotice(r,'submitted','rejected','Нет данных').body.includes('Причина: Нет данных'));
});
test('lesson notices retain old and new facts and Moscow time; no-op stays silent',()=>{
 const a={subject:'Демо дисциплина',kind:'lecture',startsAt:new Date('2026-11-19T06:00:00Z'),endsAt:new Date('2026-11-19T07:30:00Z'),room:'101',teacherName:'Демо преподаватель'};
 assert.equal(lessonChange(a,a),null);
 const text=lessonChange(a,{...a,startsAt:new Date('2026-11-20T06:00:00Z'),room:'202'})!;
 for(const expected of ['Демо дисциплина','19.11.2026','20.11.2026','09:00','101 → 202','МСК']) assert.ok(text.includes(expected));
});
test('AI integration sends no credentials in the body, bounds output and rejects unsupported topics and provider failure',async()=>{
 const key=process.env.YANDEX_API_KEY,uri=process.env.YANDEX_MODEL_URI;
 process.env.YANDEX_API_KEY='test-only-key';process.env.YANDEX_MODEL_URI='gpt://demo/yandexgpt/latest';
 try {
  const fake:typeof fetch=async(url,init)=>{
   assert.equal(url,'https://ai.api.cloud.yandex.net/foundationModels/v1/completion');
   assert.equal(JSON.stringify(init?.body).includes('test-only-key'),false);
   assert.ok(String(init?.body).includes('system'));
   return new Response(JSON.stringify({result:{alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text:'Проверьте дисциплину и семестр.'}}]}}));
  };
  assert.equal(await prepareAiNote({type:'retake',purpose:'Тест'},fake),'Проверьте дисциплину и семестр.');
  await assert.rejects(prepareAiNote({type:'other',purpose:'Тест'},fake));
  await assert.rejects(prepareAiNote({type:'study',purpose:'Тест'},async()=>new Response('provider details',{status:500})),/Не удалось/);
  await assert.rejects(prepareAiNote({type:'study',purpose:'Тест'},async()=>new Response(JSON.stringify({result:{alternatives:[{message:{text:'Неполный ответ'}}]}}))));
 } finally {
  if(key===undefined)delete process.env.YANDEX_API_KEY;else process.env.YANDEX_API_KEY=key;
  if(uri===undefined)delete process.env.YANDEX_MODEL_URI;else process.env.YANDEX_MODEL_URI=uri;
 }
});
