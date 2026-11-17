import { useEffect, useRef, useState } from 'react'
import { ApiError, staffApi, type ApiGroup } from '../../lib/api'
import { CSV_TEMPLATE, decodeCsv, parseCsv, toLessons, type CsvLesson } from '../../lib/csv'
import { pluralize } from '../../lib/format'
import { KIND_LABEL } from '../../lib/staff'
import { Button } from '../../components/ui'
import { Icon } from '../../components/Icon'

const MAX_ROWS = 500
const dayLabel = (iso: string) => (iso ? iso.split('-').reverse().join('.') : '—')

interface Result { added: number }

/** Предпросмотр CSV в браузере, затем проверка и сохранение всех занятий одной транзакцией на сервере. */
export function CsvImportDialog({ group, teachers, onClose, onDone }: { group: ApiGroup; teachers:{id:string;name:string}[]; onClose: () => void; onDone: (r: Result) => void }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<CsvLesson[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [progress, setProgress] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !progress) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, progress])

  const read = async (file: File | undefined) => {
    if (!file) return
    setResult(null)
    setProblem(null)
    setRows(null)
    setFileName(file.name)
    if (file.size > 2_000_000) return setProblem('Файл слишком большой — до 2 МБ.')
    try {
    const parsed = toLessons(parseCsv(decodeCsv(await file.arrayBuffer())))
    setFileName(file.name)
    if (parsed.lessons.length === 0) { setRows(null); return setProblem('В файле нет строк с занятиями.') }
    if (parsed.lessons.length > MAX_ROWS) { setRows(null); return setProblem(`В файле больше ${MAX_ROWS} строк — разделите его на части.`) }
    setRows(parsed.lessons.map(r=>{const matches=teachers.filter(t=>t.name.toLowerCase()===r.teacherName.trim().toLowerCase());return {...r,error:r.error||(matches.length!==1?'Нужно полное уникальное имя преподавателя из списка':undefined)}}))
    } catch { setProblem('Не удалось прочитать CSV. Проверьте файл и кодировку.') }
  }

  const valid = rows?.filter((r) => !r.error) ?? []
  const invalid = (rows?.length ?? 0) - valid.length

  const run = async () => {
    if (!rows || invalid || progress) return
    setProgress(true)
    try {
      const lessons = rows.map(r => ({
        subject: r.subject, kind: r.kind, teacherId: teachers.find(t => t.name.toLowerCase() === r.teacherName.trim().toLowerCase())!.id, teacherName: r.teacherName,
        room: r.room, startsAt: new Date(`${r.date}T${r.from}:00+03:00`).toISOString(),
        endsAt: new Date(`${r.date}T${r.to}:00+03:00`).toISOString(), changeNote: r.changeNote || null,
      }))
      const result = await staffApi.importLessons(group.id, lessons)
      setResult({ added: result.added })
      onDone({ added: result.added })
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Не удалось загрузить расписание. Ничего не добавлено.')
    } finally { setProgress(false) }
  }

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'raspisanie-shablon.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !progress) onClose() }}>
      <div className="dialog dialog--wide" role="dialog" aria-modal="true" aria-labelledby="csv-title">
        <div className="dialog__head">
          <div>
            <h2 id="csv-title" className="card__title card__title--lg">Загрузка расписания из CSV</h2>
            <span className="small muted">Группа {group.name}</span>
          </div>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Закрыть" disabled={progress} onClick={onClose}><Icon name="x" size={18} /></button>
        </div>

        {!result && (
          <>
            <p className="small muted csv-help">
              Колонки: <b>дата; начало; конец; предмет; вид; преподаватель; аудитория; пометка</b>. Преподаватель — полное имя из списка. Дата — дд.мм.гггг, время — чч:мм (МСК), вид — лекция, семинар или практика. Подойдёт CSV из Excel (разделитель «;» или «,»).{' '}
              <button type="button" className="link-btn" onClick={downloadTemplate}>Скачать шаблон</button>
            </p>
            <label
              className={`dropzone ${drag ? 'is-drag' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); void read(e.dataTransfer.files[0]) }}
            >
              <Icon name="file" size={22} />
              <b>{fileName || 'Выберите файл или перетащите его сюда'}</b>
              <span className="small muted">{rows ? 'Нажмите, чтобы выбрать другой файл' : '.csv, до 2 МБ'}</span>
              <input ref={input} type="file" accept=".csv,text/csv" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {problem && <p className="form-error" role="alert"><Icon name="alert" size={16} /> {problem}</p>}
          </>
        )}

        {rows && !result && (
          <>
            <p className="csv-summary">
              Строк: <b>{rows.length}</b> · готовы к добавлению: <b>{valid.length}</b>
              {invalid > 0 && <> · с ошибками: <b className="csv-bad">{invalid}</b> (исправьте файл перед импортом)</>}
            </p>
            <div className="csv-table-wrap">
              <table className="csv-table">
                <thead><tr><th>Стр.</th><th>Дата</th><th>Время</th><th>Предмет</th><th>Вид</th><th>Преподаватель</th><th>Ауд.</th><th>Проверка</th></tr></thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr key={r.line} className={r.error ? 'is-bad' : ''}>
                      <td>{r.line}</td><td>{dayLabel(r.date)}</td><td>{r.from}–{r.to}</td><td>{r.subject}</td><td>{KIND_LABEL[r.kind]}</td><td>{r.teacherName}</td><td>{r.room}</td>
                      <td>{r.error ?? 'ок'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 200 && <p className="small muted">Показаны первые 200 строк из {rows.length}; проверены все.</p>}
            <p className="small muted">Сервер проверит пересечения по группе, преподавателю и аудитории. При ошибке хотя бы в одном занятии весь импорт отменяется. Подписанные на изменения студенты получат одно уведомление.</p>
          </>
        )}

        {result && (
          <div className="csv-result" role="status">
            <b>Добавлено занятий: {result.added}</b>
          </div>
        )}

        <div className="dialog__actions">
          {result ? (
            <Button variant="strong" onClick={onClose}>Готово</Button>
          ) : (
            <>
              <Button type="button" variant="surface" onClick={onClose} disabled={progress}>Отмена</Button>
              <Button type="button" variant="strong" icon="check" disabled={valid.length === 0 || invalid > 0 || progress} onClick={() => void run()}>
                {progress ? 'Проверяем и сохраняем…' : valid.length ? `Добавить ${valid.length} ${pluralize(valid.length, 'занятие', 'занятия', 'занятий')}` : 'Добавить занятия'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
