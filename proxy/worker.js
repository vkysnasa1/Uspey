// Прокси для расписания ТулГУ на Cloudflare Workers (бесплатно).
// dash.cloudflare.com → Workers → Create → вставить этот код → Deploy.
// В настройках «Успею» указать: https://ИМЯ.workers.dev/?url={url}
export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get('url') || '';
    if (!target.startsWith('https://tulsu.ru/schedule/queries/')) {
      return new Response('Only tulsu.ru schedule', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 Uspeyu' }, cf: { cacheTtl: 1800 } });
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
  },
};
