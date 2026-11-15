import { dataApi } from './api'

export const pushSupported = () =>
  window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function existing() {
  const registration = await navigator.serviceWorker.getRegistration('/')
  return registration?.pushManager.getSubscription() ?? null
}

export async function syncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  const subscription = await existing()
  if (!subscription) return false
  await store(subscription)
  return true
}

function store(subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('Браузер вернул неполную подписку')
  return dataApi.pushSubscribe({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } })
}

export async function enablePush(publicKey: string) {
  if (!pushSupported()) throw new Error('Этот браузер не поддерживает push-уведомления')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Разрешите уведомления для сайта в настройках браузера')
  const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' })
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'))
    const key = Uint8Array.from(raw, char => char.charCodeAt(0))
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  }
  try { await store(subscription) }
  catch (error) { await subscription.unsubscribe(); throw error }
}

export async function disablePush() {
  if (!pushSupported()) return
  const subscription = await existing()
  if (!subscription) return
  await dataApi.pushUnsubscribe(subscription.endpoint)
  await subscription.unsubscribe()
}

export async function detachPushOnLogout() {
  if (!pushSupported()) return
  const subscription = await existing()
  if (subscription) await dataApi.pushUnsubscribe(subscription.endpoint)
}

export async function pushIsActive() {
  return pushSupported() && Notification.permission === 'granted' && Boolean(await existing())
}
