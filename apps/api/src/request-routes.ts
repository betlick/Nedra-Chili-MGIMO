import { requestNotice } from './smart-notices.js';
import { AI_REQUEST_TYPES, aiConfigured } from './request-ai.js';
import { REQUEST_TYPE_IDS } from './request-types.js';
import { randomUUID } from 'node:crypto';
import { bodyObject, DomainError, fail, uuid, type DbSession } from './domain.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import type { connectDatabase } from './db.js';
import { requestPdf } from './request-pdf.js';
import { notifications, requests, users, groups, teachingAssignments } from './schema.js';
import { publishPush, type PushNotice, type PushService } from './push.js';
import { typeChangeNotice } from './request-notice.js';
import { documentData } from './document-data.js';
import { documentSnapshot, filledDocx, isTemplateType, originalTemplate, sameSnapshot } from './request-document.js';
import { converterDiagnostics } from './document-converter.js';
import { requestTemplatePdf } from './request-template-pdf.js';
import {automationMessages,prepareRequestAutomation,staffFallback} from './request-automation.js';

type Input = { type: string; purpose: string; comment?: string; delivery: string; processingMode?: 'staff' | 'ai'; assignmentId?: string };
export function requestRoutes(app: FastifyInstance, db: ReturnType<typeof connectDatabase>['db'], student: (req: FastifyRequest, reply: FastifyReply) => Promise<string | null>, staff: (req: FastifyRequest, reply: FastifyReply) => Promise<string | null>, push: PushService, convertDocument = requestTemplatePdf) {
  const aiWindows = new Map<string, {start:number; count:number}>();
  const publicRow = ({ documentBase64, documentDocxBase64, draftSnapshot, ...row }: typeof requests.$inferSelect) => ({ ...row, docxAvailable: Boolean(documentDocxBase64) && ['ready','issued'].includes(row.status), preparedAvailable: Boolean(row.aiPreparedAt && documentDocxBase64 && documentBase64 && row.type==='retake' && row.delivery==='pdf' && ['submitted','in_progress'].includes(row.status)) });
  const snapshot = documentSnapshot;
  async function checkAssignment(tx: DbSession, studentId: string, assignmentId: string) {
    const [u] = await tx.select({ groupId: users.groupId }).from(users).where(eq(users.id, studentId)).for('share');
    const [a] = await tx.select({ groupId: teachingAssignments.groupId }).from(teachingAssignments).where(eq(teachingAssignments.id, assignmentId)).for('share');
    if (!a || !u?.groupId || a.groupId !== u.groupId) fail(403, 'Нет доступа к дисциплине этой группы');
  }
  const failure = (code: string, message: string) => ({ error: { code, message } });
  app.get('/api/staff/documents/converter', async (req, reply) => {
    if (!await staff(req, reply)) return;
    return { data: await converterDiagnostics() };
  });
  app.get('/api/requests/document-data', async (req, reply) => {
    const id = await student(req, reply); if (!id) return;
    return { data: await documentData(db, id) };
  });
  app.get<{ Params: { id: string } }>('/api/staff/requests/:id/document-data', async (req, reply) => {
    if (!await staff(req, reply)) return;
    const requestId = uuid(req.params.id);
    const [row] = await db.select({ studentId: requests.studentId }).from(requests).where(eq(requests.id, requestId));
    if (!row) fail(404, 'Заявка не найдена');
    return { data: await documentData(db, row.studentId) };
  });
  for (const isStaff of [false, true]) {
    app.get<{Params:{type:string}}>(isStaff ? '/api/staff/requests/templates/:type' : '/api/requests/templates/:type', async (req, reply) => {
      if (!await (isStaff ? staff : student)(req, reply)) return;
      const buffer = await originalTemplate(req.params.type);
      return reply.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('X-Content-Type-Options','nosniff').header('Content-Disposition', `attachment; filename="template-${req.params.type}.docx"`).send(buffer);
    });
  }
  app.get('/api/requests/options' , async (req, reply) => {
    if (!await student(req, reply)) return;
    return {data:{aiEnabled:aiConfigured(),aiTypes:AI_REQUEST_TYPES}};
  });
  app.get('/api/requests', async (req, reply) => {
    const id = await student(req, reply); if (!id) return;
    return { data: (await db.select().from(requests).where(eq(requests.studentId, id)).orderBy(desc(requests.createdAt), desc(requests.id))).map(publicRow) };
  });
  app.post<{ Body: Input }>('/api/requests', {
    schema: { body: { type: 'object', required: ['type', 'purpose', 'delivery'], additionalProperties: false, properties: {
      type: { type: 'string', enum: REQUEST_TYPE_IDS },
      purpose: { type: 'string', minLength: 1, maxLength: 500 },
      comment: { type: 'string', maxLength: 2000 },
      delivery: { type: 'string', enum: ['pdf', 'office'] },
      processingMode: {type:'string',enum:['staff','ai']},
      assignmentId: {type:'string',format:'uuid'},
    } } },
  }, async (req, reply) => {
    const id = await student(req, reply); if (!id) return;
    if (!req.body.purpose.trim()) return reply.code(400).send(failure('BAD_REQUEST', 'Укажите цель заявки'));
    if (req.body.type === 'retake') {
      if (!req.body.assignmentId) fail(400, 'Выберите дисциплину для пересдачи');
      await db.transaction(tx => checkAssignment(tx, id, req.body.assignmentId!));
    } else if (req.body.assignmentId) fail(400, 'Дисциплина выбирается только для пересдачи');
    const pushed: PushNotice[] = [];
    const mode = req.body.processingMode ?? 'staff';
    if (mode === 'ai') {
      if (!AI_REQUEST_TYPES.includes(req.body.type as 'study'|'retake')) fail(400,'Эту тему обрабатывает сотрудник');
      if (!aiConfigured()) fail(503,'YandexGPT пока не настроен. Выберите сотрудника');
      const now=Date.now();
      for (const [key, value] of aiWindows) if(now-value.start>=60000) aiWindows.delete(key);
      const window=aiWindows.get(id)??{start:now,count:0};
      if(window.count>=5) fail(429,'Не более пяти ИИ-заявок в минуту');
      window.count++; aiWindows.set(id,window);
    }
    const createdAt=new Date(),requestId=randomUUID();
    const sourceRow={studentId:id,type:req.body.type,assignmentId:req.body.assignmentId??null,purpose:req.body.purpose.trim(),createdAt,aiPurpose:null};
    let automation=mode==='ai'?await prepareRequestAutomation(db,sourceRow,req.body.comment?.trim()??'',convertDocument):null;
    if(mode==='ai'&&!await student(req,reply))return;
    const result = await db.transaction(async tx => {
      if (req.body.type === 'retake') {
        try{await checkAssignment(tx,id,req.body.assignmentId!)}catch(error){
          if(mode==='ai'&&error instanceof DomainError&&error.statusCode===403){automation=staffFallback('data_changed');sourceRow.assignmentId=null;}else throw error;
        }
      }
      if(automation?.snapshot&&automation.source){
        try{if(!sameSnapshot(automation.source,await snapshot(tx,sourceRow)))automation=staffFallback('data_changed')}
        catch(error){if(error instanceof DomainError&&error.statusCode===409)automation=staffFallback('data_changed');else throw error}
      }
      const prepared=!!automation?.snapshot,automatic=prepared&&req.body.type==='study'&&req.body.delivery==='pdf';
      const now=new Date();
      const [row] = await tx.insert(requests).values({id:requestId,...sourceRow,processingMode:mode,
        comment:req.body.comment?.trim()??'',delivery:req.body.delivery,
        aiNote:mode==='ai'?(prepared?(automatic?'Справка заполнена с YandexGPT, реквизиты проверены сервером. Документ подготовлен автоматически.':req.body.type==='retake'?'YandexGPT подготовил заявление. Решение о допуске принимает сотрудник.':'YandexGPT заполнил бланк. Бумажную выдачу подготовит сотрудник.'):automationMessages[automation?.reason??'provider_error']):null,
        aiPurpose:prepared&&req.body.type==='retake'?automation!.snapshot!.fields!.PURPOSE:null,
        aiPreparedAt:prepared?now:null,automatedAt:automatic?now:null,
        automationReason:mode==='ai'?(prepared?(automatic?null:req.body.type==='retake'?'approval_required':'paper_delivery'):automation?.reason??'provider_error'):null,
        status:automatic?'ready':'submitted',readyAt:automatic?now:null,
        draftId:prepared?randomUUID():null,draftSnapshot:automation?.snapshot??null,
        documentBase64:automation?.pdf?.toString('base64')??null,documentDocxBase64:automation?.docx?.toString('base64')??null,
      }).returning();
      pushed.push(...await tx.insert(notifications).values({studentId:id,requestId:row!.id,...requestNotice(row!,null,'submitted')}).returning());
      if(automatic){
        const notice=requestNotice(row!,'submitted','ready');
        pushed.push(...await tx.insert(notifications).values({studentId:id,requestId:row!.id,...notice,body:notice.body+' Справка подготовлена автоматически после проверки реквизитов.'}).returning());
      }
      return row;
    });
    publishPush(push, pushed, app.log);
    return reply.code(201).send({ data: publicRow(result!) });
  });
  app.patch<{ Params: { id: string } }>('/api/requests/:id/cancel', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } },
  }, async (req, reply) => {
    const id = await student(req, reply); if (!id) return;
    const pushed: PushNotice[] = [];
    const updated = await db.transaction(async tx => {
      const [row] = await tx.select().from(requests).where(eq(requests.id, req.params.id)).for('update');
      if (!row) fail(404,'Заявка не найдена');
      if (row.studentId !== id) fail(403,'Нет доступа к заявке');
      if (row.status === 'cancelled') return row;
      if (!['submitted','in_progress'].includes(row.status)) fail(409,'Эту заявку уже нельзя отменить');
      const [result] = await tx.update(requests).set({status:'cancelled',updatedAt:new Date()}).where(eq(requests.id,row.id)).returning();
      pushed.push(...await tx.insert(notifications).values({studentId:id,requestId:row.id,...requestNotice(row,row.status,'cancelled')}).returning());
      return result!;
    });
    publishPush(push,pushed,app.log);
    return { data: publicRow(updated) };
  });
  app.get('/api/staff/requests', async (req, reply) => {
    if (!await staff(req, reply)) return;
    const rows = await db.select({ request: requests, fullName: users.fullName, groupName: groups.name, faculty:users.faculty, program:groups.program, year:groups.year }).from(requests)
      .innerJoin(users, eq(users.id, requests.studentId)).leftJoin(groups, eq(groups.id, users.groupId)).orderBy(desc(requests.createdAt));
    return { data: rows.map(row => ({ ...publicRow(row.request), fullName: row.fullName, groupName: row.groupName, faculty:row.faculty, program:row.program, year:row.year })) };
  });
  app.patch<{ Params: { id: string }; Body: { status: string; reason?: string; draftId?: string } }>('/api/staff/requests/:id/status', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { type: 'string', enum: ['in_progress', 'ready', 'issued', 'rejected'] }, reason: { type:'string', minLength:1,maxLength:1000 }, draftId:{type:'string',format:'uuid'} } },
    },
  }, async (req, reply) => {
    const staffId = await staff(req, reply); if (!staffId) return;
    const pushed: PushNotice[] = [];
    const result = await db.transaction(async tx => {
      const [row] = await tx.select().from(requests).where(eq(requests.id, req.params.id)).for('update');
      if (!row) return { code: 404, data: null };
      if (row.status === req.body.status) return { code: 200, data: publicRow(row) };
      const allowed: Record<string, string[]> = { submitted: ['in_progress', 'ready', 'rejected'], in_progress: ['ready', 'rejected'], ready: ['issued'] };
      if (!allowed[row.status]?.includes(req.body.status)) return { code: 409, data: null };
      if (req.body.status === 'rejected' && !req.body.reason?.trim()) fail(400,'Укажите причину отказа');
      if (isTemplateType(row.type) && req.body.status === 'ready') {
        if (!row.documentBase64 || !row.documentDocxBase64) fail(409,'Подготовьте и просмотрите новый документ');
        if (row.status !== 'in_progress' || !row.verifiedAt || !row.verifiedBy || !row.draftSnapshot || !row.previewedAt || req.body.draftId !== row.draftId) fail(409,'Нужны проверка сведений и просмотр актуального черновика');
        const current = await snapshot(tx,row);
        if (!sameSnapshot(row.draftSnapshot, current)) fail(409,'Сведения изменились. Подготовьте и просмотрите новый черновик');
      }
      let documentBase64 = row.documentBase64;
      const readyAt = req.body.status === 'ready' ? new Date() : row.readyAt;
      if (req.body.status === 'ready' && !isTemplateType(row.type)) {
        const [student] = await tx.select({ fullName: users.fullName, groupName: groups.name }).from(users).leftJoin(groups, eq(groups.id, users.groupId)).where(eq(users.id, row.studentId));
        documentBase64 = (await requestPdf({ ...row, ...student!, ...(row.type==='study'?row.draftSnapshot:{}), readyAt: readyAt! })).toString('base64');
      }
      const [updated] = await tx.update(requests).set({ status: req.body.status, processedBy: staffId, updatedAt: new Date(), readyAt, documentBase64, ...(req.body.status==='rejected'?{rejectionReason:req.body.reason!.trim()}: {}) }).where(eq(requests.id, row.id)).returning();
      pushed.push(...await tx.insert(notifications).values({ studentId: row.studentId, requestId: row.id, ...requestNotice(row, row.status, req.body.status, req.body.status === 'rejected' ? req.body.reason?.trim() : undefined) }).returning());
      return { code: 200, data: publicRow(updated!) };
    });
    publishPush(push, pushed, app.log);
    if (!result.data) return reply.code(result.code).send(failure(result.code === 404 ? 'NOT_FOUND' : 'CONFLICT', result.code === 404 ? 'Заявка не найдена' : 'Этот переход статуса недоступен'));
    return { data: result.data };
  });

  // Смена вида заявки сотрудником (например, «Иное обращение» → «Продление сессии»).
  app.patch<{ Params: { id: string }; Body: { type: string } }>('/api/staff/requests/:id/type', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['type'], additionalProperties: false, properties: { type: { type: 'string', enum: REQUEST_TYPE_IDS } } },
    },
  }, async (req, reply) => {
    const staffId = await staff(req, reply); if (!staffId) return;
    const pushed: PushNotice[] = [];
    const row = await db.transaction(async tx => {
      const [r] = await tx.select().from(requests).where(eq(requests.id, req.params.id)).for('update');
      if (!r) fail(404, 'Заявка не найдена');
      if (!['submitted', 'in_progress'].includes(r.status)) fail(409, 'Вид можно изменить только у принятой заявки или заявки в работе');
      if (r.type === req.body.type) return r;
      // Черновик справки готовился под прежний вид — сбрасываем его, проверку нужно пройти заново.
      const [updated] = await tx.update(requests).set({ type: req.body.type, previousType: r.type, typeChangedBy: staffId, typeChangedAt: new Date(), updatedAt: new Date(),
        aiPurpose:null, aiPreparedAt:null, automatedAt:null, automationReason:null, assignmentId: null, documentBase64: null, documentDocxBase64: null, draftId: null, draftSnapshot: null, verifiedAt: null, verifiedBy: null, previewedAt: null }).where(eq(requests.id, r.id)).returning();
      pushed.push(...await tx.insert(notifications).values({ studentId: r.studentId, kind: 'request', requestId: r.id, ...typeChangeNotice(updated!, r.type) }).returning());
      return updated!;
    });
    publishPush(push, pushed, app.log);
    return { data: publicRow(row) };
  });
  app.patch<{Params:{id:string}}>('/api/staff/requests/:id/assignment', async (req, reply) => {
    const staffId = await staff(req, reply); if (!staffId) return;
    const assignmentId = uuid(bodyObject(req.body).assignmentId);
    const row = await db.transaction(async tx => {
      const [r] = await tx.select().from(requests).where(eq(requests.id, uuid(req.params.id))).for('update');
      if (!r) fail(404, 'Заявка не найдена');
      if (r.type !== 'retake' || !['submitted','in_progress'].includes(r.status)) fail(409, 'Нельзя изменить дисциплину этой заявки');
      await checkAssignment(tx, r.studentId, assignmentId);
      if (r.assignmentId === assignmentId) return r;
      const [updated] = await tx.update(requests).set({assignmentId, processedBy: staffId, draftId: null, draftSnapshot: null,
        documentBase64: null, documentDocxBase64: null, verifiedAt: null, verifiedBy: null, previewedAt: null, updatedAt: new Date()})
        .where(eq(requests.id,r.id)).returning();
      return updated!;
    });
    return {data:publicRow(row)};
  });
  app.post<{Params:{id:string}}>('/api/staff/requests/:id/prepare', async(req,reply)=>{
    const staffId=await staff(req,reply);if(!staffId)return;
    if(bodyObject(req.body).verified!==true)fail(400,'Подтвердите проверку сведений');
    const row=await db.transaction(async tx=>{
      const [r]=await tx.select().from(requests).where(eq(requests.id,uuid(req.params.id))).for('update');
      if(!r)fail(404,'Заявка не найдена');if(!isTemplateType(r.type)||r.status!=='in_progress')fail(409,'Заявка должна быть в работе');
      const draftSnapshot=await snapshot(tx,r);
      const [updated]=await tx.update(requests).set({draftSnapshot,draftId:randomUUID(),verifiedBy:staffId,verifiedAt:new Date(),
        documentBase64:null,documentDocxBase64:null,previewedAt:null,updatedAt:new Date()}).where(eq(requests.id,r.id)).returning();return updated;
    });return {data:publicRow(row!)};
  });
  app.post<{Params:{id:string}}>('/api/staff/requests/:id/preview', async(req,reply)=>{
    if(!await staff(req,reply))return;
    const draftId=uuid(bodyObject(req.body).draftId), requestId=uuid(req.params.id);
    const readDraft = async(tx:DbSession) => {
      const [r]=await tx.select().from(requests).where(eq(requests.id,requestId)).for('update');
      if(!r)fail(404,'Заявка не найдена');
      if(!isTemplateType(r.type)||r.status!=='in_progress'||r.draftId!==draftId||!r.draftSnapshot)fail(409,'Черновик недоступен');
      if(!sameSnapshot(r.draftSnapshot,await snapshot(tx,r)))fail(409,'Сведения изменились. Подготовьте новый черновик');
      return r;
    };
    const row=await db.transaction(readDraft);
    const docx=row.documentDocxBase64?Buffer.from(row.documentDocxBase64,'base64'):await filledDocx(row.draftSnapshot!);
    // Slow conversion must never hold a database transaction or source-row locks.
    const pdf=row.documentBase64?Buffer.from(row.documentBase64,'base64'):await convertDocument(docx);
    await db.transaction(async tx=>{
      await readDraft(tx);
      await tx.update(requests).set({documentBase64:pdf.toString('base64'),documentDocxBase64:docx.toString('base64'),previewedAt:new Date()}).where(eq(requests.id,requestId));
    });
    return reply.type('application/pdf').header('X-Content-Type-Options','nosniff').header('Content-Disposition','attachment; filename="preview.pdf"').send(pdf);
  });
  for(const format of ['pdf','docx'] as const){
    app.get<{Params:{id:string}}>(`/api/requests/:id/prepared/${format}`,async(req,reply)=>{
      const id=await student(req,reply);if(!id)return;
      const file=await db.transaction(async tx=>{
        const [row]=await tx.select().from(requests).where(eq(requests.id,uuid(req.params.id))).for('share');
        if(!row)fail(404,'Заявка не найдена');if(row.studentId!==id)fail(403,'Нет доступа к заявке');
        if(row.type!=='retake'||row.processingMode!=='ai'||!row.aiPreparedAt||row.delivery!=='pdf'||!['submitted','in_progress'].includes(row.status)||!row.draftSnapshot)fail(409,'Подготовленное заявление недоступно');
        if(!sameSnapshot(row.draftSnapshot,await snapshot(tx,row)))fail(409,'Сведения изменились. Заявление должен проверить сотрудник');
        const data=format==='pdf'?row.documentBase64:row.documentDocxBase64;
        if(!data)fail(409,'Файл пока не подготовлен');return Buffer.from(data,'base64');
      });
      return reply.type(format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('X-Content-Type-Options','nosniff').header('Content-Disposition',`attachment; filename="application-awaiting-decision.${format}"`).send(file);
    });
  }
  for (const isStaff of [false, true]) {
    app.get<{Params:{id:string}}>(isStaff ? '/api/staff/requests/:id/docx' : '/api/requests/:id/docx', async(req,reply)=>{
      const id=await (isStaff?staff:student)(req,reply);if(!id)return;
      const [row]=await db.select().from(requests).where(eq(requests.id,uuid(req.params.id)));
      if(!row)fail(404,'Заявка не найдена');
      if(!isStaff&&row.studentId!==id)fail(403,'Нет доступа к заявке');
      if(!['ready','issued'].includes(row.status)||!row.documentDocxBase64||(!isStaff&&row.delivery!=='pdf'))fail(409,'Документ пока недоступен для скачивания');
      return reply.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('X-Content-Type-Options','nosniff').header('Content-Disposition',`attachment; filename="request-${row.id}.docx"`).send(Buffer.from(row.documentDocxBase64,'base64'));
    });
  }
  for (const isStaff of [false, true]) {
    app.get<{ Params: { id: string } }>(isStaff ? '/api/staff/requests/:id/pdf' : '/api/requests/:id/pdf', {
      schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } },
    }, async (req, reply) => {
      const id = await (isStaff ? staff : student)(req, reply); if (!id) return;
      const [row] = await db.select().from(requests).where(eq(requests.id, req.params.id));
      if (!row) return reply.code(404).send(failure('NOT_FOUND', 'Заявка не найдена'));
      if (!isStaff && row.studentId !== id) return reply.code(403).send(failure('FORBIDDEN', 'Нет доступа к заявке'));
      if (!['ready', 'issued'].includes(row.status) || !row.documentBase64 || (!isStaff && row.delivery !== 'pdf')) return reply.code(409).send(failure('CONFLICT', 'Документ пока недоступен для скачивания'));
      return reply.type('application/pdf').header('Content-Disposition', `attachment; filename="request-${row.id}.pdf"`).header('X-Content-Type-Options', 'nosniff').send(Buffer.from(row.documentBase64, 'base64'));
    });
  }

}
