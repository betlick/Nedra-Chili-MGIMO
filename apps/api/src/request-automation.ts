import {DomainError,type Db} from './domain.js';
import type {DocumentSnapshot} from './schema.js';
import {documentSnapshot,filledDocx,type DocumentInput} from './request-document.js';
import {AiDocumentError,prepareAiDocument,type AiDocumentDiagnostic} from './request-ai-document.js';

export const automationMessages:Record<string,string>={
  profile_incomplete:'Для автоматического заполнения не хватает подтверждённых учебных сведений. Заявка передана сотруднику.',
  facts_mismatch:'Ответ ИИ не совпал с учебными сведениями. Автоматическая выдача остановлена, заявку проверит сотрудник.',
  missing_fields:'ИИ обнаружил недостающие сведения. Заявка передана сотруднику.',
  invalid_answer:'Ответ ИИ не прошёл проверку формата. Заявка передана сотруднику.',
  provider_error:'Сервис ИИ не ответил корректно. Заявка сохранена и передана сотруднику.',
  document_error:'Не удалось подготовить файл автоматически. Заявка передана сотруднику.',
  data_changed:'Учебные сведения изменились во время обработки. Заявка передана сотруднику.',
};
export interface AutomationResult {reason:string|null;source:DocumentSnapshot|null;snapshot:DocumentSnapshot|null;docx:Buffer|null;pdf:Buffer|null}
export const staffFallback=(reason:string):AutomationResult=>({reason,source:null,snapshot:null,docx:null,pdf:null});
export async function prepareRequestAutomation(db:Db,row:DocumentInput,comment:string,render:(docx:Buffer)=>Promise<Buffer>,diagnose:(event:AiDocumentDiagnostic)=>void=()=>{}):Promise<AutomationResult>{
  let source:DocumentSnapshot;
  try{source=await db.transaction(tx=>documentSnapshot(tx,row))}
  catch(error){if(error instanceof DomainError&&error.statusCode===409)return staffFallback('profile_incomplete');throw error}
  let snapshot:DocumentSnapshot;
  try{snapshot=await prepareAiDocument(source,comment,fetch,diagnose)}
  catch(error){return staffFallback(error instanceof AiDocumentError?error.reason:'provider_error')}
  try{
    const docx=await filledDocx(snapshot),pdf=await render(docx);
    return {reason:null,source,snapshot,docx,pdf};
  }catch{return staffFallback('document_error')}
}
