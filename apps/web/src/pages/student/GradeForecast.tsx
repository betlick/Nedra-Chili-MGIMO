import { useState } from 'react'
import type { ApiGrade } from '../../lib/api'
import { forecastGrade, GRADE_TARGETS, validateForecast, type ForecastInput } from '../../lib/gradeForecast'

const FIELDS: { key: keyof ForecastInput; label: string; max: number }[] = [
  { key: 'lectures', label: 'Лекций всего', max: 200 },
  { key: 'lecturesAttended', label: 'Лекций посещено', max: 200 },
  { key: 'lecturesUpcoming', label: 'Лекций осталось', max: 200 },
  { key: 'practices', label: 'Практик всего (семинары включены)', max: 200 },
  { key: 'practicesAttended', label: 'Практик посещено', max: 200 },
  { key: 'practicesUpcoming', label: 'Практик осталось', max: 200 },
  { key: 'control', label: 'Баллы за текущий контроль сейчас', max: 40 },
]

type Draft = Partial<Record<keyof ForecastInput, string>>

export function GradeForecast({ grades }: { grades: ApiGrade[] }) {
  const [selectedId, setSelectedId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const selected = grades.find(g => g.id === selectedId) ?? grades[0]
  if (!selected) return null
  const draft = drafts[selected.id] ?? {}
  const defaults = selected.lessonCounts
  const valueOf = (key: keyof ForecastInput) => {
    const scheduled = key === 'lectures' || key === 'lecturesUpcoming' || key === 'practices' || key === 'practicesUpcoming' ? defaults?.[key] : undefined
    return draft[key] ?? (scheduled === undefined ? '' : String(scheduled))
  }
  const ready = valueOf('lectures') !== '' && valueOf('practices') !== ''
  const input = Object.fromEntries(FIELDS.map(({ key }) => [key, Number(valueOf(key) || 0)])) as unknown as ForecastInput
  const error = ready ? validateForecast(input) : null
  const targets = selected.form === 'Экзамен' ? GRADE_TARGETS : [{ label: 'Зачёт', points: 40 }]

  return <section className="card forecast">
    <h2 className="card__title card__title--lg">Прогноз оценки</h2>
    <p className="small muted">По каждой дисциплине: лекции — 10, практики (включая семинары) — 10, текущий контроль — 40, экзамен или зачёт — 40. Шкала: 40 / 60 / 80 баллов.</p>
    <label className="forecast__subject">Дисциплина
      <select className="input" value={selected.id} onChange={e => setSelectedId(e.target.value)}>
        {grades.map(g => <option key={g.id} value={g.id}>{g.name} · {g.form.toLowerCase()}</option>)}
      </select>
    </label>
    <p className="small muted">В ведомости: {selected.score === null ? 'балл ещё не выставлен' : `${selected.score} из 100`}. Он не разделён на виды работ. Количество занятий подставлено из расписания; укажите, сколько вы посетили, и баллы текущего контроля. Если расписание неполное, поправьте числа. Пропущенные занятия учитываются как непосещённые.</p>
    <div className="forecast__fields">
      {FIELDS.map(({ key, label, max }) => <label key={key}>{label}
        <input className="input" type="number" min={0} max={max} step={1} inputMode="numeric" value={valueOf(key)} placeholder="0" onChange={e => {
          const value = e.target.value
          if (value !== '' && (!/^\d{1,3}$/.test(value) || Number(value) > max)) return
          setDrafts(prev => ({ ...prev, [selected.id]: { ...prev[selected.id], [key]: value } }))
        }} />
      </label>)}
    </div>
    {!ready && <p className="small muted">Укажите общее количество лекций и практик (если их нет, введите 0). Остальные пустые поля считаются нулём.</p>}
    {error && <p className="forecast__error" role="alert">{error}</p>}
    {ready && !error && <div className="forecast__results">
      {targets.map(({ label, points }) => {
        const result = forecastGrade(input, points)
        return <div className="forecast__result" key={label}>
          <b>{selected.form === 'Экзамен' ? `Оценка «${label}»` : label} · от {points} баллов</b>
          {!result.reachable ? <p>Цель пока недостижима: даже при посещении всех оставшихся занятий и максимальных баллах за контроль и {selected.form === 'Экзамен' ? 'экзамен' : 'зачёт'} получится не больше {Math.floor(result.maximum)}.</p>
            : result.attended + input.control >= points ? <p>По введённым данным порог уже набран. Дополнительные баллы не нужны.</p>
              : <p>Один возможный план: посетить ещё <strong>{result.lecturesToAttend} лекций</strong> и <strong>{result.practicesToAttend} практик</strong>, добрать <strong>{result.controlNeeded} баллов</strong> за текущий контроль (итого {input.control + result.controlNeeded}/40) и получить <strong>{result.finalNeeded} из 40</strong> на {selected.form === 'Экзамен' ? 'экзамене' : 'итоговом зачёте'}.</p>}
        </div>
      })}
    </div>}
    <p className="small muted">План предполагает посещение всех оставшихся занятий и минимальный добор за текущий контроль. Поэтому на экзамене или зачёте может потребоваться до 40 баллов. Другие сочетания тоже возможны; расчёт не меняет ведомость.</p>
  </section>
}
