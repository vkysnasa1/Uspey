// Скачивает расписание групп из data/tulsu/groups.txt и кладёт копию в data/tulsu/<группа>.json.
// Запускается GitHub Actions по расписанию: сайт берёт эту копию, если tulsu.ru и прокси недоступны.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = 'https://tulsu.ru/schedule/queries/';
const groups = readFileSync('data/tulsu/groups.txt', 'utf8').split(/\s+/).filter(Boolean);

function extractJSON(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch (e) { /* дальше */ }
  const k = t.indexOf('Markdown Content:'), body = k >= 0 ? t.slice(k + 17) : t;
  const a = body.search(/[\[{]/), z = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  return JSON.parse(body.slice(a, z + 1));
}
async function get(path) {
  const target = BASE + path, enc = encodeURIComponent(target);
  const routes = [target, 'https://r.jina.ai/' + target, 'https://api.allorigins.win/raw?url=' + enc, 'https://api.codetabs.com/v1/proxy/?quest=' + enc];
  let last;
  for (const url of routes) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (uspeyu schedule cache)' }, signal: AbortSignal.timeout(40000) });
      if (!res.ok) throw new Error(url + ' → ' + res.status);
      return extractJSON(await res.text());
    } catch (e) { last = e; console.log('  не вышло:', e.message); }
  }
  throw last;
}

let failed = 0;
for (const g of groups) {
  try {
    const dates = await get('GetDates.php?search_value=' + encodeURIComponent(g));
    if (!dates || !dates.MIN_DATE) throw new Error('группа не найдена');
    const field = dates.SEARCH_FIELD || 'GROUP_P';
    const raw = await get('GetSchedule.php?search_field=' + field + '&search_value=' + encodeURIComponent(g));
    if (!Array.isArray(raw) || !raw.length) throw new Error('пустое расписание');
    const file = 'data/tulsu/' + g + '.json';
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (prev && JSON.stringify(prev.raw) === JSON.stringify(raw)) { console.log(g + ': без изменений'); continue; }
    writeFileSync(file, JSON.stringify({ group: g, field, from: dates.MIN_DATE, to: dates.MAX_DATE, at: Date.now(), raw }));
    console.log(g + ': занятий ' + raw.length);
  } catch (e) { failed++; console.log(g + ': ошибка — ' + e.message); }
}
if (failed === groups.length) process.exit(1);
