// Успею — Telegram-бот напоминаний о выходе (Cloudflare Worker + база D1, бесплатно).
//
// Приложение само считает время выхода и раз в какое-то время присылает сюда готовые
// напоминания: «в 7:05 написать "Пора выходить"». Бот только хранит их и отправляет вовремя.
// Адресов, группы и настроек здесь нет: только id чата в Telegram, случайный ключ устройства
// и тексты напоминаний.
//
// Переменные окружения (Settings → Variables): BOT_TOKEN (секрет от @BotFather),
// SETUP_KEY (любая длинная строка, секрет), ORIGIN (адрес сайта, например https://vkysnasa1.github.io).
// Привязка базы: DB → D1 с таблицами из schema.sql. Cron: "* * * * *".

const MAX_REMINDERS = 40;               // на одно устройство: ~2 в день на 8 дней вперёд
const MAX_AHEAD = 9 * 24 * 3600 * 1000; // дальше 9 дней не храним
const LATE = 15 * 60 * 1000;            // если бот проспал больше 15 минут, старое напоминание уже не нужно

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
      // Сообщения от Telegram. Путь с секретом, чтобы чужие не слали поддельные апдейты
      if (url.pathname === '/tg/' + env.SETUP_KEY && request.method === 'POST') {
        await onUpdate(await request.json(), env);
        return new Response('ok');
      }

      // Один раз после развёртывания: /setup?key=SETUP_KEY — бот узнаёт, куда слать сообщения
      if (url.pathname === '/setup') {
        if (url.searchParams.get('key') !== env.SETUP_KEY) return json({ error: 'неверный ключ' }, 403);
        const hook = url.origin + '/tg/' + env.SETUP_KEY;
        const r = await tg(env, 'setWebhook', { url: hook, allowed_updates: ['message'] });
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
        const link = await env.DB.prepare('SELECT chat_id FROM links WHERE token = ?').bind(token).first();
        if (!link) return json({ linked: false }, 404);
        const now = Date.now();
        const list = (Array.isArray(body.reminders) ? body.reminders : [])
          .filter((r) => r && Number.isFinite(+r.at) && +r.at > now && +r.at < now + MAX_AHEAD && typeof r.text === 'string')
          .slice(0, MAX_REMINDERS);
        // Старые напоминания устройства заменяются новыми целиком: время выхода могло сдвинуться
        await env.DB.batch([
          env.DB.prepare('DELETE FROM reminders WHERE token = ?').bind(token),
          ...list.map((r) => env.DB.prepare('INSERT INTO reminders (token, at, text) VALUES (?, ?, ?)').bind(token, Math.round(+r.at), r.text.slice(0, 1500))),
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
