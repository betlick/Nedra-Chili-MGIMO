import { useEffect, useId, useState, type ReactNode } from 'react'
import { aiApi, ApiError, type AiInsight } from '../../lib/api'
import { AiMark } from './AiMark'

type State = { kind: 'busy' } | { kind: 'ok'; insight: AiInsight & { summary: string } } | { kind: 'fallback'; note: string }

/**
 * Блок «Обратите внимание»: разбор ИИ по готовым числам с сервера.
 * Пока разбора нет или ИИ недоступен — шаблонный текст, посчитанный кодом.
 * Сервер кэширует разбор по хэшу баллов, поэтому повторное открытие страницы модель не вызывает.
 */
export function GradesInsight({ scoresKey, fallback }: { scoresKey: string; fallback: ReactNode }) {
  const titleId = useId()
  // Ответ привязан к набору баллов: пока ответа для текущих баллов нет — состояние «загрузка».
  const [result, setResult] = useState<{ key: string; state: Exclude<State, { kind: 'busy' }> } | null>(null)
  const state: State = result?.key === scoresKey ? result.state : { kind: 'busy' }
  useEffect(() => {
    let live = true
    const done = (next: Exclude<State, { kind: 'busy' }>) => { if (live) setResult({ key: scoresKey, state: next }) }
    const unavailable = 'Разбор ИИ сейчас недоступен, показан расчёт по баллам.'
    aiApi.grades().then((res) => {
      if (res.ok && res.summary && res.items.length) done({ kind: 'ok', insight: { summary: res.summary, items: res.items } })
      else done({ kind: 'fallback', note: res.ok || res.reason === 'disabled' ? '' : unavailable })
    }).catch((e) => done({ kind: 'fallback', note: e instanceof ApiError && e.status === 429 ? e.message : unavailable }))
    return () => { live = false }
  }, [scoresKey])

  return (
    <section className="card card--hl" aria-labelledby={titleId}>
      <div className="card__head card__head--wrap">
        <h2 id={titleId} className="card__title card__title--lg">Обратите внимание</h2>
        {state.kind === 'ok' && <AiMark>Разбор ИИ</AiMark>}
      </div>
      <div className="ai-insight" aria-live="polite" aria-busy={state.kind === 'busy'}>
        {state.kind === 'ok' ? (
          <>
            <p>{state.insight.summary}</p>
            <ul className="attention-list">
              {state.insight.items.map((i) => <li key={i.subject}><b>{i.subject}</b> — {i.note}</li>)}
            </ul>
          </>
        ) : fallback}
        {state.kind === 'busy' && <p className="small">Готовим разбор ИИ…</p>}
        {state.kind === 'fallback' && state.note && <p className="small">{state.note}</p>}
      </div>
    </section>
  )
}
