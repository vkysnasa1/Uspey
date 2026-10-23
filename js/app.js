/* Успею — интерфейс */
(function () {
  'use strict';
  const C = window.Core, A = window.Api;
  const KEY = 'uspeyu.v1';
  const UNI = { name: 'ТулГУ, главный корпус (пр. Ленина, 92)', lat: 54.1669, lon: 37.5870 };

  /* ---------- состояние ---------- */
  function semesterDefault() {
    const d = new Date(), y = d.getFullYear(), m = d.getMonth();
    if (m >= 8) return y + '-09-01';
    if (m === 0) return (y - 1) + '-09-01';
    return y + '-02-01';
  }
  function defaults() {
    return {
      schedule: [],
      tulsu: null,
      settings: {
        proxy: '',
        mode: 'bus', home: null, places: [], placeId: null, uni: Object.assign({}, UNI),
        earlyMin: 10, errorPct: 10, notifyMin: 10, notificationsOn: false,
        semesterStart: semesterDefault(),
        pairTimes: C.DEFAULT_PAIRS.map((p) => p.slice()),
        bus: { auto: true, network: null, plans: {}, number: '', walkTo: 7, stopReserve: 2, ride: 25, walkFrom: 5, useInterval: true, times: '', first: '06:00', last: '22:30', every: 15 },
        car: { manualMin: 20, traffic: 'auto', parkingAuto: true, parking: 7, routeMin: null, routeKm: null, routeFor: '', routes: {} },
      },
    };
  }
  function load() {
    const d = defaults();
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object') {
        if (Array.isArray(s.schedule)) d.schedule = s.schedule;
        if (s.tulsu && Array.isArray(s.tulsu.lessons)) d.tulsu = s.tulsu;
        const st = s.settings || {};
        Object.assign(d.settings, st);
        d.settings.bus = Object.assign(defaults().settings.bus, st.bus);
        d.settings.car = Object.assign(defaults().settings.car, st.car);
        if (!Array.isArray(d.settings.places)) d.settings.places = [];
        if (d.settings.home && !d.settings.places.length) { // старые сохранения: один адрес → «Дом»
          const id = 'p' + Date.now().toString(36);
          d.settings.places.push({ id, label: 'Дом', name: d.settings.home.name, lat: d.settings.home.lat, lon: d.settings.home.lon });
          d.settings.placeId = id;
          d.settings.originLabel = 'Дом';
        }
        if (st.car && st.car.parkingAuto === undefined) { d.settings.car.traffic = 'auto'; d.settings.car.parkingAuto = true; } // старые сохранения
        if (!Array.isArray(d.settings.pairTimes) || d.settings.pairTimes.length !== 6) d.settings.pairTimes = defaults().settings.pairTimes;
      }
    } catch (e) { /* повреждённые данные — начинаем заново */ }
    return d;
  }
  let S = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Не удалось сохранить: память браузера заполнена'); }
  }

  const allLessons = () => S.schedule.concat(S.tulsu ? S.tulsu.lessons : []);

  const W = { forecast: null, fetchedAt: null, stale: false, error: null, loading: false };

  /* ---------- помощники ---------- */
  const $ = (sel) => document.querySelector(sel);
  function h(tag, props) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach((k) => append(el, k)); return; }
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function deg(t) { if (typeof t !== 'number') return '—'; const r = Math.round(t); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r) + '°'; }
  function sameDay(a, b) { return C.ymd(a) === C.ymd(b); }
  function dayLabel(date) {
    const now = new Date();
    if (sameDay(date, now)) return 'Сегодня';
    if (sameDay(date, C.addDays(now, 1))) return 'Завтра';
    return date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
  }
  function num(v, fallback) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : fallback; }
  function field(label, input, hint) { return h('label', { class: 'field' }, label, input, hint ? h('span', { class: 'hint' }, hint) : null); }
  function numInput(obj, key, min, max, onDone) {
    return h('input', {
      type: 'number', inputmode: 'numeric', min, max, value: obj[key],
      onchange: (e) => { obj[key] = Math.min(max, Math.max(min, num(e.target.value, obj[key]))); e.target.value = obj[key]; save(); if (onDone) onDone(); },
    });
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* ---------- вкладки ---------- */
  const TABS = ['home', 'pairs', 'road', 'settings'];
  let tab = 'home';
  function show(name) {
    if (!TABS.includes(name)) name = 'home';
    tab = name;
    TABS.forEach((t) => { $('#view-' + t).hidden = t !== name; });
    document.querySelectorAll('.tabbar button').forEach((b) => {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    render();
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    window.scrollTo(0, 0);
  }
  function render() {
    ({ home: renderHome, pairs: renderPairs, road: renderRoad, settings: renderSettings })[tab]();
    $('#top-date').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /* ---------- СЕГОДНЯ ---------- */
  function renderHome() {
    const root = $('#view-home');
    root.replaceChildren();
    if (!allLessons().length) {
      root.append(h('div', { class: 'plate quiet' },
        h('p', { class: 'plate-lead' }, 'Введи номер группы — и я посчитаю, во сколько выходить'),
        h('p', { class: 'muted', style: 'margin-top:8px' }, 'Расписание загрузится с сайта ТулГУ и сохранится на этом устройстве.'),
        h('div', { class: 'btn-row', style: 'margin-top:14px' },
          h('button', { class: 'btn', type: 'button', onclick: () => show('pairs') }, 'Указать группу'))));
      root.append(weatherPanel(null));
      return;
    }
    const now = new Date();
    const trips = C.upcomingTrips(now, allLessons(), S.settings, W.forecast, 8);
    const lp = learnPanel(C.planTrip(now, allLessons(), S.settings, W.forecast));
    if (lp) root.append(lp);
    if (!trips.length) {
      root.append(h('div', { class: 'plate quiet' },
        h('p', { class: 'plate-lead' }, 'На ближайшую неделю пар нет'),
        h('p', { class: 'muted', style: 'margin-top:8px' }, 'Проверь расписание и дату начала семестра — от неё считается чётность недели.')));
      root.append(weatherPanel(null));
      return;
    }
    const t = trips[0];
    ensureRoutes(trips);
    const chips = placeChips(); if (chips) root.append(chips);
    root.append(hero(t, now));
    if (t.status === 'ok') root.append(stepsPanel(t));
    root.append(weatherPanel(t));
    root.append(remindPanel());
    if (trips.length > 1) root.append(weekPanel(trips.slice(1)));
  }

  function hero(t, now) {
    const pairLine = 'к ' + t.first.pair + ' паре в ' + C.fmt(t.first.start) + (t.first.subject ? ', ' + t.first.subject : '');
    if (t.status !== 'ok') {
      const msg = {
        'no-route': ['Укажи, откуда едешь', 'Нужен адрес дома или примерное время в пути на машине.', 'road'],
        'no-bus': ['Добавь расписание автобуса', 'Укажи время отправления с твоей остановки или интервал движения.', 'road'],
        'no-bus-fits': ['Ни один автобус не успевает', 'Самый ранний автобус в ' + C.fmt(t.earliest || 0) + ' приедет позже, чем нужно. Проверь время в пути или расписание.', 'road'],
      }[t.status];
      return h('div', { class: 'plate quiet' },
        h('p', { class: 'muted', style: 'margin:0 0 4px' }, dayLabel(t.date) + ' ' + pairLine),
        h('p', { class: 'plate-lead' }, msg[0]),
        h('p', { class: 'muted', style: 'margin-top:8px' }, msg[1]),
        h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { class: 'btn', type: 'button', onclick: () => show(msg[2]) }, 'Открыть «Дорогу»')));
    }
    const today = sameDay(t.date, now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let count = null;
    if (today) {
      const left = t.leave - nowMin;
      if (left > 0) count = h('p', { class: 'plate-count' }, 'Осталось ' + C.duration(left));
      else if (left > -1) count = h('p', { class: 'plate-count' }, 'Пора выходить');
      else count = h('p', { class: 'plate-count late' }, 'Время выхода прошло ' + C.duration(-left) + ' назад — поторопись');
    }
    return h('div', { class: 'plate' },
      h('p', { class: 'plate-lead' }, dayLabel(t.date) + ' выходи в'),
      h('div', { class: 'plate-time' }, h('time', null, C.fmt(t.leave))),
      h('p', { class: 'plate-for' }, pairLine.replace(/^к/, 'К') + (t.first.room ? ', ауд. ' + t.first.room : '')),
      count,
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
        t.delay.minutes ? h('span', { class: 'chip' }, '+' + t.delay.minutes + ' мин: ' + t.delay.reasons.join(', ')) : null,
        t.traffic && t.traffic >= 1.3 ? h('span', { class: 'chip' }, 'пробки ×' + String(t.traffic).replace('.', ',')) : null,
        t.margin ? h('span', { class: 'chip' }, 'запас ' + t.margin + ' мин') : null));
  }

  function stepsPanel(t) {
    const list = h('ol', { class: 'steps' }, t.steps.map((s) =>
      h('li', null, h('time', null, C.fmt(s.t)), h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', null, s.text))));
    const p = h('div', { class: 'panel' }, h('h2', null, t.mode === 'car' ? 'Дорога на машине' : t.auto ? (t.auto.type === 'walk' ? 'Дорога пешком' : 'Дорога на транспорте') : 'Дорога на автобусе'), list);
    if (t.backup) p.append(h('p', { class: 'backup' }, 'С запасом: рейс в ' + C.fmt(t.backup.bus) + ', выйти в ' + C.fmt(t.backup.leave)));
    return p;
  }

  function weatherPanel(t) {
    const p = h('div', { class: 'panel' }, h('h2', null, 'Погода и одежда'));
    if (!W.forecast) {
      if (W.loading) p.append(h('p', { class: 'muted' }, 'Загружаю прогноз…'));
      else {
        p.append(h('p', null, W.error ? 'Не удалось получить прогноз: ' + W.error + '.' : 'Прогноза пока нет.'));
        p.append(h('button', { class: 'btn ghost small', type: 'button', onclick: loadWeather }, 'Обновить прогноз'));
      }
      return p;
    }
    const cur = W.forecast.current;
    p.append(h('div', { class: 'wx-now' },
      h('span', { class: 'wx-temp' }, deg(cur.temp)),
      h('span', null, C.describe(cur.code) + ', ощущается ' + deg(cur.feels) + ', ветер ' + Math.round(cur.wind || 0) + ' м/с')));
    const place = (S.settings.home || S.settings.uni).name;
    p.append(h('p', { class: 'small muted', style: 'margin:6px 0 0' }, 'Сейчас: ' + place));

    let w = t && t.weather;
    if (!w) {
      const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
      w = C.commuteWeather(W.forecast, n, m, m + 60);
    }
    if (w) {
      if (t && t.weather) p.append(h('p', { style: 'margin:12px 0 0' },
        h('b', null, 'По дороге: '), C.describe(w.code).toLowerCase() + ', ощущается ' + deg(w.minFeels)));
      const c = C.clothing(w);
      if (c) p.append(h('div', { class: 'wear' }, h('p', null, c.main), c.extra.length ? h('ul', null, c.extra.map((x) => h('li', null, x))) : null));
      const warn = C.warnings(w);
      if (warn.length) p.append(h('ul', { class: 'warn' }, warn.map((x) => h('li', null, x))));
    }
    if (W.stale) p.append(h('p', { class: 'hint', style: 'margin-top:10px' },
      'Нет связи — показан прогноз от ' + new Date(W.fetchedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
    return p;
  }

  function remindPanel() {
    const on = S.settings.notificationsOn && 'Notification' in window && Notification.permission === 'granted';
    return h('div', { class: 'panel' },
      h('h2', null, 'Напоминания'),
      h('p', { class: 'small muted' }, 'Календарь телефона напомнит за ' + S.settings.notifyMin + ' мин до выхода, даже если сайт закрыт.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: exportICS }, 'Добавить в календарь'),
        on ? null : h('button', { class: 'btn ghost', type: 'button', onclick: enableNotifications }, 'Включить уведомления')));
  }

  function weekPanel(trips) {
    return h('div', { class: 'panel' }, h('h2', null, 'Дальше на неделе'),
      h('ul', { class: 'week' }, trips.map((t) => h('li', null,
        h('span', null, C.DAYS_SHORT[C.dayIndex(t.date)] + ', ' + t.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })),
        t.status === 'ok'
          ? h('span', null, 'выйти в ', h('b', null, C.fmt(t.leave)), ' — ' + t.first.pair + ' пара')
          : h('span', { class: 'muted' }, t.first.pair + ' пара в ' + C.fmt(t.first.start))))));
  }

  /* ---------- ПАРЫ ---------- */
  const SAMPLE = [
    { day: 0, pair: 2, subject: 'Операционные системы и среды (лекция)', room: 'Гл.-403', week: 'all' },
    { day: 0, pair: 3, subject: 'Практикум по программированию от «Яндекса» (лекция)', room: 'Гл.-403', week: 'all' },
    { day: 0, pair: 4, subject: 'Физика (практика)', room: '9-306', week: 'all' },
    { day: 1, pair: 1, subject: 'Практикум «Яндекса» (лаб.)', room: 'Гл.-104', week: 'all' },
    { day: 1, pair: 2, subject: 'Введение в математический анализ (практика)', room: '12-205', week: 'all' },
    { day: 1, pair: 3, subject: 'Физическая культура и спорт', room: 'Спорткорп-18', week: 'all' },
    { day: 1, pair: 4, subject: 'Архитектура вычислительных систем (лекция)', room: 'Гл.-431', week: 'all' },
    { day: 1, pair: 5, subject: 'Программирование (лекция)', room: 'Гл.-431', week: 'all' },
    { day: 2, pair: 4, subject: 'Практикум «Яндекса» (лаб.)', room: 'Гл.-104', week: 'all' },
    { day: 3, pair: 1, subject: 'Программирование (лаб.)', room: '9-601-2', week: 'all' },
    { day: 3, pair: 2, subject: 'Операционные системы и среды (лаб.)', room: 'Гл.-104', week: 'all' },
    { day: 3, pair: 3, subject: 'Операционные системы и среды (лаб.)', room: 'Гл.-104', week: 'all' },
    { day: 3, pair: 4, subject: 'Введение в математический анализ (лекция)', room: '8-100', week: 'all' },
    { day: 3, pair: 5, subject: 'Экономика и предпринимательство (практика)', room: '9-406', week: 'all' },
    { day: 4, pair: 3, subject: 'Физическая культура и спорт', room: 'Спорткорп-28', week: 'all' },
    { day: 4, pair: 4, subject: 'Правоведение и противодействие коррупции (лекция)', room: '2-Л2', week: 'all' },
    { day: 4, pair: 5, subject: 'Управление проектной деятельностью (практика)', room: '3-401', week: 'all' },
    { day: 5, pair: 1, subject: 'Управление проектной деятельностью (лекция)', room: '2-Л2', week: 'all' },
    { day: 5, pair: 2, subject: 'Экономика и предпринимательство (лекция)', room: '9-201', week: 'all' },
    { day: 5, pair: 3, subject: 'Архитектура вычислительных систем (лаб.)', room: 'Гл.-104', week: 'all' },
  ];
  const WEEK_NAME = { all: 'каждую неделю', odd: 'нечётная', even: 'чётная' };

  /* ---- расписание ТулГУ ---- */
  let tulsuBusy = false;
  async function loadTulsu(group, silent) {
    const g = String(group || '').trim();
    if (!/^[0-9А-Яа-яЁё\-]{3,15}$/.test(g)) { if (!silent) toast('Введи номер группы, например 221351'); return; }
    if (tulsuBusy) return;
    tulsuBusy = true;
    if (!silent) { toast('Загружаю расписание группы ' + g + '…'); if (tab === 'pairs') renderPairs(); }
    try {
      const r = await A.tulsuSchedule(g, S.settings.proxy);
      S.tulsu = { group: g, field: r.field, from: r.from, to: r.to, lessons: r.lessons, fetchedAt: Date.now() };
      save();
      if (!silent) toast('Загружено занятий: ' + r.lessons.length);
      scheduleNotifications();
    } catch (e) {
      if (!silent) toast(e.message);
      else if (S.tulsu) S.tulsu.error = e.message;
    } finally {
      tulsuBusy = false;
      if (tab === 'pairs') renderPairs(); else if (tab === 'home') renderHome();
    }
  }

  function tulsuPanel() {
    const t = S.tulsu;
    const input = h('input', { type: 'text', inputmode: 'numeric', placeholder: '221351', value: t ? t.group : '', maxlength: 15, autocomplete: 'off', 'aria-label': 'Номер группы' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadTulsu(input.value); } });
    const fmtD = (s) => s ? s.split('-').reverse().slice(0, 2).join('.') : '';
    return h('div', { class: 'panel form' },
      h('h2', null, 'Расписание ТулГУ'),
      h('p', { class: 'hint' }, 'Введи номер группы — пары загрузятся с tulsu.ru/schedule на весь семестр, с аудиториями и преподавателями.'),
      h('div', { style: 'display:flex;gap:8px' }, input,
        h('button', { class: 'btn small', type: 'button', disabled: tulsuBusy, onclick: () => loadTulsu(input.value) }, tulsuBusy ? 'Загрузка…' : t ? 'Обновить' : 'Загрузить')),
      t ? h('p', { class: 'small', style: 'margin:0' }, 'Группа ', h('b', null, t.group), ' — занятий в семестре: ' + t.lessons.length + ' (' + fmtD(t.from) + '–' + fmtD(t.to) + '). Обновлено ' +
        new Date(t.fetchedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.') : null,
      t && t.error ? h('p', { class: 'hint' }, 'Не удалось обновить: ' + t.error + '. Используется сохранённая копия.') : null,
      t ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
        if (confirm('Убрать расписание группы ' + t.group + ' с этого устройства?')) { S.tulsu = null; save(); renderPairs(); scheduleNotifications(); }
      } }, 'Убрать расписание группы') : null);
  }

  function tulsuDays() {
    const box = h('div', { class: 'panel day' }, h('h2', null, 'Ближайшие пары'));
    const now = new Date();
    let shown = 0;
    for (let i = 0; i < 14 && shown < 6; i++) {
      const d = C.addDays(now, i);
      const list = C.classesFor(d, S.tulsu.lessons, S.settings);
      if (!list.length) continue;
      shown++;
      box.append(h('h3', { style: 'margin-top:10px' }, dayLabel(d), h('span', { class: 'muted small' }, d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }))),
        h('ul', { class: 'classes' }, list.map((c) => h('li', null,
          h('span', { class: 'pair-no' }, c.pair),
          h('div', null,
            h('div', { class: 'cls-name' }, c.subject, c.note ? h('span', { class: 'badge' }, c.note) : null),
            h('div', { class: 'cls-meta' }, C.fmt(c.start) + '–' + C.fmt(c.end) + (c.room ? ', ауд. ' + c.room : '') + (c.teacher ? ' · ' + c.teacher : ''))),
          h('span', null)))));
    }
    if (!shown) box.append(h('p', { class: 'muted' }, 'В ближайшие две недели пар нет.'));
    return box;
  }

  function renderPairs() {
    const root = $('#view-pairs');
    root.replaceChildren();
    const n = C.weekNumber(new Date(), S.settings.semesterStart);
    const par = C.weekParity(new Date(), S.settings.semesterStart);
    root.append(tulsuPanel());
    if (S.tulsu) root.append(tulsuDays());
    root.append(h('div', { class: 'panel' },
      h('h2', null, 'Сейчас ' + (par === 'odd' ? 'нечётная' : 'чётная') + ' неделя'),
      h('p', { class: 'small muted', style: 'margin:0' }, n + '-я неделя семестра. ' + (S.tulsu ? 'Ниже можно добавить свои занятия вручную — например, секцию или курсы.' : 'Если группы нет на сайте ТулГУ, добавь пары вручную.'))));

    const f = { day: Math.min(C.dayIndex(new Date()), 5), pair: 1, week: 'all' };
    const subj = h('input', { type: 'text', placeholder: 'Например, Математический анализ', maxlength: 80, autocomplete: 'off' });
    const room = h('input', { type: 'text', placeholder: 'Гл.-403', maxlength: 20, autocomplete: 'off' });
    const daySel = h('select', { onchange: (e) => { f.day = +e.target.value; } },
      C.DAYS.map((d, i) => h('option', { value: i, selected: i === f.day }, d)));
    const pairSel = h('select', { onchange: (e) => { f.pair = +e.target.value; } },
      S.settings.pairTimes.map((p, i) => h('option', { value: i + 1 }, (i + 1) + ' пара, ' + p[0] + '–' + p[1])));
    const weekSel = h('select', { onchange: (e) => { f.week = e.target.value; } },
      ['all', 'odd', 'even'].map((k) => h('option', { value: k }, WEEK_NAME[k][0].toUpperCase() + WEEK_NAME[k].slice(1))));
    root.append(h('form', {
      class: 'panel form',
      onsubmit: (e) => {
        e.preventDefault();
        const name = subj.value.trim();
        if (!name) { toast('Впиши название предмета'); subj.focus(); return; }
        S.schedule.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), day: f.day, pair: f.pair, subject: name, room: room.value.trim(), week: f.week });
        save(); toast('Пара добавлена'); renderPairs(); scheduleNotifications();
      },
    },
    h('h2', null, S.tulsu ? 'Добавить своё занятие' : 'Добавить пару вручную'),
    h('div', { class: 'grid2' }, field('День', daySel), field('Пара', pairSel)),
    field('Предмет', subj),
    h('div', { class: 'grid2' }, field('Аудитория', room), field('Неделя', weekSel)),
    h('button', { class: 'btn', type: 'submit' }, 'Добавить пару')));

    if (!S.schedule.length && !S.tulsu) {
      root.append(h('div', { class: 'panel' },
        h('p', null, 'Расписание пустое. Можно заполнить примером и потом поправить под себя.'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => {
          S.schedule = SAMPLE.map((x, i) => Object.assign({ id: 's' + i }, x)); save(); renderPairs(); toast('Пример добавлен');
        } }, 'Заполнить примером')));
      return;
    }
    C.DAYS.forEach((dname, di) => {
      const list = S.schedule.filter((c) => c.day === di).sort((a, b) => a.pair - b.pair);
      if (!list.length) return;
      root.append(h('div', { class: 'panel day' }, h('h3', null, dname),
        h('ul', { class: 'classes' }, list.map((c) => {
          const tm = S.settings.pairTimes[c.pair - 1] || ['', ''];
          return h('li', null,
            h('span', { class: 'pair-no' }, c.pair),
            h('div', null,
              h('div', { class: 'cls-name' }, c.subject, c.week !== 'all' ? h('span', { class: 'badge' }, WEEK_NAME[c.week]) : null),
              h('div', { class: 'cls-meta' }, tm[0] + '–' + tm[1] + (c.room ? ', ауд. ' + c.room : ''))),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Удалить: ' + c.subject, title: 'Удалить', onclick: () => {
              S.schedule = S.schedule.filter((x) => x !== c); save(); renderPairs(); scheduleNotifications();
            } }, '×'));
        }))));
    });
  }

  /* ---------- ДОРОГА ---------- */
  /* ---- пробки по часам: просмотр и правка ---- */
  let jamKind = 'weekday', jamSel = 15;
  function jamsPanel() {
    const st = S.settings;
    const prof = (st.jams || C.DEFAULT_JAMS)[jamKind];
    const kinds = [['weekday', 'Будни'], ['saturday', 'Суббота'], ['sunday', 'Воскресенье']];
    const color = (b) => (b >= 7 ? '#C8402A' : b >= 4 ? '#E0A21B' : '#3E9B66');
    const bars = h('div', { class: 'jams', role: 'group', 'aria-label': 'Пробки по получасам' });
    for (let s = 12; s <= 43; s++) {
      const b = prof[s];
      bars.append(h('button', { type: 'button', class: 'jam' + (s === jamSel ? ' sel' : ''), title: C.fmt(s * 30) + ' — ' + b + ' б.', 'aria-label': C.fmt(s * 30) + ', ' + b + ' баллов',
        onclick: () => { jamSel = s; renderRoad(); } },
        h('span', { style: 'height:' + Math.max(4, b * 10) + '%;background:' + color(b) })));
    }
    const change = (d) => {
      st.jams = JSON.parse(JSON.stringify(st.jams || C.DEFAULT_JAMS));
      st.jams[jamKind][jamSel] = Math.max(0, Math.min(10, Math.round((st.jams[jamKind][jamSel] + d) * 10) / 10));
      save(); renderRoad(); scheduleNotifications();
    };
    return h('div', { class: 'panel form' },
      h('h2', null, 'Пробки по часам'),
      h('p', { class: 'hint' }, 'В баллах, как у Яндекса: 0 — свободно, 10 — стоит всё. Утром в будни пик в 7:30, к 9:00 уже свободнее, в субботу почти пусто. Нажми на столбик и поправь под свой маршрут. Ещё точнее станет само: после поездки на машине укажи, сколько ехал.'),
      h('div', { class: 'seg', style: 'grid-template-columns:repeat(3,1fr)' }, kinds.map((k) => h('button', { type: 'button', 'aria-pressed': String(k[0] === jamKind), onclick: () => { jamKind = k[0]; renderRoad(); } }, k[1]))),
      bars,
      h('div', { class: 'jam-axis small muted' }, ['6:00', '9:00', '12:00', '15:00', '18:00', '21:00'].map((x) => h('span', null, x))),
      h('div', { style: 'display:flex;gap:10px;align-items:center' },
        h('b', { style: 'min-width:150px' }, C.fmt(jamSel * 30) + '–' + C.fmt(jamSel * 30 + 30) + ': ' + prof[jamSel] + ' б.'),
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Меньше пробок', onclick: () => change(-1) }, '−'),
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Больше пробок', onclick: () => change(1) }, '+'),
        st.jams ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => { st.jams = null; save(); renderRoad(); scheduleNotifications(); } }, 'Сбросить') : null));
  }

  // после поездки на машине: «сколько ехал?» — пробки подстраиваются под реальность
  function learnPanel(t) {
    const st = S.settings, now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    if (!t || t.status !== 'ok' || t.mode !== 'car' || !t.drive || st.jamsAsked === C.ymd(t.date)) return null;
    const arrive = t.leave + t.margin + Math.round(t.drive * t.traffic) + t.delay.minutes;
    if (C.ymd(t.date) !== C.ymd(now) || nowMin < arrive || nowMin > arrive + 240) return null;
    const inp = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 180, placeholder: String(Math.round(t.drive * t.traffic)), 'aria-label': 'Сколько минут ехал' });
    return h('div', { class: 'panel form' },
      h('h2', null, 'Сколько ехал сегодня?'),
      h('p', { class: 'hint' }, 'Выезд в ' + C.fmt(t.leave) + '. По расчёту дорога ≈ ' + Math.round(t.drive * t.traffic) + ' мин. Напиши, сколько вышло на самом деле, — пробки в это время подстроятся.'),
      h('div', { style: 'display:flex;gap:8px' }, inp,
        h('button', { class: 'btn small', type: 'button', onclick: () => {
          const v = +inp.value;
          if (!(v > 0)) { toast('Впиши минуты'); return; }
          st.jams = C.learnJams(st.jams, t.date, t.leave + t.margin, t.drive, Math.max(1, v - t.delay.minutes));
          st.jamsAsked = C.ymd(t.date); save(); toast('Учёл: пробки обновлены'); renderHome();
        } }, 'Сохранить'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { st.jamsAsked = C.ymd(t.date); save(); renderHome(); } }, 'Не ехал')));
  }

  /* ---- мои адреса: Дом, Работа, Общага… ---- */
  const LABELS = ['Дом', 'Работа', 'Общежитие', 'Родители', 'Девушка', 'Друг'];
  const curPlace = () => S.settings.places.find((x) => x.id === S.settings.placeId) || null;
  // маршруты считаются отдельно для каждого адреса и запоминаются в нём
  function stashCache() {
    const pl = curPlace(), st = S.settings;
    if (!pl) return;
    pl.cache = { carRoutes: st.car.routes || {}, plans: st.bus.plans || {}, network: st.bus.network || null, routeMin: st.car.routeMin, routeKm: st.car.routeKm };
  }
  function selectPlace(id, silent) {
    const st = S.settings, pl = st.places.find((x) => x.id === id);
    if (!pl) return;
    stashCache();
    st.placeId = id;
    st.home = { name: pl.name, lat: pl.lat, lon: pl.lon };
    st.originLabel = pl.label;
    const c = pl.cache || {};
    st.car.routes = c.carRoutes || {}; st.car.routeMin = c.routeMin || null; st.car.routeKm = c.routeKm || null;
    st.bus.plans = c.plans || {}; st.bus.network = c.network || null;
    save();
    if (!silent) toast('Едем: ' + pl.label);
    loadWeather();
    render();
    scheduleNotifications();
  }
  function addPlace(label, r) {
    const st = S.settings, name = String(label || '').trim() || 'Адрес ' + (st.places.length + 1);
    const pl = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), label: name.slice(0, 30), name: r.name, lat: r.lat, lon: r.lon };
    st.places.push(pl);
    save();
    selectPlace(pl.id, true);
    toast('Сохранено: ' + pl.label);
  }
  function placeChips() {
    const st = S.settings;
    if (st.places.length < 2) return null;
    return h('div', { class: 'chips', role: 'group', 'aria-label': 'Откуда еду' },
      h('span', { class: 'small muted' }, 'Еду из:'),
      st.places.map((pl) => h('button', { type: 'button', class: 'pchip', 'aria-pressed': String(pl.id === st.placeId), onclick: () => selectPlace(pl.id) }, pl.label)));
  }
  function placesPanel() {
    const st = S.settings;
    const box = h('div', { class: 'place' }, h('h3', null, 'Мои адреса'));
    if (!st.places.length) box.append(h('p', { class: 'hint' }, 'Сохрани адрес и подпиши его — «Дом», «Работа», «Общежитие». Маршрут и время выхода считаются от выбранного.'));
    if (st.places.length) box.append(h('ul', { class: 'classes' }, st.places.map((pl) => h('li', { style: 'grid-template-columns:auto 1fr auto auto' },
      h('input', { type: 'radio', name: 'place', checked: pl.id === st.placeId, 'aria-label': 'Ехать из: ' + pl.label, onchange: () => selectPlace(pl.id) }),
      h('div', { onclick: () => selectPlace(pl.id), style: 'cursor:pointer' }, h('div', { class: 'cls-name' }, pl.label), h('div', { class: 'cls-meta' }, pl.name)),
      h('button', { class: 'icon-btn', type: 'button', title: 'Переименовать', 'aria-label': 'Переименовать: ' + pl.label, onclick: () => {
        const v = prompt('Как подписать адрес?', pl.label);
        if (v && v.trim()) { pl.label = v.trim().slice(0, 30); if (pl.id === st.placeId) st.originLabel = pl.label; save(); renderRoad(); }
      } }, '✎'),
      h('button', { class: 'icon-btn', type: 'button', title: 'Удалить', 'aria-label': 'Удалить: ' + pl.label, onclick: () => {
        if (!confirm('Удалить адрес «' + pl.label + '»?')) return;
        st.places = st.places.filter((x) => x !== pl);
        if (st.placeId === pl.id) { if (st.places[0]) selectPlace(st.places[0].id, true); else { st.placeId = null; st.home = null; } }
        save(); renderRoad(); scheduleNotifications();
      } }, '×')))));

    // добавить адрес
    const used = st.places.map((x) => x.label);
    const lab = h('input', { type: 'text', maxlength: 30, placeholder: 'Подпись, например «Дом»', value: LABELS.find((l) => !used.includes(l)) || '', 'aria-label': 'Подпись адреса' });
    const quick = h('div', { class: 'chips' }, LABELS.map((l) => h('button', { type: 'button', class: 'pchip', onclick: () => { lab.value = l; } }, l)));
    const results = h('ul', { class: 'results', hidden: true });
    const q = h('input', { type: 'search', placeholder: 'Улица и дом, например Болдина 98', autocomplete: 'off', 'aria-label': 'Адрес' });
    async function search() {
      const text = q.value.trim();
      if (text.length < 3) { toast('Введи хотя бы улицу'); return; }
      results.hidden = false;
      results.replaceChildren(h('li', null, h('button', { type: 'button', disabled: true }, 'Ищу…')));
      try {
        const list = await A.geocode(/тул/i.test(text) ? text : text + ', Тула');
        results.replaceChildren();
        if (!list.length) results.append(h('li', null, h('button', { type: 'button', disabled: true }, 'Ничего не нашлось — попробуй написать иначе')));
        list.forEach((r) => results.append(h('li', null, h('button', { type: 'button', onclick: () => addPlace(lab.value, r) }, r.name))));
      } catch (e) {
        results.replaceChildren(h('li', null, h('button', { type: 'button', disabled: true }, 'Поиск не работает: ' + e.message)));
      }
    }
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    box.append(h('details', { open: !st.places.length },
      h('summary', { class: 'btn ghost small', style: 'list-style:none' }, '+ Добавить адрес'),
      h('div', { class: 'form', style: 'margin-top:10px' },
        lab, quick,
        h('div', { style: 'display:flex;gap:8px' }, q, h('button', { class: 'btn small', type: 'button', onclick: search }, 'Найти')),
        results,
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
          if (!navigator.geolocation) { toast('Устройство не умеет определять местоположение'); return; }
          toast('Определяю местоположение…');
          navigator.geolocation.getCurrentPosition(async (pos) => {
            const lat = pos.coords.latitude, lon = pos.coords.longitude;
            addPlace(lab.value, { name: await A.reverse(lat, lon), lat, lon });
          }, () => toast('Нет доступа к местоположению — разреши его в настройках браузера'), { timeout: 12000 });
        } }, 'Я сейчас здесь — сохранить по GPS'))));
    return box;
  }

  function placePicker(title, which, current) {
    const box = h('div', { class: 'place' });
    const results = h('ul', { class: 'results', hidden: true });
    const q = h('input', { type: 'search', placeholder: 'Улица и дом, например Болдина 98', autocomplete: 'off' });
    async function search() {
      const text = q.value.trim();
      if (text.length < 3) { toast('Введи хотя бы улицу'); return; }
      results.hidden = false;
      results.replaceChildren(h('li', null, h('button', { type: 'button', disabled: true }, 'Ищу…')));
      try {
        const list = await A.geocode(/тул/i.test(text) ? text : text + ', Тула');
        results.replaceChildren();
        if (!list.length) results.append(h('li', null, h('button', { type: 'button', disabled: true }, 'Ничего не нашлось — попробуй написать иначе')));
        list.forEach((r) => results.append(h('li', null, h('button', { type: 'button', onclick: () => choose(r) }, r.name))));
      } catch (e) {
        results.replaceChildren(h('li', null, h('button', { type: 'button', disabled: true }, 'Поиск не работает: ' + e.message)));
      }
    }
    function choose(r) {
      S.settings[which] = { name: r.name, lat: r.lat, lon: r.lon };
      save(); toast('Сохранено');
      afterPlaceChange(which);
    }
    box.append(h('h3', null, title),
      h('div', { class: 'place-now' }, current ? current.name : 'Не указано'),
      h('div', { style: 'display:flex;gap:8px' }, q, h('button', { class: 'btn small', type: 'button', onclick: search }, 'Найти')),
      results);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    if (which === 'home') {
      box.append(h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
        if (!navigator.geolocation) { toast('Устройство не умеет определять местоположение'); return; }
        toast('Определяю местоположение…');
        navigator.geolocation.getCurrentPosition(async (pos) => {
          const lat = pos.coords.latitude, lon = pos.coords.longitude;
          choose({ name: await A.reverse(lat, lon), lat, lon });
        }, () => toast('Нет доступа к местоположению — разреши его в настройках браузера'), { timeout: 12000 });
      } }, 'Я сейчас дома — определить по GPS'));
    } else if (current && current.name !== UNI.name) {
      box.append(h('button', { class: 'btn ghost small', type: 'button', onclick: () => choose(UNI) }, 'Вернуть главный корпус'));
    }
    return box;
  }

  function afterPlaceChange(which) {
    S.settings.car.routeMin = null; S.settings.car.routeKm = null; S.settings.car.routes = {};
    S.settings.bus.network = null; S.settings.bus.plans = {};
    save();
    if (which === 'home') loadWeather();
    renderRoad();
    if (S.settings.mode === 'car') calcRoute(true);
  }

  // маршруты на машине до корпусов, где есть пары (считаются один раз и запоминаются)
  let routesBusy = false, transitStatus = '';
  async function ensureRoutes(trips) {
    const st = S.settings;
    if (!st.home || routesBusy) return;
    if (st.mode === 'car') {
      st.car.routes = st.car.routes || {};
      const keys = [...new Set(trips.map((t) => t.building && t.building.key).filter((k) => k && !st.car.routes[k]))];
      if (!keys.length) return;
      routesBusy = true;
      try {
        for (const k of keys) {
          try { const r = await A.driveMinutes(st.home, C.BUILDINGS[k]); st.car.routes[k] = { min: r.minutes, km: r.km }; } catch (e) { break; }
        }
        stashCache(); save();
      } finally { routesBusy = false; if (tab === 'home') renderHome(); scheduleNotifications(); }
      return;
    }
    if (st.bus.auto === false || st.bus.network) return;
    await loadTransit();
  }
  // маршруты транспорта от дома — один раз на адрес, потом из памяти
  async function loadTransit() {
    const st = S.settings;
    if (!st.home || routesBusy) return;
    routesBusy = true; transitStatus = 'Ищу автобусы, троллейбусы и трамваи у дома — до минуты…';
    if (tab === 'road') renderRoad();
    try {
      const net = await A.transitNetwork(st.home);
      st.bus.plans = {};
      Object.keys(C.BUILDINGS).forEach((k) => { const pl = C.transitPlan(net, st.home, C.BUILDINGS[k]); if (pl) st.bus.plans[k] = pl; });
      st.bus.network = { at: net.at, routes: net.routes.length }; // сами маршруты не храним — хватает готовых планов
      stashCache();
      transitStatus = net.routes.length ? '' : 'У дома не нашлось маршрутов в OpenStreetMap — задай автобус вручную.';
      save();
    } catch (e) {
      transitStatus = e.message + '. Пока используется маршрут, заданный вручную.';
    } finally {
      routesBusy = false;
      if (tab === 'home') renderHome(); else if (tab === 'road') renderRoad();
      scheduleNotifications();
    }
  }

  async function calcRoute(silent) {
    const st = S.settings;
    if (!st.home) { if (!silent) toast('Сначала укажи, откуда едешь'); return; }
    try {
      if (!silent) toast('Считаю маршрут…');
      const r = await A.driveMinutes(st.home, st.uni);
      st.car.routeMin = r.minutes; st.car.routeKm = r.km; save();
      if (tab === 'road') renderRoad();
      scheduleNotifications();
    } catch (e) {
      if (!silent) toast('Маршрут не посчитался: ' + e.message + '. Будет использовано время вручную.');
    }
  }

  function renderRoad() {
    const root = $('#view-road');
    root.replaceChildren();
    const st = S.settings;
    const setMode = (m) => { st.mode = m; save(); renderRoad(); scheduleNotifications(); if (m === 'car' && !st.car.routeMin) calcRoute(true); };
    root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Как добираешься' },
      h('button', { type: 'button', 'aria-pressed': String(st.mode === 'bus'), onclick: () => setMode('bus') }, 'Транспорт'),
      h('button', { type: 'button', 'aria-pressed': String(st.mode === 'car'), onclick: () => setMode('car') }, 'Машина')));

    root.append(h('div', { class: 'panel form' },
      placesPanel(),
      placePicker('Остановка у вуза', 'uni', st.uni),
      h('p', { class: 'hint' }, 'Корпус определяется сам по аудитории из расписания (Гл.-403 → главный корпус, 9-306 → корпус 9). Маршрут на машине строится до нужного корпуса, на автобусе добавляется путь пешком от остановки до корпуса.'),
      field('Прийти заранее, мин', numInput(st, 'earlyMin', 0, 60, scheduleNotifications), 'Чтобы спокойно раздеться и найти аудиторию.'),
      field('Погрешность расчёта', h('select', { onchange: (e) => { st.errorPct = +e.target.value; save(); scheduleNotifications(); } },
        [[0, 'Без запаса — впритык'], [10, '+10 % к дороге — обычно'], [20, '+20 % — с запасом'], [30, '+30 % — точно не опоздать']].map((o) => h('option', { value: o[0], selected: +st.errorPct === o[0] }, o[1]))),
        'Расчёт приблизительный: пробки, задержки транспорта, светофоры. Запас добавляется к времени в пути.')));

    const re = () => scheduleNotifications();
    if (st.mode === 'bus') {
      const b = st.bus;
      const plans = b.plans || {};
      const used = [...new Set(C.upcomingTrips(new Date(), allLessons(), st, null, 8).map((t) => t.building && t.building.key).filter(Boolean))];
      root.append(h('div', { class: 'panel form' },
        h('h2', null, 'Маршрут сам'),
        h('label', { style: 'display:flex;gap:10px;align-items:center;font-weight:600' },
          h('input', { type: 'checkbox', checked: b.auto !== false, onchange: (e) => { b.auto = e.target.checked; save(); renderRoad(); scheduleNotifications(); if (b.auto) ensureRoutes([]); } }),
          'Подбирать транспорт до корпуса автоматически'),
        h('p', { class: 'hint' }, 'Остановки и маршруты автобусов, троллейбусов и трамваев берутся из OpenStreetMap. Расписания там нет, поэтому интервал задаётся ниже.'),
        transitStatus ? h('p', { class: 'small' }, transitStatus) : null,
        b.auto !== false && !st.home ? h('p', { class: 'small' }, 'Укажи адрес дома выше — и маршруты найдутся сами.') : null,
        b.auto !== false && b.network ? h('ul', { class: 'week' }, (used.length ? used : ['Гл']).map((k) => {
          const pl = plans[k], bd = C.BUILDINGS[k];
          return h('li', null, h('span', null, bd.name),
            pl ? h('span', null, h('b', null, pl.label), pl.type === 'walk' ? ' — ' + pl.ride + ' мин' : ': «' + pl.from + '» → «' + pl.to + '», ' + (pl.walkTo + pl.ride + pl.walkFrom) + ' мин')
              : h('span', { class: 'muted' }, 'прямого маршрута нет — вручную'));
        })) : null,
        b.auto !== false && b.network ? h('button', { class: 'btn ghost small', type: 'button', disabled: routesBusy, onclick: () => { b.network = null; loadTransit(); } }, 'Пересчитать маршруты') : null));
      if (b.auto !== false && st.home && !b.network && !routesBusy) loadTransit();
      const times = h('textarea', { placeholder: '6:40 6:55 7:10 7:25 7:40', value: b.times, onchange: (e) => { b.times = e.target.value; save(); re(); } });
      const parsedCount = C.busDepartures(b).length;
      root.append(h('div', { class: 'panel form' },
        h('h2', null, b.auto !== false ? 'Интервал и ручной маршрут' : 'Автобус'),
        b.auto !== false ? h('p', { class: 'hint' }, 'Интервал движения используется всегда. Остальные поля — запасной вариант, если до корпуса не нашлось прямого маршрута.') : null,
        field('Номер маршрута', h('input', { type: 'text', value: b.number, maxlength: 20, placeholder: '16', onchange: (e) => { b.number = e.target.value.trim(); save(); } })),
        h('div', { class: 'grid2' },
          field('Идти до остановки, мин', numInput(b, 'walkTo', 0, 60, re)),
          field('Ждать на остановке, мин', numInput(b, 'stopReserve', 0, 20, re))),
        h('div', { class: 'grid2' },
          field('Ехать, мин', numInput(b, 'ride', 1, 180, re)),
          field('От остановки до аудитории, мин', numInput(b, 'walkFrom', 0, 60, re))),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Как задать отправления' },
          h('button', { type: 'button', 'aria-pressed': String(b.useInterval), onclick: () => { b.useInterval = true; save(); renderRoad(); re(); } }, 'Интервал'),
          h('button', { type: 'button', 'aria-pressed': String(!b.useInterval), onclick: () => { b.useInterval = false; save(); renderRoad(); re(); } }, 'Точное время')),
        b.useInterval
          ? h('div', { class: 'grid3' },
            field('Первый', h('input', { type: 'time', value: b.first, onchange: (e) => { b.first = e.target.value; save(); re(); } })),
            field('Последний', h('input', { type: 'time', value: b.last, onchange: (e) => { b.last = e.target.value; save(); re(); } })),
            field('Каждые, мин', numInput(b, 'every', 1, 120, re)))
          : field('Отправления с твоей остановки', times, 'Через пробел или запятую. Сейчас распознано: ' + parsedCount + '.')));
    } else {
      const c = st.car;
      root.append(h('div', { class: 'panel form' },
        h('h2', null, 'Машина'),
        h('p', { style: 'margin:0' }, c.routeMin
          ? 'По маршруту ' + String(c.routeKm).replace('.', ',') + ' км, около ' + c.routeMin + ' мин без пробок.'
          : 'Маршрут не рассчитан — используется время вручную.'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => calcRoute(false) }, 'Рассчитать маршрут по карте'),
        field('Время без пробок вручную, мин', numInput(c, 'manualMin', 1, 180, re), 'Используется, если маршрут не рассчитан.'),
        field('Пробки', h('select', { onchange: (e) => { c.traffic = e.target.value === 'auto' ? 'auto' : +e.target.value; save(); renderRoad(); re(); } },
          [['auto', 'Сам — по времени суток и дню недели'], [1, 'Всегда свободно'], [1.3, 'Всегда средние'], [1.6, 'Всегда сильные']].map((o) => h('option', { value: o[0], selected: String(c.traffic) === String(o[0]) }, o[1]))),
          c.traffic === 'auto' ? 'Пробки по часам — ниже: в будни пик в 7:30 (дорога ≈ в 1,7 раза дольше), к 9:00 уже ≈ 1,2, вечером в 17:30 снова пик, в субботу почти пусто. Автобусы тоже стоят в пробках, трамвай почти нет.' : null),
        h('label', { style: 'display:flex;gap:10px;align-items:center;font-weight:600' },
          h('input', { type: 'checkbox', checked: c.parkingAuto !== false, onchange: (e) => { c.parkingAuto = e.target.checked; save(); renderRoad(); re(); } }),
          'Время на парковку считать самому'),
        c.parkingAuto !== false
          ? h('p', { class: 'hint' }, 'У главного корпуса и на Болдина к 8–10 утра место ищут до 15 минут, рано утром и вечером — 5–6. У дальних корпусов быстрее.')
          : field('Парковка и дойти до аудитории, мин', numInput(c, 'parking', 0, 60, re))));
    }
    if (st.mode === 'car' || st.trafficAuto !== false) root.append(jamsPanel());
  }

  /* ---------- НАСТРОЙКИ ---------- */
  function renderSettings() {
    const root = $('#view-settings');
    root.replaceChildren();
    const st = S.settings;
    const supported = 'Notification' in window;
    const granted = supported && Notification.permission === 'granted';

    root.append(h('div', { class: 'panel form' },
      h('h2', null, 'Уведомления'),
      field('Напомнить до выхода, мин', numInput(st, 'notifyMin', 1, 60, scheduleNotifications)),
      h('p', { class: 'hint' }, !supported ? 'Этот браузер не поддерживает уведомления — используй календарь.'
        : st.notificationsOn && granted ? 'Уведомления включены. Они приходят, пока сайт или приложение открыто в фоне.'
          : Notification.permission === 'denied' ? 'Уведомления запрещены в настройках браузера.' : 'Уведомления выключены.'),
      h('div', { class: 'btn-row' },
        st.notificationsOn && granted
          ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { st.notificationsOn = false; save(); scheduleNotifications(); renderSettings(); } }, 'Выключить уведомления')
          : h('button', { class: 'btn', type: 'button', disabled: !supported, onclick: enableNotifications }, 'Включить уведомления'),
        granted ? h('button', { class: 'btn ghost', type: 'button', onclick: () => notify('Так будет выглядеть напоминание', 'Через ' + st.notifyMin + ' мин выходить') }, 'Проверить') : null),
      h('h3', { style: 'margin-top:6px' }, 'Календарь'),
      h('p', { class: 'hint' }, 'Самый надёжный способ: файл с поездками на 7 дней. Открой его — телефон добавит события с напоминаниями. Обновляй раз в неделю или после смены расписания.'),
      h('button', { class: 'btn ghost', type: 'button', onclick: exportICS }, 'Скачать напоминания на неделю')));

    root.append(h('div', { class: 'panel form' },
      h('h2', null, 'Семестр и время пар'),
      field('Начало семестра', h('input', { type: 'date', value: st.semesterStart, onchange: (e) => {
        if (C.parseDate(e.target.value)) { st.semesterStart = e.target.value; save(); scheduleNotifications(); }
      } }), 'Первая неделя считается нечётной.'),
      h('div', { class: 'pairtimes' }, st.pairTimes.map((p, i) => [
        h('b', null, i + 1),
        h('input', { type: 'time', value: p[0], 'aria-label': (i + 1) + ' пара, начало', onchange: (e) => { if (e.target.value) { p[0] = e.target.value; save(); scheduleNotifications(); } } }),
        h('input', { type: 'time', value: p[1], 'aria-label': (i + 1) + ' пара, конец', onchange: (e) => { if (e.target.value) { p[1] = e.target.value; save(); } } }),
      ])),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { st.pairTimes = C.DEFAULT_PAIRS.map((p) => p.slice()); save(); renderSettings(); } }, 'Вернуть время пар по умолчанию')));

    root.append(h('div', { class: 'panel form' },
      h('h2', null, 'Данные'),
      field('Свой прокси для расписания ТулГУ (необязательно)', h('input', { type: 'text', value: st.proxy, placeholder: 'https://mой-прокси.workers.dev/?url={url}', onchange: (e) => { st.proxy = e.target.value.trim(); save(); } }),
        'Сайт ТулГУ не отдаёт данные другим сайтам напрямую, поэтому расписание идёт через прокси. Без своего используется публичный.'),
      h('p', { class: 'hint' }, 'Всё хранится только на этом устройстве, на сервер ничего не отправляется.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => download('uspeyu-backup.json', JSON.stringify(S, null, 2), 'application/json') }, 'Сохранить копию'),
        h('label', { class: 'btn ghost' }, 'Загрузить копию', h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importBackup }))),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => {
        if (confirm('Удалить расписание и настройки с этого устройства?')) { localStorage.removeItem(KEY); S = load(); toast('Данные удалены'); show('home'); loadWeather(); }
      } }, 'Удалить все данные')));

    root.append(h('div', { class: 'panel small muted' },
      h('p', null, 'Успею — проект по дисциплине «Проектная деятельность», ТулГУ. Команда: Комерилов Григорий, Кузнецов Артем, Гончаров Иннокентий.'),
      h('p', { style: 'margin:0' }, 'Погода — Open-Meteo, адреса — OpenStreetMap, маршрут — OSRM.')));
  }

  function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      const data = JSON.parse(txt);
      if (!data || !Array.isArray(data.schedule) || !data.settings) throw new Error('bad');
      localStorage.setItem(KEY, JSON.stringify(data));
      S = load(); toast('Копия загружена'); show('home'); loadWeather(); scheduleNotifications();
    }).catch(() => toast('Это не файл копии «Успею»'));
  }

  /* ---------- уведомления и календарь ---------- */
  function exportICS() {
    const trips = C.upcomingTrips(new Date(), allLessons(), S.settings, W.forecast, 8).filter((t) => t.status === 'ok');
    if (!trips.length) { toast('Нечего добавить: на неделю нет рассчитанных поездок'); return; }
    download('uspeyu-nedelya.ics', C.buildICS(trips, S.settings.notifyMin), 'text/calendar;charset=utf-8');
    toast('Файл скачан — открой его, чтобы добавить в календарь');
  }

  async function enableNotifications() {
    if (!('Notification' in window)) { toast('Браузер не поддерживает уведомления — используй календарь'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Уведомления не разрешены'); return; }
    S.settings.notificationsOn = true; save();
    scheduleNotifications();
    toast('Уведомления включены');
    render();
  }

  async function notify(title, body) {
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) { await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'uspeyu', renotify: true }); return; }
      new Notification(title, { body, icon: 'icons/icon-192.png' });
    } catch (e) { toast(title + ' — ' + body); }
  }

  let timers = [];
  function scheduleNotifications() {
    timers.forEach(clearTimeout);
    timers = [];
    if (!S.settings.notificationsOn || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date();
    C.upcomingTrips(now, allLessons(), S.settings, W.forecast, 2).filter((t) => t.status === 'ok').forEach((t) => {
      const leaveAt = C.atMinutes(t.date, t.leave);
      const body = t.first.pair + ' пара в ' + C.fmt(t.first.start) + (t.first.subject ? ': ' + t.first.subject : '') +
        (t.mode === 'bus' && t.bus != null ? '. Автобус в ' + C.fmt(t.bus) : '');
      [[new Date(leaveAt - S.settings.notifyMin * 60000), 'Через ' + S.settings.notifyMin + ' мин выходить'], [leaveAt, 'Пора выходить!']]
        .forEach(([when, title]) => {
          const ms = when - now;
          if (ms > 0 && ms < 24 * 3600 * 1000) timers.push(setTimeout(() => notify(title, body), ms));
        });
    });
  }

  /* ---------- погода ---------- */
  async function loadWeather() {
    const loc = S.settings.home || S.settings.uni;
    W.loading = true;
    if (tab === 'home') renderHome();
    try {
      const r = await A.forecast(loc.lat, loc.lon);
      Object.assign(W, { forecast: r.forecast, fetchedAt: r.fetchedAt, stale: r.stale, error: r.error || null });
    } catch (e) {
      W.error = e.message;
    } finally {
      W.loading = false;
      if (tab === 'home') renderHome();
      scheduleNotifications();
    }
  }

  /* ---------- запуск ---------- */
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || 'home');
  loadWeather();
  if (S.tulsu && Date.now() - S.tulsu.fetchedAt > 12 * 3600 * 1000) loadTulsu(S.tulsu.group, true);
  setInterval(() => { if (tab === 'home' && !document.hidden) renderHome(); }, 30000);
  setInterval(loadWeather, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && W.fetchedAt && Date.now() - W.fetchedAt > 20 * 60 * 1000) loadWeather();
    else if (!document.hidden && tab === 'home') renderHome();
  });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим недоступен */ });
  }
})();
