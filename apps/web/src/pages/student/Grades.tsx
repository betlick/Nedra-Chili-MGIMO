import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../../context/data'
import { average, gradeLabel, markFor, pluralize } from '../../lib/format'
import { SubjectMaterials, openSubject } from './SubjectMaterials'
import { useMaterials } from '../../context/materials'
import { Badge, Button, Disclaimer, IconButton, PageHeader, Ring, ScoreBar, Segmented, ThemeButton } from '../../components/ui'

export function GradesPage() {
  const { unreadCount, grades } = useData()
  const navigate = useNavigate()
  const { forMe } = useMaterials()
  const [selectedTerm,setTerm]=useState('')
  const [goal,setGoal]=useState<'3'|'4'|'5'>('5')
  const semesters=[...new Set(grades.map(g=>g.semester))].sort((a,b)=>b-a)
  const term=selectedTerm||String(semesters[0]??1)
  const all=grades.filter(g=>String(g.semester)===term)
  const list=all.filter((g):g is typeof g & {score:number}=>g.score!==null)
  const subjectCell = (name: string) => {
    const n = forMe.filter((m) => m.subject === name).length
    return n > 0 ? (
      <a className="subject-link" href="#materials" title="К материалам по предмету" onClick={(e) => { e.preventDefault(); openSubject(name) }}>
        {name}
        <span className="subject-link__n">{n}</span>
      </a>
    ) : (
      name
    )
  }
  const avg = average(list.map((d) => d.score))
  const admitted = list.filter((d) => d.score >= 50).length
  const exams = all.filter((d) => d.form === 'Экзамен').length
  const credits = all.length - exams
  // порог баллов для оценки: шкала из markFor (50 / 70 / 85); для зачёта цель всегда 50
  const THRESHOLD = { '3': 50, '4': 70, '5': 85 } as const
  const toGoal = list.map((d) => {
    const need = (d.form === 'Зачёт' ? 50 : THRESHOLD[goal]) - d.score
    return { d, need: Math.max(0, need) }
  })
  const weakest = [...list].sort((a, b) => a.score - b.score)[0]

  return (
    <>
      <PageHeader
        eyebrow={`Семестр ${term}`}
        title="Предметы"
        actions={
          <>
            <ThemeButton />
            <IconButton icon="bell" label="Уведомления" to="/student/notifications" dot={unreadCount > 0} />
          </>
        }
      />
      <div className="grid-side">
        <div className="stack">
        <section className="card">
          <div className="card__head">
            <h2 className="card__title card__title--lg">Дисциплины</h2>
            <Segmented
              label="Семестр"
              value={term}
              onChange={setTerm}
              options={semesters.map(s=>({value:String(s),label:`Семестр ${s}`}))}
            />
          </div>
          <div className="table-wrap">
            <table className="table grades-table">
              <thead>
                <tr>
                  <th>Дисциплина</th>
                  <th>Форма</th>
                  <th colSpan={2}>Баллы</th>
                  <th className="ta-r">Оценка</th>
                </tr>
              </thead>
              <tbody>
                {all.length===0 && <tr><td colSpan={5}>Дисциплин пока нет.</td></tr>}
                {all.filter(g=>g.score===null).map(g=><tr key={g.id}><td className="strong">{subjectCell(g.name)}</td><td>{g.form}</td><td colSpan={3}>Балл не выставлен</td></tr>)}
                {list.map((d) => {
                  const g = gradeLabel(d.score, d.form)
                  const warn = d.id === weakest?.id
                  return (
                    <tr key={d.id}>
                      <td className="strong">
                        {subjectCell(d.name)}
                      </td>
                      <td className="muted">{d.form}</td>
                      <td className="grades-table__bar">
                        <ScoreBar value={d.score} warn={warn} />
                      </td>
                      <td className="num">{d.score}</td>
                      <td className="ta-r">
                        <Badge tone={g === 'Зачтено' || g === '5' ? 'hl' : g === '2' || g === 'Не зачтено' ? 'danger' : 'neutral'}>{g}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
        <SubjectMaterials subjects={[...new Set(grades.map((g) => g.name))]} />
        </div>

        <div className="stack">
          <section className="card card--accent">
            <div className="avg-card">
              <Ring value={avg} size={136} stroke={13} onAccent />
              <div>
                <h2 className="card__title card__title--lg">Средний балл</h2>
                <p className="small on-accent-2">Для допуска к сессии нужно не менее 50 баллов по каждой дисциплине.</p>
              </div>
            </div>
            <div className="tiles">
              <div className="tile">
                <b className="display tile__value tile__value--hl">
                  {admitted}/{all.length}
                </b>
                <span>допуск</span>
              </div>
              <div className="tile">
                <b className="display tile__value">{exams}</b>
                <span>экзамена</span>
              </div>
              <div className="tile">
                <b className="display tile__value">{credits}</b>
                <span>зачёта</span>
              </div>
            </div>
          </section>

          {weakest && <section className="card card--hl">
            <h2 className="card__title card__title--lg">Обратите внимание</h2>
            <p>
              «{weakest.name}» — {weakest.score} баллов: {weakest.score >= 50 ? (weakest.form === 'Зачёт' ? 'зачёт есть' : 'допуск есть') : 'допуска пока нет'}, но это самый низкий результат семестра.
            </p>
          </section>}

          {list.length > 0 && (
            <section className="card goal">
              <div className="card__head">
                <h2 className="card__title card__title--lg">Сколько баллов до цели</h2>
                <Segmented
                  label="Цель по экзаменам"
                  value={goal}
                  onChange={setGoal}
                  options={[{ value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }]}
                />
              </div>
              <ul className="goal__list">
                {toGoal.map(({ d, need }) => (
                  <li key={d.id} className={need === 0 ? 'is-done' : ''}>
                    <span>
                      {d.form === 'Зачёт' ? 'Зачёт' : `До ${goal}`} по «{d.name}»
                      {d.form === 'Экзамен' && markFor(d.score) > Number(goal) ? ` (сейчас ${markFor(d.score)})` : ''}
                    </span>
                    <b>{need === 0 ? 'Уже есть' : `не хватает ${need} ${pluralize(need, 'балла', 'баллов', 'баллов')}`}</b>
                  </li>
                ))}
              </ul>
              <p className="small muted">Считаем по текущим баллам: шкала 50 — «3», 70 — «4», 85 — «5». Для зачёта достаточно 50.</p>
            </section>
          )}

          <section className="card">
            <h2 className="card__title card__title--lg">Баллы отображаются неверно?</h2>
            <p className="muted">Обратитесь к преподавателю дисциплины.</p>
            <Button variant="surface" icon="file" onClick={() => navigate('/student/inquiries')}>
              Написать преподавателю
            </Button>
          </section>
        </div>
      </div>
      <Disclaimer />
    </>
  )
}
