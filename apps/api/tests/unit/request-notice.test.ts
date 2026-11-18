import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestNotice, typeChangeNotice } from '../../src/request-notice.js';

test('request notifications name the request, number and status', () => {
  const row = { id: 'af70c0de-0000-4000-8000-000000000000', type: 'study', delivery: 'pdf' };
  assert.equal(requestNotice(row, 'ready').title, 'Справка об обучении № AF70 готова — PDF можно скачать');
  assert.equal(requestNotice(row, 'in_progress').title, 'Заявка № AF70 взята в работу');
  assert.equal(requestNotice({ ...row, type: 'military', delivery: 'office' }, 'ready').title, 'Справка для военкомата № AF70 готова — заберите в деканате');
  assert.equal(requestNotice({ ...row, type: 'leave' }, 'ready').title, 'Заявка № AF70 готова — PDF можно скачать');
  assert.match(requestNotice(row, 'rejected', 'Нет данных').body, /Причина: Нет данных/);
  assert.match(typeChangeNotice({ ...row, type: 'extension' }, 'other').body, /«Иное обращение» на «Продление сессии»/);
});
