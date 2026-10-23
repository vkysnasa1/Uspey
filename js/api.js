/* Успею — запросы к внешним сервисам (ключи не нужны).
   Open-Meteo — погода, Nominatim (OpenStreetMap) — поиск адреса, OSRM — маршрут на машине. */
(function (root) {
  'use strict';

  const CACHE_KEY = 'uspeyu.weather';

  async function getJSON(url, timeoutMs, tries) {
    let lastErr;
    for (let i = 0; i < (tries || 2); i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error('Сервис ответил ошибкой ' + res.status);
        return await res.json();
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error('Сервис не ответил вовремя') : e;
      } finally {
        clearTimeout(timer);
      }
      if (i < (tries || 2) - 1) await new Promise((r) => setTimeout(r, 700));
    }
    throw lastErr;
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
  }

  // Возвращает { forecast, fetchedAt, stale }
  async function forecast(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
      '&hourly=temperature_2m,apparent_temperature,precipitation,snowfall,weather_code,wind_speed_10m,wind_gusts_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum' +
      '&wind_speed_unit=ms&timezone=auto&forecast_days=7';
    const key = lat.toFixed(2) + ',' + lon.toFixed(2);
    try {
      const json = await getJSON(url, 10000, 2);
      const parsed = root.Core.parseForecast(json);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key, json, at: Date.now() })); } catch (e) { /* место закончилось */ }
      return { forecast: parsed, fetchedAt: Date.now(), stale: false };
    } catch (err) {
      const c = readCache();
      if (c && c.key === key) return { forecast: root.Core.parseForecast(c.json), fetchedAt: c.at, stale: true, error: err.message };
      throw err;
    }
  }

  async function geocode(query) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=ru&countrycodes=ru' +
      '&viewbox=37.35,54.32,37.85,54.08&q=' + encodeURIComponent(query);
    const list = await getJSON(url, 10000, 1);
    return list.map((x) => ({ name: x.display_name.split(', ').slice(0, 4).join(', '), lat: +x.lat, lon: +x.lon }));
  }

  async function reverse(lat, lon) {
    try {
      const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&lat=' + lat + '&lon=' + lon;
      const x = await getJSON(url, 8000, 1);
      return x.display_name ? x.display_name.split(', ').slice(0, 3).join(', ') : 'Моё местоположение';
    } catch (e) { return 'Моё местоположение'; }
  }

  // Время в пути на машине без пробок, минуты
  async function driveMinutes(from, to) {
    const url = 'https://router.project-osrm.org/route/v1/driving/' + from.lon + ',' + from.lat + ';' + to.lon + ',' + to.lat + '?overview=false';
    const json = await getJSON(url, 12000, 2);
    if (json.code !== 'Ok' || !json.routes || !json.routes[0]) throw new Error('Маршрут не найден');
    return { minutes: Math.max(1, Math.ceil(json.routes[0].duration / 60)), km: Math.round(json.routes[0].distance / 100) / 10 };
  }


  /* ---- Расписание ТулГУ ----
     Сайт tulsu.ru не разрешает запросы с других сайтов (нет CORS), поэтому пробуем по очереди:
     напрямую → свой прокси из настроек → r.jina.ai → api.allorigins.win. */
  const TULSU = 'https://tulsu.ru/schedule/queries/';

  async function getText(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('ошибка ' + res.status);
      return await res.text();
    } catch (e) {
      throw e.name === 'AbortError' ? new Error('нет ответа') : e;
    } finally { clearTimeout(timer); }
  }
  // r.jina.ai отдаёт страницу с заголовком «Markdown Content:» — вырезаем сам JSON
  function fromJina(text) {
    const k = text.indexOf('Markdown Content:');
    return k >= 0 ? text.slice(k + 17).trim() : text.trim();
  }

  async function tulsuGet(path, proxy) {
    const target = TULSU + path;
    const routes = [[target, (t) => t]];
    if (proxy) routes.push([proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(target)) : proxy.replace(/\/?$/, '/') + '?url=' + encodeURIComponent(target), (t) => t]);
    routes.push(['https://r.jina.ai/' + target, fromJina]);
    routes.push(['https://api.allorigins.win/raw?url=' + encodeURIComponent(target), (t) => t]);
    let lastErr;
    for (const [url, pick] of routes) {
      try { return JSON.parse(pick(await getText(url, 25000))); } catch (e) { lastErr = e; }
    }
    throw new Error('Сайт расписания ТулГУ недоступен (' + (lastErr ? lastErr.message : 'нет связи') + '). Попробуй позже или укажи свой прокси в настройках');
  }

  // Всё расписание группы на семестр: { field, from, to, lessons }
  async function tulsuSchedule(group, proxy) {
    const g = String(group).trim();
    const dates = await tulsuGet('GetDates.php?search_value=' + encodeURIComponent(g), proxy);
    if (!dates || dates.error || !dates.MIN_DATE) throw new Error(dates && dates.error ? dates.error : 'Группа ' + g + ' не найдена');
    const field = dates.SEARCH_FIELD || 'GROUP_P';
    const raw = await tulsuGet('GetSchedule.php?search_field=' + encodeURIComponent(field) + '&search_value=' + encodeURIComponent(g), proxy);
    const lessons = root.Core.parseTulsu(raw);
    if (!lessons.length) throw new Error('Для группы ' + g + ' расписание пустое');
    return { field, from: dates.MIN_DATE, to: dates.MAX_DATE, lessons };
  }

  async function tulsuSuggest(term, proxy) {
    try { return (await tulsuGet('GetDictionaries.php?term=' + encodeURIComponent(term), proxy)).map((x) => x.value); } catch (e) { return []; }
  }

  /* ---- Общественный транспорт: маршруты из OpenStreetMap (Overpass API) ----
     Один запрос на адрес дома: все маршруты автобусов, троллейбусов, трамваев и маршруток,
     у которых есть остановка в 800 м от дома, со всеми их остановками по порядку. */
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  async function transitNetwork(home) {
    const p = home.lat.toFixed(5) + ',' + home.lon.toFixed(5);
    const near = '(node(around:800,' + p + ')[highway=bus_stop];node(around:800,' + p + ')[public_transport=platform];node(around:800,' + p + ')[public_transport=stop_position];)->.a;';
    const q = '[out:json][timeout:90];' + near + 'rel(bn.a)[type=route][route~"^(bus|trolleybus|tram|share_taxi|minibus)$"]->.r;.r out body;node(r.r);out;';
    let lastErr;
    for (const ep of OVERPASS.concat(OVERPASS)) { // каждый сервер по два раза: они бывают перегружены (502)
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 95000);
      try {
        const res = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
        if (!res.ok) throw new Error('ошибка ' + res.status);
        const json = await res.json();
        return parseNetwork(json);
      } catch (e) { lastErr = e.name === 'AbortError' ? new Error('нет ответа') : e; await new Promise((r) => setTimeout(r, 2000)); } finally { clearTimeout(timer); }
    }
    throw new Error('Не удалось получить маршруты транспорта (' + (lastErr ? lastErr.message : 'нет связи') + ')');
  }
  function parseNetwork(json) {
    const nodes = {};
    json.elements.filter((e) => e.type === 'node').forEach((n) => { nodes[n.id] = n; });
    const routes = [];
    json.elements.filter((e) => e.type === 'relation').forEach((r) => {
      const stops = [];
      r.members.forEach((m) => {
        if (m.type !== 'node' || !nodes[m.ref]) return;
        const n = nodes[m.ref], t = n.tags || {};
        const isStop = /^(stop|platform)/.test(m.role || '') || t.highway === 'bus_stop' || t.public_transport;
        if (!isStop) return;
        const s = { name: t.name || '', lat: +n.lat.toFixed(5), lon: +n.lon.toFixed(5) };
        const last = stops[stops.length - 1];
        // stop_position и платформа одной остановки идут подряд — склеиваем
        if (last && root.Core.distanceM(last, s) < 60) { if (!last.name) last.name = s.name; return; }
        stops.push(s);
      });
      if (stops.length >= 2) routes.push({ type: r.tags.route, ref: r.tags.ref || '', name: r.tags.name || '', stops });
    });
    return { routes, at: Date.now() };
  }

  root.Api = { forecast, geocode, reverse, driveMinutes, tulsuSchedule, tulsuSuggest, transitNetwork };
})(window);
