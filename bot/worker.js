// Успею — Telegram-бот напоминаний о выходе (Cloudflare Worker + база D1, бесплатно).
//
// Приложение само считает время выхода и раз в какое-то время присылает сюда готовые
// напоминания: «в 7:05 написать "Пора выходить"». Бот только хранит их и отправляет вовремя.
// Адресов, группы и настроек здесь нет: только id чата в Telegram, случайный ключ устройства
// и тексты напоминаний.
//
// Переменные окружения (Settings → Variables): BOT_TOKEN (секрет от @BotFather),
// SETUP_KEY (секрет: 32+ латинских букв и цифр), ORIGIN (адрес сайта, например https://vkysnasa1.github.io).
//
// Что защищено и как:
// - BOT_TOKEN живёт только в секретах Cloudflare. Его нет ни в репозитории, ни в приложении, ни в ответах воркера.
// - Сообщения от Telegram принимаются, только если в заголовке пришёл SETUP_KEY: его знают лишь Telegram и воркер,
//   поддельный /start с чужим chat_id не пройдёт.
// - Ключ устройства — 144 случайных бита, подобрать нельзя. Кто его украдёт, сможет только поменять
//   напоминания в твоём же чате: прочитать ничего нельзя, ссылки из текста вырезаются, запросов не больше 60 в час.
// Привязка базы: DB → D1 с таблицами из schema.sql. Cron: "* * * * *".

const MAX_REMINDERS = 40;               // на одно устройство: ~2 в день на 8 дней вперёд
const MAX_AHEAD = 9 * 24 * 3600 * 1000; // дальше 9 дней не храним
const LATE = 15 * 60 * 1000;            // если бот проспал больше 15 минут, старое напоминание уже не нужно
const SYNC_PER_HOUR = 60;               // приложение шлёт пару запросов в час, больше — уже чьи-то фокусы

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      // Сообщения от Telegram. Настоящий Telegram кладёт SETUP_KEY в заголовок, остальных не пускаем
      if (url.pathname === '/tg' && request.method === 'POST') {
        if (!env.SETUP_KEY || !safeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', env.SETUP_KEY)) return new Response('forbidden', { status: 403 });
        await onUpdate(await request.json(), env);
        return new Response('ok');
      }

      // Один раз после развёртывания: /setup?key=SETUP_KEY — бот узнаёт, куда слать сообщения
      if (url.pathname === '/setup') {
        if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.SETUP_KEY || '')) return json({ error: 'SETUP_KEY должен быть из 32+ латинских букв, цифр, _ или -' }, 500);
        if (!safeEqual(url.searchParams.get('key') || '', env.SETUP_KEY)) return json({ error: 'неверный ключ' }, 403);
        const r = await tg(env, 'setWebhook', { url: url.origin + '/tg', secret_token: env.SETUP_KEY, allowed_updates: ['message'], drop_pending_updates: true });
        await tg(env, 'setMyCommands', { commands: [{ command: 'stop', description: 'Больше не напоминать' }] });
        return json({ ok: r.ok, description: r.description });
      }

      if (url.pathname === '/info') {
        const me = await tg(env, 'getMe', {});
        return json({ bot: me.ok ? me.result.username : null });
      }

      if (url.pathname === '/status') {
        const token = cleanToken(url.searchParams.get('token'));
        if (!token) return json({ error: 'нет ключа' }, 400);
        const link = await env.DB.prepare('SELECT chat_id FROM links WHERE token = ?').bind(token).first();
        return json({ linked: !!link });
      }

      if (url.pathname === '/sync' && request.method === 'POST') {
        const body = await request.json();
        const token = cleanToken(body.token);
        if (!token) return json({ error: 'нет ключа' }, 400);
        const link = await env.DB.prepare('SELECT chat_id, sync_count, sync_window FROM links WHERE token = ?').bind(token).first();
        if (!link) return json({ linked: false }, 404);
        const now = Date.now();
        const fresh = now - (link.sync_window || 0) > 3600 * 1000;
        if (!fresh && (link.sync_count || 0) >= SYNC_PER_HOUR) return json({ error: 'слишком часто, попробуй через час' }, 429);
        await env.DB.prepare('UPDATE links SET sync_count = ?, sync_window = ? WHERE token = ?')
          .bind(fresh ? 1 : (link.sync_count || 0) + 1, fresh ? now : link.sync_window, token).run();
        const list = (Array.isArray(body.reminders) ? body.reminders : [])
          .filter((r) => r && Number.isFinite(+r.at) && +r.at > now && +r.at < now + MAX_AHEAD && typeof r.text === 'string')
          .slice(0, MAX_REMINDERS);
        // Старые напоминания устройства заменяются новыми целиком: время выхода могло сдвинуться
        await env.DB.batch([
          env.DB.prepare('DELETE FROM reminders WHERE token = ?').bind(token),
          ...list.map((r) => env.DB.prepare('INSERT INTO reminders (token, at, text) VALUES (?, ?, ?)').bind(token, Math.round(+r.at), cleanText(r.text))),
        ]);
        return json({ linked: true, count: list.length });
      }

      if (url.pathname === '/unlink' && request.method === 'POST') {
        const token = cleanToken((await request.json()).token);
        if (!token) return json({ error: 'нет ключа' }, 400);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM reminders WHERE token = ?').bind(token),
          env.DB.prepare('DELETE FROM links WHERE token = ?').bind(token),
        ]);
        return json({ ok: true });
      }

      return json({ error: 'нет такого адреса' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },

  // Раз в минуту: отправить всё, чему пора
  async scheduled(event, env, ctx) {
    const now = Date.now();
    const { results } = await env.DB.prepare(
      'SELECT r.id, r.text, l.chat_id FROM reminders r JOIN links l ON l.token = r.token WHERE r.at <= ? AND r.at > ? ORDER BY r.at LIMIT 100'
    ).bind(now, now - LATE).all();
    for (const r of results) {
      const res = await tg(env, 'sendMessage', { chat_id: r.chat_id, text: r.text, disable_web_page_preview: true });
      // Человек заблокировал бота: убираем его привязку, чтобы не стучаться каждый раз
      if (!res.ok && res.error_code === 403) await env.DB.prepare('DELETE FROM links WHERE chat_id = ?').bind(r.chat_id).run();
    }
    await env.DB.prepare('DELETE FROM reminders WHERE at <= ?').bind(now).run();
  },
};

