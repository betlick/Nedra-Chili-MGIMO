import type {FastifyInstance} from 'fastify';
import {and,asc,eq,lt,or} from 'drizzle-orm';
import type {Db} from './domain.js';
import {DomainError} from './domain.js';
import {databaseErrorCode} from './db.js';
import {notifications,requests,users} from './schema.js';
import {requestSummaryColumns} from './request-summary.js';
import {documentSnapshot,sameSnapshot} from './request-document.js';
import {prepareRequestAutomation,staffFallback,automationMessages} from './request-automation.js';
import {requestNotice} from './smart-notices.js';
import {publishPush,type PushService,type PushNotice} from './push.js';

export function requestWorker(app:FastifyInstance,db:Db,push:PushService,render:(docx:Buffer)=>Promise<Buffer>){
  let running:Promise<void>|null=null,closed=false,requested=false,timer:ReturnType<typeof setInterval>|undefined;
  async function processOne(){
    const row=await db.transaction(async tx=>{
      const [candidate]=await tx.select(requestSummaryColumns).from(requests).where(and(
        eq(requests.status,'submitted'),eq(requests.processingMode,'ai'),
        or(eq(requests.automationReason,'queued'),and(eq(requests.automationReason,'processing'),lt(requests.updatedAt,new Date(Date.now()-120000)))),
      )).orderBy(asc(requests.createdAt)).limit(1).for('update',{skipLocked:true});
      if(!candidate)return null;
      const [claimed]=await tx.update(requests).set({automationReason:'processing',updatedAt:new Date()}).where(eq(requests.id,candidate.id)).returning(requestSummaryColumns);
      return claimed!;
    });
    if(!row)return false;
    const [ownerBefore]=await db.select({role:users.role}).from(users).where(eq(users.id,row.studentId));
    let automation=ownerBefore?.role!=='student'?staffFallback('data_changed'):await prepareRequestAutomation(db,row,row.comment,render,event=>app.log.warn({event:'request_ai_validation',...event},'AI document validation failed'));
    const pushed:PushNotice[]=[];
    await db.transaction(async tx=>{
      const [current]=await tx.select(requestSummaryColumns).from(requests).where(eq(requests.id,row.id)).for('update');
      // Staff actions, cancellation and another worker's lease always win.
      if(!current||current.status!=='submitted'||current.processingMode!=='ai'||current.automationReason!=='processing'||current.updatedAt.getTime()!==row.updatedAt.getTime())return;
      const [owner]=await tx.select({role:users.role}).from(users).where(eq(users.id,row.studentId)).for('share');
      if(owner?.role!=='student')automation=staffFallback('data_changed');
      if(automation.source&&automation.snapshot){
        try{if(!sameSnapshot(automation.source,await documentSnapshot(tx,current)))automation=staffFallback('data_changed')}
        catch(error){if(error instanceof DomainError&&[403,409].includes(error.statusCode))automation=staffFallback('data_changed');else throw error}
      }
      const prepared=!!automation.snapshot,automatic=prepared&&current.type==='study'&&current.delivery==='pdf',now=new Date();
      const [updated]=await tx.update(requests).set({
        aiNote:prepared?(automatic?'Справка заполнена с YandexGPT, реквизиты проверены сервером. Документ подготовлен автоматически.':current.type==='retake'?'YandexGPT подготовил заявление. Решение о допуске принимает сотрудник.':'YandexGPT заполнил бланк. Бумажную выдачу подготовит сотрудник.'):automationMessages[automation.reason??'provider_error'],
        aiPurpose:prepared&&current.type==='retake'?automation.snapshot!.fields!.PURPOSE:null,
        aiPreparedAt:prepared?now:null,automatedAt:automatic?now:null,
        automationReason:prepared?(automatic?null:current.type==='retake'?'approval_required':'paper_delivery'):automation.reason??'provider_error',
        status:automatic?'ready':'submitted',readyAt:automatic?now:null,updatedAt:now,
        draftId:prepared?crypto.randomUUID():null,draftSnapshot:automation.snapshot,
        documentBase64:automation.pdf?.toString('base64')??null,documentDocxBase64:automation.docx?.toString('base64')??null,
      }).where(eq(requests.id,row.id)).returning(requestSummaryColumns);
      if(automatic){const notice=requestNotice(updated!,'submitted','ready');pushed.push(...await tx.insert(notifications).values({studentId:row.studentId,requestId:row.id,...notice,body:notice.body+' Справка подготовлена автоматически после проверки реквизитов.'}).returning());}
    });
    publishPush(push,pushed,app.log);
    return true;
  }
  function wake(){
    if(closed)return;
    requested=true;
    if(running)return;
    requested=false;
    running=processOne().then(processed=>{if(processed)requested=true}).catch(error=>app.log.warn({code:databaseErrorCode(error?.cause??error)},'Background request processing failed')).finally(()=>{running=null;if(requested&&!closed)wake()});
  }
  app.addHook('onReady',async()=>{timer=setInterval(wake,5000);timer.unref();wake()});
  app.addHook('onClose',async()=>{closed=true;clearInterval(timer);await running});
  return {wake:()=>{setImmediate(wake)},waitForIdle:async()=>{await new Promise<void>(resolve=>setImmediate(resolve));while(running)await running}};
}
