import { useEffect, useState } from 'react';
import { downloadFile, staffApi, type ApiStaffRequest, type ApiDocumentData } from '../../lib/api';
import { Button } from '../../components/ui';

export function DocumentActions({ row, reload }: { row: ApiStaffRequest; reload: () => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false), [verified, setVerified] = useState(false);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiDocumentData | null>(null);
  const [assignmentId, setAssignmentId] = useState(row.assignmentId ?? '');
  const templated = row.type === 'study' || row.type === 'retake';
  useEffect(() => {
    let live = true;
    setData(null); setVerified(false); setAssignmentId(row.assignmentId ?? '');
    if (templated) staffApi.documentData(row.id).then(value => { if (live) setData(value) }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Не удалось загрузить сведения') });
    return () => { live = false };
  }, [row.id, row.type, row.assignmentId, row.draftId, templated]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие') }
    finally { setBusy(false) }
  };
  if (!['submitted', 'in_progress'].includes(row.status)) return row.rejectionReason ? <p>Причина отказа: {row.rejectionReason}</p> : null;
  const selected = data?.assignments.find(a => a.id === row.assignmentId);
  const canVerify = !!data && data.missing.length === 0 && data.profile?.enrollmentStatus === 'active' && (row.type !== 'retake' || !!selected);
  return <div className="stack">
    {row.processingMode === 'ai' && <details open><summary>{row.aiPreparedAt ? 'Бланк подготовлен с YandexGPT' : 'Автоматическая обработка — требуется сотрудник'}</summary><p className="small" style={{whiteSpace:'pre-wrap'}}>{row.aiNote}</p></details>}
    {row.aiPurpose && row.aiPurpose !== row.purpose && <p className="small">Формулировка ИИ: {row.aiPurpose}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {row.type !== 'other' && <Button variant="ghost" disabled={busy} onClick={() => void run(() => downloadFile(`/api/staff/requests/templates/${row.type}`, `template-${row.type}.docx`))}>Скачать исходный бланк DOCX</Button>}
    {templated && <>
      {!data ? <p className="small muted">Загрузка учебных сведений…</p> : <details open>
        <summary>Сведения для заполнения бланка</summary>
        <p className="small">{data.student.fullName} · {data.student.faculty} · {data.student.program} · курс {data.student.year} · {data.student.groupName}</p>
        {data.profile && <div className="small">
          <p>Дата рождения: {data.profile.birthDate}. Форма: {data.profile.studyForm}. Основа: {data.profile.fundingBasis}.</p>
          <p>Приказ: {data.profile.enrollmentOrder} от {data.profile.enrollmentDate}. Окончание: {data.profile.expectedGraduationDate}.</p>
          <p>Телефон: {data.profile.phone}. Статус обучения: {data.profile.enrollmentStatus === 'active' ? 'Обучается' : 'Требует уточнения'}.</p>
          {data.profile.source === 'demo' && <p className="muted">Вымышленные демонстрационные сведения.</p>}
        </div>}
        {data.missing.length > 0 && <p className="form-error">Учебные сведения неполные. Дополните профиль перед подготовкой документа.</p>}
      </details>}
      {row.type === 'retake' && <>
        <label className="field">Дисциплина для пересдачи
          <select className="input" value={assignmentId} onChange={e => {setAssignmentId(e.target.value);setVerified(false)}}>
            <option value="">Выберите дисциплину студента</option>
            {data?.assignments.map(a => <option key={a.id} value={a.id}>{a.subject} · {a.form} · семестр {a.semester} · {a.academicYear ?? 'учебный год не указан'} · {a.teacher}</option>)}
          </select>
        </label>
        {assignmentId !== (row.assignmentId ?? '') && <Button disabled={busy || !assignmentId} onClick={() => void run(() => staffApi.setAssignment(row.id, assignmentId))}>Сохранить дисциплину</Button>}
        <p className="small">Причина пересдачи: {row.purpose}</p>
        <p className="small muted">Заполняется заявление с просьбой о допуске. Решение декана, подпись и печать остаются незаполненными.</p>
      </>}
      {row.status === 'in_progress' && <>
        <ol className="small muted" style={{margin:0,paddingLeft:'1.2em'}}>
          <li>Проверьте учебные сведения и отметьте галочку.</li>
          <li>Подготовьте бланк, скачайте заполненный PDF и проверьте его.</li>
          <li>Подтвердите готовность — студент получит уведомление.</li>
        </ol>
        <label className="field"><span><input type="checkbox" checked={verified} disabled={!canVerify || busy || assignmentId !== (row.assignmentId ?? '')} onChange={e => setVerified(e.target.checked)}/> Сведения и факт обучения проверены</span></label>
        <div className="req__actions">
          <Button disabled={busy || !verified} onClick={() => void run(() => staffApi.prepare(row.id))}>{row.draftId ? 'Подготовить бланк заново' : 'Подготовить заполненный бланк'}</Button>
          {row.draftId && <Button disabled={busy} onClick={() => void run(() => downloadFile(`/api/staff/requests/${row.id}/preview`, 'preview.pdf', {draftId:row.draftId}))}>Скачать PDF для проверки</Button>}
          {row.draftId && row.previewedAt && <Button disabled={busy || !verified} onClick={() => void run(() => staffApi.setStatus(row.id, 'ready', {draftId:row.draftId!}))}>Документ готов — уведомить студента</Button>}
        </div>
        <p className="small muted">{!row.draftId ? 'Сначала подготовьте заполненный бланк.' : !row.previewedAt ? 'Скачайте PDF и проверьте заполнение.' : row.delivery === 'pdf' ? 'После проверки можно подтвердить готовность. Студенту будут доступны PDF и DOCX.' : 'После проверки можно подтвердить готовность к бумажной выдаче.'}</p>
      </>}
    </>}
    {!rejecting ? <div><Button variant="ghost" onClick={() => setRejecting(true)}>Отклонить заявку…</Button></div> : <>
      <label className="field">Причина отказа<textarea className="input textarea" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Что студенту нужно исправить" autoFocus/></label>
      <div className="req__actions"><Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void run(() => staffApi.setStatus(row.id, 'rejected', {reason:reason.trim()}))}>Отклонить с причиной</Button>
      <Button variant="ghost" disabled={busy} onClick={() => {setRejecting(false);setReason('')}}>Не отклонять</Button></div>
    </>}
  </div>;
}
