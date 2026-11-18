import { randomUUID } from 'node:crypto';

/** Причина, по которой ИИ не дал ответа. Текст ошибки провайдера наружу не передаётся. */
export type AiReason = 'disabled' | 'timeout' | 'unavailable' | 'invalid';
export type AiTask = 'grades';
export interface AiCall { system: string; user: string; json?: boolean; task: AiTask }
export interface AiProvider { readonly name: string; complete(call: AiCall, signal: AbortSignal): Promise<string> }
export class AiError extends Error { constructor(public reason: AiReason) { super(reason); } }

type Env = Record<string, string | undefined>;
const MODEL = /^[A-Za-z0-9._:-]+(\/[A-Za-z0-9._:-]+)?$/;

/**
 * YandexGPT, REST API Foundation Models: POST /foundationModels/v1/completion.
 * Авторизация API-ключом сервисного аккаунта (роль ai.languageModels.user), каталог — AI_FOLDER_ID.
 * maxTokens передаётся строкой (int64), jsonObject — поле верхнего уровня, ответ обёрнут в result.
 */
function yandex(env: Env): AiProvider {
  const key = env.AI_API_KEY, folder = env.AI_FOLDER_ID, model = env.AI_MODEL || 'yandexgpt-lite/latest';
  if (!key || !folder || !/^[a-z0-9]+$/i.test(folder) || !MODEL.test(model)) throw new Error('YandexGPT: set AI_API_KEY, AI_FOLDER_ID and a valid AI_MODEL');
  const url = env.AI_ENDPOINT || 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
  return {
    name: 'yandex',
    async complete({ system, user, json }, signal) {
      const res = await fetch(url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Api-Key ${key}`, 'x-folder-id': folder },
        body: JSON.stringify({
          modelUri: `gpt://${folder}/${model}`,
          completionOptions: { stream: false, temperature: 0.2, maxTokens: '800' },
          messages: [{ role: 'system', text: system }, { role: 'user', text: user }],
          ...(json ? { jsonObject: true } : {}),
        }),
      });
      if (!res.ok) throw new AiError('unavailable');
      const body = await res.json() as { result?: { alternatives?: Alt[] }; alternatives?: Alt[] };
      const alt = (body.result ?? body).alternatives?.[0];
      if (!alt || alt.status === 'ALTERNATIVE_STATUS_CONTENT_FILTER' || typeof alt.message?.text !== 'string') throw new AiError('invalid');
      return alt.message.text;
    },
  };
}
type Alt = { status?: string; message?: { text?: string } };

/**
 * GigaChat: ключ авторизации (AI_API_KEY) меняется на токен доступа (POST /api/v2/oauth, живёт 30 минут),
 * затем POST /api/v1/chat/completions. Нужен корневой сертификат Минцифры: NODE_EXTRA_CA_CERTS при запуске.
 */
function gigachat(env: Env): AiProvider {
  const key = env.AI_API_KEY, scope = env.AI_SCOPE || 'GIGACHAT_API_PERS', model = env.AI_MODEL || 'GigaChat';
  if (!key || !MODEL.test(model) || !/^[A-Z_]+$/.test(scope)) throw new Error('GigaChat: set AI_API_KEY, AI_SCOPE and a valid AI_MODEL');
  let token: { value: string; until: number } | null = null;
  async function access(signal: AbortSignal) {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const res = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', RqUID: randomUUID(), Authorization: `Basic ${key}` },
      body: new URLSearchParams({ scope }),
    });
    if (!res.ok) throw new AiError('unavailable');
    const body = await res.json() as { access_token?: string; expires_at?: number };
    if (typeof body.access_token !== 'string') throw new AiError('unavailable');
    token = { value: body.access_token, until: typeof body.expires_at === 'number' ? body.expires_at : Date.now() + 25 * 60_000 };
    return token.value;
  }
  return {
    name: 'gigachat',
    async complete({ system, user }, signal) {
      const res = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${await access(signal)}` },
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 800, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (res.status === 401) token = null;
      if (!res.ok) throw new AiError('unavailable');
      const body = await res.json() as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new AiError('invalid');
      return text;
    },
  };
}

/** Блок данных из сообщения: всё между <данные> и </данные>. */
const dataBlock = (user: string) => user.match(/<данные>\n?([\s\S]*?)\n?<\/данные>/)?.[1] ?? '';

export function mockProvider(): AiProvider {
  return {
    name: 'mock',
    async complete({ user }, signal) {
      const data = dataBlock(user);
      // Служебные маркеры для тестов: проверка обработки сбоев.
      if (data.includes('MOCK_TIMEOUT')) await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new AiError('timeout'))));
      if (data.includes('MOCK_UNAVAILABLE')) throw new AiError('unavailable');
      if (data.includes('MOCK_INVALID_JSON')) return 'Конечно! Вот разбор: {summary: всё хорошо';
      // Разбор успеваемости по готовым числам: самые низкие баллы первыми.
      const facts = JSON.parse(data) as { средний_балл: number; дисциплины: { дисциплина: string; балл: number; допуск: boolean; не_хватает_до_допуска: number }[] };
      const list = [...facts.дисциплины].sort((a, b) => a.балл - b.балл);
      const risky = list.filter(d => !d.допуск);
      return JSON.stringify({
        summary: risky.length ? `Средний балл ${facts.средний_балл}. Без допуска: ${risky.length} — начните с них.` : `Средний балл ${facts.средний_балл}. Допуск есть по всем дисциплинам.`,
        items: list.slice(0, 3).map(d => ({ subject: d.дисциплина, note: d.допуск ? `${d.балл} баллов, допуск есть.` : `${d.балл} баллов: до допуска не хватает ${d.не_хватает_до_допуска}.` })),
      });
    },
  };
}

/** Провайдер из окружения. Пустой AI_PROVIDER или off — ИИ выключен, интерфейс работает без него. */
export function createProvider(env: Env = process.env): AiProvider | null {
  switch ((env.AI_PROVIDER ?? '').trim().toLowerCase()) {
    case 'yandex': return yandex(env);
    case 'gigachat': return gigachat(env);
    case 'mock':
      if (env.NODE_ENV === 'production' && env.AI_ALLOW_MOCK !== '1') throw new Error('AI_PROVIDER=mock is disabled in production; set AI_ALLOW_MOCK=1 for a demo');
      return mockProvider();
    case '': case 'off': return null;
    default: throw new Error('AI_PROVIDER must be yandex, gigachat, mock or off');
  }
}