async function onUpdate(update, env) {
  const msg = update.message;
  if (!msg || !msg.text || !msg.chat) return;
  const chat = msg.chat.id, text = msg.text.trim();

  if (text.startsWith('/start')) {
    const token = cleanToken(text.split(/\s+/)[1]);
    if (!token) {
      await tg(env, 'sendMessage', { chat_id: chat, text: 'Чтобы я напоминал о выходе, открой «Успею» → Настройки → «Напоминать в Telegram». Оттуда ссылка приведёт сюда уже с ключом твоего телефона.' });
      return;
    }
    await env.DB.prepare('INSERT INTO links (token, chat_id, created) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET chat_id = excluded.chat_id')
      .bind(token, chat, Date.now()).run();
    await tg(env, 'sendMessage', { chat_id: chat, text: 'Готово, напоминания о выходе будут приходить сюда.\n\nВремя пересчитывается, когда открываешь «Успею». Если поменялась погода или расписание, просто открой приложение, и я получу новое время.\n\nОтключить: /stop' });
    return;
  }

  if (text === '/stop') {
    const { results } = await env.DB.prepare('SELECT token FROM links WHERE chat_id = ?').bind(chat).all();
    await env.DB.batch([
      ...results.map((r) => env.DB.prepare('DELETE FROM reminders WHERE token = ?').bind(r.token)),
      env.DB.prepare('DELETE FROM links WHERE chat_id = ?').bind(chat),
    ]);
    await tg(env, 'sendMessage', { chat_id: chat, text: 'Больше не напоминаю. Включить снова можно в настройках «Успею».' });
  }
}

// Текст напоминания: без ссылок и @упоминаний, чтобы укравший ключ не мог прислать от имени бота фишинг
function cleanText(t) {
  return String(t)
    .replace(/(https?:\/\/|www\.)\S+/gi, '')
    .replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(ru|su|com|org|net|me|io|co|xyz|info|site|online|link|app|dev|top|pro|cc|ly|gl|gg|to|tk)\b\S*/gi, '')
    .replace(/[\p{L}\d-]+\.(рф|рус|онлайн|сайт)(?![\p{L}\d])\S*/giu, '')
    .replace(/@[A-Za-z0-9_]{4,}/g, '')
    .slice(0, 1500);
}

// Сравнение секретов за одинаковое время, чтобы его нельзя было подобрать по скорости ответа
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Ключ устройства: 16–64 символа, как разрешает параметр start у Telegram
function cleanToken(t) {
  const s = String(t || '');
  return /^[A-Za-z0-9_-]{16,64}$/.test(s) ? s : null;
}

async function tg(env, method, body) {
  const res = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}
