import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useData } from '../../context/data'
import { useUser } from '../../context/auth'
import type { NoticeIcon } from '../../types'
import type { IconName } from '../../components/Icon'
import { Icon } from '../../components/Icon'
import { Badge, Button, Disclaimer, PageHeader, ThemeButton, Toggle } from '../../components/ui'
import { dataApi } from '../../lib/api'
import { disablePush, enablePush, pushIsActive, pushSupported } from '../../lib/push'

const ICONS: Record<NoticeIcon, IconName> = { alert: 'alert', calendar: 'calendar', doc: 'doc', bell: 'bell', inbox: 'inbox' }

export function NotificationsPage() {
  const { notices, unreadCount, markRead, markAllRead, prefs, setPref } = useData()
  const user = useUser()
  const isStudent = user.role === 'student'
  const [pushKey, setPushKey] = useState<string | null>(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')
  useEffect(() => {
    let active = true
    dataApi.pushConfig().then(async config => {
      const subscribed = await pushIsActive()
      if (active) { setPushKey(config.publicKey); setPushEnabled(subscribed) }
    }).catch(() => { if (active) setPushError('Не удалось проверить настройки push-уведомлений') })
    return () => { active = false }
  }, [])
  async function togglePush() {
    setPushBusy(true)
    setPushError('')
    try {
      if (pushEnabled) { await disablePush(); setPushEnabled(false) }
      else if (pushKey) { await enablePush(pushKey); setPushEnabled(true) }
    } catch (error) {
      setPushError(error instanceof Error ? error.message : 'Не удалось изменить подписку')
    } finally { setPushBusy(false) }
  }
  return (
    <>
      <PageHeader
        eyebrow={`Непрочитанных: ${unreadCount}`}
        title="Уведомления"
        actions={
          <>
            <ThemeButton />
            <Button variant="primary" onClick={markAllRead} disabled={unreadCount === 0}>
              Прочитать все
            </Button>
          </>
        }
      />
      <div className={isStudent ? 'grid-side grid-side--wide' : undefined}>
        <section className="card">
          {notices.length === 0 && <p className="muted">Пока уведомлений нет.</p>}
          <ul className="notices">
            {notices.map((n) => (
              <li key={n.id} className={`notice ${n.unread ? 'is-unread' : ''}`}>
                <span className={`notice__icon ${n.unread ? 'is-hl' : ''}`}>
                  <Icon name={ICONS[n.icon]} size={20} />
                </span>
                <div className="notice__body">
                  <h3>
                    {n.title} {n.unread && <Badge tone="orange">новое</Badge>}
                  </h3>
                  <p>{n.text}</p>
                  <span className="small muted">{n.time === 'Сегодня, 08:30' ? '11 ноября 2026, 08:30' : n.time === 'Вчера, 18:10' ? '10 ноября 2026, 18:10' : n.time}</span>
                </div>
                {(n.kind === 'inquiry' || n.unread || (isStudent && n.requestId)) && (
                  <div className="notice__actions">
                    {isStudent && n.requestId && (
                      <Link className="btn btn--ghost btn--sm" to={`/student/requests?id=${n.requestId}`} onClick={() => n.unread && void markRead(n.id)}>
                        Открыть заявку
                      </Link>
                    )}
                    {n.kind === 'inquiry' && (
                      <Link className="btn btn--ghost btn--sm" to={`/${user.role}/inquiries`} onClick={() => n.unread && void markRead(n.id)}>
                        Открыть
                      </Link>
                    )}
                    {n.unread && (
                      <Button variant="ghost" size="sm" onClick={() => markRead(n.id)}>
                        Прочитано
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card prefs">
          <h2 className="card__title card__title--lg">Уведомления браузера</h2>
          <p className="small muted">Получайте новые уведомления на этом устройстве, даже когда вкладка закрыта.</p>
          {pushKey && pushSupported() ? (
            <Button variant="primary" onClick={() => void togglePush()} disabled={pushBusy}>
              {pushBusy ? 'Сохраняем…' : pushEnabled ? 'Отключить на этом устройстве' : 'Включить на этом устройстве'}
            </Button>
          ) : <p className="small muted">{!pushSupported() ? 'Требуется HTTPS и браузер с поддержкой Web Push.' : 'Доставка push пока не настроена на сервере.'}</p>}
          {pushError && <p role="alert">{pushError}</p>}
        </section>

        {isStudent && (
        <section className="card prefs">
          <h2 className="card__title card__title--lg">Что присылать</h2>
          <Toggle label="Дедлайны" checked={prefs.deadlines} onChange={(v) => setPref('deadlines', v)} />
          <Toggle label="Изменения в расписании" checked={prefs.schedule} onChange={(v) => setPref('schedule', v)} />
          <Toggle label="Новости деканата" checked={prefs.news} onChange={(v) => setPref('news', v)} />
          <p className="small muted">Уведомления отображаются в этом разделе. Почтовая доставка пока не подключена.</p>
        </section>
        )}
      </div>
      <Disclaimer />
    </>
  )
}
