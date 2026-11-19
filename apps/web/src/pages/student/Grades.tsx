import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../../context/data'
import { CREDIT, MARK_FROM, PASS, average, gradeLabel, markFor, pluralize } from '../../lib/format'
import { GradesInsight } from '../../components/ai/GradesInsight'
import { GradeForecast } from './GradeForecast'
import { SubjectMaterials, openSubject } from './SubjectMaterials'
import { useMaterials } from '../../context/materials'
import { Badge, Button, Disclaimer, IconButton, PageHeader, Ring, ScoreBar, Segmented, ThemeButton } from '../../components/ui'
import { Icon } from '../../components/Icon'

export function GradesPage() {
  const { unreadCount, grades } = useData()
  const navigate = useNavigate()
  const { forMe } = useMaterials()
  const [selectedTerm,setTerm]=useState('')
  const [goal,setGoal]=useState<'3'|'4'|'5'>('5')
  // «Сколько баллов до цели» свёрнут по умолчанию, как «Оформление» в профиле.
  const [goalOpen, setGoalOpen] = useState(false)
  const goalPanelId = useId()
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
  const passed = list.filter((d) => d.score >= PASS).length
  const exams = all.filter((d) => d.form === 'Экзамен').length
  const credits = all.length - exams
  // порог баллов для оценки: шкала из markFor (40 / 60 / 80); для зачёта цель — 40
  const toGoal = list.map((d) => {
    const need = (d.form === 'Зачёт' ? CREDIT : MARK_FROM[goal]) - d.score
    return { d, need: Math.max(0, need) }
  })
  const goalMissing = toGoal.filter(({ need }) => need > 0).length
  // «Самый низкий результат» имеет смысл только среди нескольких оценок.
  const weakest = list.length > 1 ? [...list].sort((a, b) => a.score - b.score)[0] : undefined
  const belowPass = [...list].filter((d) => d.score < PASS).sort((a, b) => a.score - b.score)
  const isLatestTerm = term === String(semesters[0] ?? 1)
  // Шаблонный текст «Обратите внимание»: всё считает код. Показывается, пока нет разбора ИИ или ИИ недоступен.
  const attention = belowPass.length ? (
    <>
      <p>Ниже проходного результата ({PASS} баллов): {belowPass.length} {pluralize(belowPass.length, 'дисциплина', 'дисциплины', 'дисциплин')}.</p>
      <ul className="attention-list">
        {belowPass.map((d) => <li key={d.id}><b>{d.name}</b> — {d.score} {pluralize(d.score, 'балл', 'балла', 'баллов')}, не хватает {PASS - d.score}.</li>)}
      </ul>
    </>
  ) : weakest ? (
    <p>«{weakest.name}» — {weakest.score} {pluralize(weakest.score, 'балл', 'балла', 'баллов')}: {weakest.form === 'Зачёт' ? 'зачёт есть' : 'проходной результат есть'}, но это самый низкий результат семестра.</p>
  ) : list[0] ? (
    <p>«{list[0].name}» — {list[0].score} {pluralize(list[0].score, 'балл', 'балла', 'баллов')}, {list[0].form === 'Зачёт' ? 'зачёт есть' : 'проходной результат есть'}.{all.length > 1 ? ' Остальные баллы пока не выставлены.' : ''}</p>
  ) : null

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
                <p className="small on-accent-2">Проходной итоговый результат — 40 баллов. Условия допуска к экзамену уточняются отдельно.</p>
              </div>
            </div>
            <div className="tiles">
              <div className="tile">
                <b className="display tile__value tile__value--hl">
                  {passed}/{all.length}
                </b>
                <span>проходной результат</span>
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

          {attention && (isLatestTerm
            ? <GradesInsight scoresKey={list.map((d) => `${d.id}:${d.score}`).join('|')} fallback={attention} />
            : <section className="card card--hl">
                <h2 className="card__title card__title--lg">Обратите внимание</h2>
                {attention}
              </section>)}

          {list.length > 0 && (
            <section className={`card goal collapse ${goalOpen ? 'is-open' : ''}`}>
              <button
                type="button"
                className="collapse__head"
                aria-expanded={goalOpen}
                aria-controls={goalPanelId}
                onClick={() => setGoalOpen((v) => !v)}
              >
                <span>
                  <span className="card__title card__title--lg">Сколько баллов до цели</span>
                  <span className="collapse__summary">
                    Цель «{goal}» · {goalMissing === 0 ? 'уже достигнута везде' : `не хватает по ${goalMissing} ${pluralize(goalMissing, 'дисциплине', 'дисциплинам', 'дисциплинам')}`}
                  </span>
                </span>
                <Icon name="chevronDown" size={22} className="collapse__chevron" />
              </button>
              <div id={goalPanelId} className="collapse__panel" inert={!goalOpen} aria-hidden={!goalOpen}>
                <div className="collapse__inner">
                  <Segmented
                    label="Цель по экзаменам"
                    value={goal}
                    onChange={setGoal}
                    options={[{ value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }]}
                  />
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
                  <p className="small muted">Считаем по текущим баллам: шкала {MARK_FROM[3]} — «3», {MARK_FROM[4]} — «4», {MARK_FROM[5]} — «5». Для зачёта и проходного результата достаточно {CREDIT}.</p>
                </div>
              </div>
            </section>
          )}

          {all.length > 0 && <GradeForecast grades={all} />}

          <section className="card">
            <h2 className="card__title card__title--lg">Баллы отображаются неверно?</h2>
            <p className="muted">Обратитесь к преподавателю дисциплины.</p>
            <Button variant="surface" icon="file" onClick={() => navigate('/student/requests?to=teacher')}>
              Написать преподавателю
            </Button>
          </section>
        </div>
      </div>
      <Disclaimer />
    </>
  )
}
