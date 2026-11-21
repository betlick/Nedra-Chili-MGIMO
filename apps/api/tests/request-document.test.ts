import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {hash} from 'argon2';
import {eq,inArray} from 'drizzle-orm';
import {unzipSync,strFromU8} from 'fflate';
import {buildApp} from '../src/app.js';
import {connectDatabase} from '../src/db.js';
import {docxToPdf} from '../src/document-converter.js';
import {fail} from '../src/domain.js';
import {groups,users,subjects,teachingAssignments,studentDocumentProfiles,requests,notifications} from '../src/schema.js';

// Real conversion for the happy path; a gate allows deterministic cancellation during conversion.
test('original document workflow: two students, own assignments, stale facts, immutable files and cancellation outside conversion',async()=>{
  const c=connectDatabase(), suffix=randomUUID(), groupIds=[randomUUID(),randomUUID()], ids=Array.from({length:4},()=>randomUUID()), assignmentIds=[randomUUID(),randomUUID()], subjectId=randomUUID();
  const origin='http://localhost:5173',csrf={'x-csrf-protection':'1',origin},cookies:string[]=[];
  const password=randomBytes(24).toString('hex'),passwordHash=await hash(password);
  let conversionMode:'real'|'failure'|'gate'='real',entered=()=>{},release=()=>{};
  let gated:Promise<Buffer>|undefined;
  const app=buildApp({logger:false,secureCookies:false,origin,convertDocument:async docx=>{
    if(conversionMode==='failure')fail(503,'Тестовый конвертер недоступен');
    if(conversionMode==='gate'){entered();return gated!}
    return docxToPdf(docx);
  }});
  const call=(i:number,method:'GET'|'POST'|'PATCH',url:string,payload?:object)=>app.inject({method,url,headers:{...csrf,cookie:cookies[i]!},payload});
  const create=(i:number,assignmentId=assignmentIds[i])=>call(i,'POST','/api/requests',{type:'retake',purpose:'Ликвидация задолженности <демо> & проверка',delivery:'pdf',assignmentId});
  const status=(id:string,value:string,draftId?:string)=>call(3,'PATCH',`/api/staff/requests/${id}/status`,{status:value,...(draftId?{draftId}:{})});
  const prepare=async(id:string)=>{assert.equal((await status(id,'in_progress')).statusCode,200);const r=await call(3,'POST',`/api/staff/requests/${id}/prepare`,{verified:true});assert.equal(r.statusCode,200,r.body);return r.json().data.draftId as string};
  const preview=(id:string,draftId:string)=>call(3,'POST',`/api/staff/requests/${id}/preview`,{draftId});
  try{
    await c.db.insert(groups).values(groupIds.map((id,i)=>({id,name:`DOC-${suffix}-${i}`,faculty:'Демо',program:'Демо',year:i+1})));
    await c.db.insert(users).values(ids.map((id,i)=>({id,email:`doc-${suffix}-${i}@example.test`,fullName:`Вымышленный ${i}`,faculty:'Демо',role:i<2?'student':i===2?'teacher':'staff',groupId:i<2?groupIds[i]:null,passwordHash})));
    await c.db.insert(studentDocumentProfiles).values(ids.slice(0,2).map((studentId,i)=>({studentId,birthDate:'2007-02-14',studyForm:'Очная',fundingBasis:'Бюджетная (демо)',enrollmentDate:i?'2025-08-25':'2026-08-25',enrollmentOrder:`ДЕМО-${i}`,expectedGraduationDate:i?'2029-06-30':'2030-06-30',phone:`+7 (000) 000-00-0${i}`,enrollmentStatus:'active'})));
    await c.db.insert(subjects).values({id:subjectId,name:'Тестовая дисциплина <демо>'});
    await c.db.insert(teachingAssignments).values(assignmentIds.map((id,i)=>({id,subjectId,groupId:groupIds[i]!,teacherId:ids[2]!,semester:i?3:1,form:'Экзамен'})));
    for(let i=0;i<4;i++){
      const r=await app.inject({method:'POST',url:'/api/auth/login',headers:csrf,payload:{email:`doc-${suffix}-${i}@example.test`,password}});
      assert.equal(r.statusCode,200);cookies.push(String(r.headers['set-cookie']).split(';')[0]!);
    }
    assert.equal((await app.inject({method:'GET',url:'/api/requests/templates/study'})).statusCode,401);
    assert.equal((await call(2,'GET','/api/requests/templates/study')).statusCode,403);
    assert.equal((await call(0,'GET','/api/requests/templates/study')).rawPayload.subarray(0,2).toString(),'PK');
    assert.equal((await call(3,'GET','/api/staff/requests/templates/retake')).statusCode,200);
    assert.equal((await call(0,'GET','/api/requests/templates/other')).statusCode,404);
    assert.equal((await call(0,'POST','/api/requests',{type:'retake',purpose:'Демо',delivery:'pdf'})).statusCode,400);
    assert.equal((await create(0,assignmentIds[1])).statusCode,403);
    const a=(await create(0)).json().data,b=(await create(1)).json().data;
    assert.ok(a.id&&b.id);
    assert.equal((await status(a.id,'ready')).statusCode,409);
    assert.equal((await call(0,'GET',`/api/requests/${a.id}/docx`)).statusCode,409);
    assert.equal((await call(1,'GET',`/api/requests/${a.id}/docx`)).statusCode,403);
    assert.equal((await call(2,'GET',`/api/staff/requests/${a.id}/docx`)).statusCode,403);
    assert.equal((await call(0,'PATCH',`/api/staff/requests/${a.id}/assignment`,{assignmentId:assignmentIds[0]})).statusCode,403);
    assert.equal((await call(3,'PATCH',`/api/staff/requests/${a.id}/assignment`,{assignmentId:assignmentIds[1]})).statusCode,403);
    let draft=await prepare(a.id);
    conversionMode='failure';assert.equal((await preview(a.id,draft)).statusCode,503);
    assert.equal((await status(a.id,'ready',draft)).statusCode,409);
    conversionMode='real';assert.equal((await preview(a.id,draft)).statusCode,200);
    await c.db.update(users).set({fullName:'Изменённый демопреподаватель'}).where(eq(users.id,ids[2]!));
    assert.equal((await status(a.id,'ready',draft)).statusCode,409);
    assert.equal((await preview(a.id,draft)).statusCode,409);
    draft=await prepare(a.id);
    const checked=await preview(a.id,draft);assert.equal(checked.statusCode,200);
    assert.equal((await status(a.id,'ready',draft)).statusCode,200);
    const docx=await call(0,'GET',`/api/requests/${a.id}/docx`);
    assert.equal(docx.statusCode,200);
    const xml=strFromU8(unzipSync(docx.rawPayload)['word/document.xml']!);
    for(const text of ['Вымышленный 0','Изменённый демопреподаватель','2026/2027','&lt;демо&gt;','&amp;'])assert.ok(xml.includes(text),text);
    assert.ok(!xml.includes('Вымышленный 1'));
    const pdf=await call(0,'GET',`/api/requests/${a.id}/pdf`);assert.deepEqual(pdf.rawPayload,checked.rawPayload);
    await c.db.update(studentDocumentProfiles).set({birthDate:'2007-02-15'}).where(eq(studentDocumentProfiles.studentId,ids[0]!));
    assert.equal((await status(a.id,'issued')).statusCode,200);
    assert.deepEqual((await call(0,'GET',`/api/requests/${a.id}/docx`)).rawPayload,docx.rawPayload);
    assert.deepEqual((await call(0,'GET',`/api/requests/${a.id}/pdf`)).rawPayload,pdf.rawPayload);
    assert.equal((await call(0,'GET',`/api/requests/${b.id}/docx`)).statusCode,403);
    const publicRows=(await call(0,'GET','/api/requests')).json().data;
    assert.equal(publicRows.find((r:{id:string})=>r.id===a.id).docxAvailable,true);
    assert.ok(!('documentDocxBase64' in publicRows[0]));assert.ok(!('draftSnapshot' in publicRows[0]));
    // Conversion waits here, while cancellation must still commit promptly.
    const draftB=await prepare(b.id);
    const started=new Promise<void>(resolve=>{entered=resolve});
    gated=new Promise<Buffer>(resolve=>{release=()=>resolve(Buffer.from('%PDF-gated-test'))});
    conversionMode='gate';const pending=preview(b.id,draftB);
    await started;
    try{
      const cancelled=await Promise.race([call(1,'PATCH',`/api/requests/${b.id}/cancel`),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('Conversion held a database lock')),2000))]);
      assert.equal(cancelled.statusCode,200);
    }finally{release()}
    assert.equal((await pending).statusCode,409);
    assert.equal((await call(1,'GET',`/api/requests/${b.id}/pdf`)).statusCode,409);
    const previousFetch=globalThis.fetch,previousKey=process.env.YANDEX_API_KEY,previousUri=process.env.YANDEX_MODEL_URI;
    process.env.YANDEX_API_KEY='test-only';process.env.YANDEX_MODEL_URI='gpt://demo/yandexgpt-5.1';
    globalThis.fetch=async(_url,init)=>{const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].text);input.trustedFields.PURPOSE='Прошу пересдачу для ликвидации задолженности';return new Response(JSON.stringify({result:{alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text:JSON.stringify({fields:input.trustedFields,missing:[]})}}]}}))};
    try{
      const preparedApplication=await call(0,'POST','/api/requests',{type:'retake',purpose:'Ликвидация задолженности',delivery:'pdf',processingMode:'ai',assignmentId:assignmentIds[0]});
      assert.equal(preparedApplication.statusCode,201);
      const application=preparedApplication.json().data;assert.equal(application.status,'submitted');assert.ok(application.aiPreparedAt);assert.equal(application.automatedAt,null);assert.equal(application.automationReason,'approval_required');
      assert.equal((await call(0,'GET',`/api/requests/${application.id}/prepared/pdf`)).statusCode,200);
      assert.equal((await call(1,'GET',`/api/requests/${application.id}/prepared/docx`)).statusCode,403);
      assert.equal((await status(application.id,'ready',application.draftId)).statusCode,409);
      globalThis.fetch=async(_url,init)=>{const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].text);input.trustedFields.FULL_NAME='Подменённое имя';return new Response(JSON.stringify({result:{alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text:JSON.stringify({fields:input.trustedFields,missing:[]})}}]}}))};
      const bad=await call(0,'POST','/api/requests',{type:'study',purpose:'по месту требования',delivery:'pdf',processingMode:'ai'});
      assert.equal(bad.statusCode,201);assert.equal(bad.json().data.status,'submitted');assert.equal(bad.json().data.automationReason,'facts_mismatch');assert.equal(bad.json().data.docxAvailable,false);
    }finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.YANDEX_API_KEY;else process.env.YANDEX_API_KEY=previousKey;if(previousUri===undefined)delete process.env.YANDEX_MODEL_URI;else process.env.YANDEX_MODEL_URI=previousUri}
    // Profile changes invalidate preview even when the request row did not change.
    conversionMode='real';const changed=(await create(1)).json().data;const d=await prepare(changed.id);
    await c.db.update(studentDocumentProfiles).set({enrollmentStatus:'suspended'}).where(eq(studentDocumentProfiles.studentId,ids[1]!));
    assert.equal((await preview(changed.id,d)).statusCode,409);
    assert.equal((await call(3,'POST',`/api/staff/requests/${changed.id}/prepare`,{verified:true})).statusCode,409);
  }finally{
    release();await app.close();
    await c.db.delete(notifications).where(inArray(notifications.studentId,ids));
    await c.db.delete(requests).where(inArray(requests.studentId,ids));
    await c.db.delete(teachingAssignments).where(inArray(teachingAssignments.id,assignmentIds));
    await c.db.delete(users).where(inArray(users.id,ids));
    await c.db.delete(subjects).where(eq(subjects.id,subjectId));
    await c.db.delete(groups).where(inArray(groups.id,groupIds));
    await c.close();
  }
});
