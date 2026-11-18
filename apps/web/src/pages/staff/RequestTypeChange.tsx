import { useId, useState } from 'react'
import { staffApi, type ApiStaffRequest } from '../../lib/api'
import { REQUEST_CATALOG, REQUEST_OTHER, REQUEST_TYPES } from '../../data/mock'
import type { RequestType } from '../../types'
import { Button } from '../../components/ui'

/** «Иное обращение»: сотрудник сам выбирает настоящий вид заявки, студент получает уведомление. */
export function RequestTypeChange({ row, onChanged }: { row: ApiStaffRequest; onChanged: (message: string) => void }) {
  const id = useId()
  const [type, setType] = useState<RequestType>(row.type)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const change = async () => {
    setBusy(true); setError('')
    try {
      await staffApi.changeType(row.id, type)
      onChanged(`Тип изменён на «${REQUEST_TYPES[type]}», студент уведомлён`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сменить тип. Попробуйте ещё раз.')
      setBusy(false)
    }
  }

  return (
    <div className="type-change">
      <label className="field__hint" htmlFor={`${id}-type`}>Вид заявки не выбран студентом. Новый вид</label>
      <div className="type-change__row">
        <select id={`${id}-type`} className="input type-change__select" value={type} onChange={(e) => setType(e.target.value as RequestType)}>
          <option value={REQUEST_OTHER.type}>{REQUEST_OTHER.label}</option>
          {REQUEST_CATALOG.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.items.map((i) => <option key={i.type} value={i.type}>{i.label}</option>)}
            </optgroup>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={() => void change()} disabled={busy || type === row.type} aria-busy={busy}>
          {busy ? 'Меняем…' : 'Сменить тип'}
        </Button>
      </div>
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  )
}
