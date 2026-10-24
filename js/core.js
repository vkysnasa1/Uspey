/* Успею — логика без интерфейса.
   Работает и в браузере (window.Core), и в Node (для тестов). */
(function (root) {
  'use strict';

  // Время пар ТулГУ по умолчанию (можно поменять в настройках)
  const DEFAULT_PAIRS = [
    ['07:45', '09:20'], ['09:40', '11:15'], ['11:35', '13:10'],
    ['13:40', '15:15'], ['15:35', '17:10'], ['17:30', '19:05'],
  ];
  const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  /* ---------- время ---------- */
  function toMin(hhmm) {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(hhmm == null ? '' : hhmm).trim());
    if (!m) return NaN;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return NaN;
    return h * 60 + mi;
  }
  function fmt(min) {
    const v = ((Math.round(min) % 1440) + 1440) % 1440;
    return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
  }
  function duration(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + ' мин';
    return h + ' ч' + (m ? ' ' + m + ' мин' : '');
  }
  function parseTimes(text) {
    return String(text || '')
      .split(/[\s,;]+/)
      .map(toMin)
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b)
      .filter((v, i, a) => i === 0 || v !== a[i - 1]);
  }
  function intervalTimes(first, last, every) {
    const f = toMin(first), l = toMin(last), e = Math.round(+every);
    if (isNaN(f) || isNaN(l) || !(e > 0) || l < f) return [];
    const out = [];
    for (let t = f; t <= l; t += e) out.push(t);
    return out;
  }

  /* ---------- даты и недели ---------- */
  function parseDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function ymd(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }
  function addDays(date, n) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }
  function dayIndex(date) { return (date.getDay() + 6) % 7; } // Пн = 0, Вс = 6
  function startOfWeek(date) { return addDays(date, -dayIndex(date)); }
  function weekNumber(date, semesterStart) {
    const s = parseDate(semesterStart);
    if (!s) return 1;
    const days = Math.round((startOfWeek(date) - startOfWeek(s)) / 86400000);
    return Math.floor(days / 7) + 1;
  }
  function weekParity(date, semesterStart) {
    const n = weekNumber(date, semesterStart);
    return ((n % 2) + 2) % 2 === 1 ? 'odd' : 'even';
  }
  function atMinutes(date, min) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, min, 0, 0);
  }

  /* ---------- расписание ---------- */
  function pairTime(settings, pair) {
    const p = (settings.pairTimes || DEFAULT_PAIRS)[pair - 1];
    if (!p) return null;
    const start = toMin(p[0]), end = toMin(p[1]);
    return isNaN(start) ? null : { start, end };
  }
  // schedule: еженедельные пары {day, pair, week} и/или занятия на конкретную дату {date, start, end} (из расписания ТулГУ)
  function classesFor(date, schedule, settings) {
    const day = dayIndex(date), key = ymd(date);
    const parity = weekParity(date, settings.semesterStart);
    const pairs = settings.pairTimes || DEFAULT_PAIRS;
    const list = (schedule || [])
      .filter((c) => (c.date ? c.date === key : day <= 5 && c.day === day && (c.week === 'all' || !c.week || c.week === parity)))
      .map((c) => (c.date ? Object.assign({}, c) : Object.assign({}, c, pairTime(settings, c.pair))))
      .filter((c) => typeof c.start === 'number')
      .sort((a, b) => a.start - b.start);
    list.forEach((c, i) => {
      if (!c.pair) { const k = pairs.findIndex((p) => toMin(p[0]) === c.start); c.pair = k >= 0 ? k + 1 : i + 1; }
    });
    return list;
  }

  /* ---------- расписание ТулГУ (tulsu.ru/schedule) ---------- */
  const KIND_SHORT = { 'Лекции': 'лекция', 'Практические занятия': 'практика', 'Лабораторные занятия': 'лаб.', 'Экзамен': 'экзамен', 'Консультация': 'консультация', 'Зачет': 'зачёт', 'Зачёт': 'зачёт' };
  function parseTulsu(list) {
    if (!Array.isArray(list)) throw new Error('Неверный ответ сайта ТулГУ');
    const seen = new Set(), out = [];
    list.forEach((x) => {
      const d = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(x.DATE_Z || '').trim());
      const t = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(String(x.TIME_Z || ''));
      if (!d || !t) return;
      const date = d[3] + '-' + d[2] + '-' + d[1], start = toMin(t[1]), end = toMin(t[2]);
      const kind = String(x.KOW || '').trim();
      const prim = x.GROUPS && x.GROUPS[0] && x.GROUPS[0].PRIM ? String(x.GROUPS[0].PRIM).trim() : '';
      const subject = String(x.DISCIP || 'Занятие').trim() + (kind ? ' (' + (KIND_SHORT[kind] || kind.toLowerCase()) + ')' : '');
      const id = date + start + subject + (x.AUD || '');
      if (seen.has(id)) return; // одно занятие у нескольких подгрупп
      seen.add(id);
      out.push({ date, start, end, subject, room: String(x.AUD || '').trim(), teacher: String(x.PREP || '').trim(), note: prim, source: 'tulsu' });
    });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
  }

  /* ---------- погода ---------- */
  const WMO = {
    0: 'Ясно', 1: 'Почти ясно', 2: 'Переменная облачность', 3: 'Пасмурно',
    45: 'Туман', 48: 'Туман с изморозью',
    51: 'Лёгкая морось', 53: 'Морось', 55: 'Сильная морось',
    56: 'Ледяная морось', 57: 'Сильная ледяная морось',
    61: 'Небольшой дождь', 63: 'Дождь', 65: 'Ливень',
    66: 'Ледяной дождь', 67: 'Сильный ледяной дождь',
    71: 'Небольшой снег', 73: 'Снег', 75: 'Сильный снег', 77: 'Снежная крупа',
    80: 'Кратковременный дождь', 81: 'Ливневый дождь', 82: 'Сильный ливень',
    85: 'Снегопад', 86: 'Сильный снегопад',
    95: 'Гроза', 96: 'Гроза с градом', 99: 'Сильная гроза с градом',
  };
  const RAIN = [51, 53, 55, 61, 63, 65, 80, 81, 82];
  const FREEZING = [56, 57, 66, 67];
  const SNOW = [71, 73, 75, 77, 85, 86];
  const THUNDER = [95, 96, 99];

  function describe(code) { return WMO[code] || 'Нет данных'; }

  function parseForecast(json) {
    if (!json || !json.hourly || !Array.isArray(json.hourly.time)) throw new Error('Неверный ответ сервиса погоды');
    const H = json.hourly, hourly = {};
    H.time.forEach((t, i) => {
      hourly[t.slice(0, 13)] = {
        temp: H.temperature_2m[i], feels: H.apparent_temperature[i],
        precip: H.precipitation[i] || 0, snow: H.snowfall[i] || 0,
        code: H.weather_code[i], wind: H.wind_speed_10m[i] || 0, gust: H.wind_gusts_10m[i] || 0,
      };
    });
    const daily = {};
    if (json.daily && Array.isArray(json.daily.time)) {
      const D = json.daily;
      D.time.forEach((t, i) => {
        daily[t] = {
          max: D.temperature_2m_max[i], min: D.temperature_2m_min[i],
          uv: D.uv_index_max ? D.uv_index_max[i] : 0,
          precip: D.precipitation_sum ? D.precipitation_sum[i] : 0,
        };
      });
    }
    const C = json.current || {};
    return {
      current: { temp: C.temperature_2m, feels: C.apparent_temperature, code: C.weather_code, wind: C.wind_speed_10m },
      hourly, daily,
    };
  }

  // Сводка погоды за отрезок времени (минуты от полуночи) в заданный день
  function commuteWeather(forecast, date, fromMin, toMinute) {
    if (!forecast) return null;
    const day = ymd(date), hours = [];
    for (let h = Math.floor(Math.max(0, fromMin) / 60); h <= Math.floor(Math.min(1439, toMinute) / 60); h++) {
      const x = forecast.hourly[day + 'T' + String(h).padStart(2, '0')];
      if (x) hours.push(x);
    }
    if (!hours.length) return null;
    const d = forecast.daily[day] || {};
    return {
      minTemp: Math.min(...hours.map((x) => x.temp)),
      maxTemp: Math.max(...hours.map((x) => x.temp)),
      minFeels: Math.min(...hours.map((x) => x.feels)),
      maxPrecip: Math.max(...hours.map((x) => x.precip)),
      maxSnow: Math.max(...hours.map((x) => x.snow)),
      maxWind: Math.max(...hours.map((x) => x.wind)),
      maxGust: Math.max(...hours.map((x) => x.gust)),
      codes: hours.map((x) => x.code),
      code: hours[hours.length - 1].code,
      dayMax: typeof d.max === 'number' ? d.max : Math.max(...hours.map((x) => x.temp)),
      uv: d.uv || 0,
    };
  }

  function conditions(w) {
    const has = (list) => w.codes.some((c) => list.includes(c));
    const rainy = has(RAIN) || (w.maxPrecip >= 0.3 && w.maxSnow < 0.1);
    return {
      ice: has(FREEZING) || (rainy && w.minTemp <= 1 && w.minTemp >= -4),
      heavySnow: w.maxSnow >= 1 || has([75, 86]),
      snow: w.maxSnow > 0.1 || has(SNOW),
      heavyRain: has([65, 82]) || w.maxPrecip >= 4,
      rain: rainy,
      thunder: has(THUNDER),
      fog: has([45, 48]),
    };
  }

  // Сколько минут добавить к дороге из-за погоды
  function weatherDelay(w, mode) {
    if (!w) return { minutes: 0, reasons: [] };
    const c = conditions(w), items = [];
    if (c.ice) items.push(['гололёд', 10]);
    if (c.heavySnow) items.push(['сильный снегопад', 12]);
    else if (c.snow) items.push(['снег', 6]);
    if (c.heavyRain) items.push(['ливень', 6]);
    else if (c.rain && !c.ice) items.push(['дождь', 3]);
    if (c.thunder) items.push(['гроза', 5]);
    if (c.fog && mode === 'car') items.push(['туман', 4]);
    let minutes = items.reduce((s, x) => s + x[1], 0);
    if (mode === 'car') minutes = Math.round(minutes * 1.5); // в непогоду пробки сильнее
    minutes = Math.min(minutes, 30);
    return { minutes, reasons: items.map((x) => x[0]) };
  }

  /* ---------- что надеть ---------- */
  const BANDS = [
    [-25, 'Пуховик, термобельё, тёплые штаны, шапка, шарф, варежки, зимняя обувь'],
    [-15, 'Зимняя куртка или пуховик, свитер, шапка, шарф, перчатки, зимние ботинки'],
    [-5, 'Зимняя куртка, свитер или худи, шапка, перчатки, тёплая обувь'],
    [3, 'Тёплая куртка, кофта, шапка, закрытая обувь'],
    [10, 'Демисезонная куртка, кофта или свитшот, закрытая обувь'],
    [16, 'Лёгкая куртка или ветровка, лонгслив или кофта'],
    [21, 'Худи или рубашка, джинсы — куртка не нужна'],
    [27, 'Футболка, лёгкие брюки или шорты'],
    [Infinity, 'Лёгкая светлая одежда, возьми воду'],
  ];
  function clothing(w) {
    if (!w) return null;
    const main = BANDS.find((b) => w.minFeels < b[0])[1];
    const c = conditions(w), extra = [];
    if (c.rain || c.heavyRain || c.thunder) extra.push('Зонт и непромокаемая обувь');
    if (c.ice) extra.push('Обувь с нескользкой подошвой');
    else if (c.snow) extra.push('Обувь, которая не промокает в снегу');
    if (w.maxWind >= 8) extra.push('Куртка с капюшоном — ветрено');
    if (w.uv >= 6) extra.push('Кепка и солнцезащитный крем');
    if (w.dayMax - w.minFeels >= 10) extra.push('Днём до ' + Math.round(w.dayMax) + '° — одевайся слоями');
    return { main, extra };
  }

  function warnings(w) {
    if (!w) return [];
    const c = conditions(w), out = [];
    if (c.ice) out.push('Гололёд: скользкие тротуары и дороги');
    if (c.heavySnow) out.push('Сильный снегопад: транспорт может задерживаться');
    if (c.thunder) out.push('Гроза: не стой под деревьями');
    if (w.minFeels <= -25) out.push('Сильный мороз: ощущается как ' + Math.round(w.minFeels) + '°');
    if (w.dayMax >= 30) out.push('Жара до ' + Math.round(w.dayMax) + '°');
    if (w.maxGust >= 15) out.push('Порывы ветра до ' + Math.round(w.maxGust) + ' м/с');
    if (w.uv >= 8) out.push('Очень высокий УФ-индекс: ' + Math.round(w.uv));
    return out;
  }

  /* ---------- корпуса ТулГУ (адреса с tulsu.ru/facilities/academic-building) ---------- */
  const BUILDINGS = {
    'Гл': { name: 'Главный корпус', addr: 'пр. Ленина, 92', lat: 54.1668, lon: 37.58645 },
    '1': { name: 'Корпус 1', addr: 'пр. Ленина, 95', lat: 54.17267, lon: 37.59614 },
    '2': { name: 'Корпус 2', addr: 'пр. Ленина, 84', lat: 54.17188, lon: 37.59219 },
    '3': { name: 'Корпус 3', addr: 'пр. Ленина, 84, корп. 8', lat: 54.17165, lon: 37.58903 },
    '4': { name: 'Корпус 4', addr: 'пр. Ленина, 84, корп. 7', lat: 54.17245, lon: 37.5892 },
    '5': { name: 'Корпус 5', addr: 'ул. Ф. Энгельса, 155', lat: 54.17329, lon: 37.59203 },
    '6': { name: 'Корпус 6', addr: 'пр. Ленина, 90', lat: 54.16808, lon: 37.58891 },
    '7': { name: 'Корпус 7', addr: 'пр. Ленина, 93А', lat: 54.17219, lon: 37.59745 },
    '8': { name: 'Корпус 8', addr: 'ул. Болдина, 153', lat: 54.16743, lon: 37.58764 },
    '9': { name: 'Корпус 9', addr: 'пр. Ленина, 92', lat: 54.1668, lon: 37.58645 },
    '10': { name: 'Корпус 10', addr: 'ул. Болдина, 128', lat: 54.16774, lon: 37.58541 },
    '11': { name: 'Корпус 11', addr: 'ул. Болдина, 151', lat: 54.16701, lon: 37.58594 },
    '12': { name: 'Корпус 12', addr: 'ул. Агеева, 1Б', lat: 54.17413, lon: 37.59363 },
    '13': { name: 'Корпус 13', addr: 'пр. Ленина, 93', lat: 54.17234, lon: 37.59679 },
    'Лаб6': { name: 'Лабораторный корпус 6', addr: 'ул. Смидович, 3А', lat: 54.16855, lon: 37.58776 },
    'Спорт': { name: 'Спортивный корпус', addr: 'ул. Болдина, 126', lat: 54.16806, lon: 37.58402 },
  };
  // «Гл.-403» → Гл, «9-306» → 9, «Спорткорп-18» → Спорт, «Лаб.корп.6-…» → Лаб6
  function buildingOf(room) {
    const r = String(room || '').trim().toLowerCase().replace(/ё/g, 'е');
    if (!r) return null;
    if (/^гл/.test(r)) return 'Гл';
    if (/^спорт/.test(r)) return 'Спорт';
    if (/^лаб/.test(r)) return 'Лаб6';
    const m = /^(\d{1,2})\s*[-–.]/.exec(r) || /^(\d{1,2})$/.exec(r);
    return m && BUILDINGS[String(+m[1])] ? String(+m[1]) : null;
  }
  function distanceM(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  // Пешком по городу: прямая × 1,3, скорость 75 м/мин
  function walkMinutes(a, b) { return a && b ? Math.round(distanceM(a, b) * 1.3 / 75) : 0; }


  /* ---------- общественный транспорт по данным OpenStreetMap ----------
     network: { routes: [{ type, ref, name, stops: [{ name, lat, lon }] }] } — маршруты, проходящие у дома.
     Ищем маршрут, где посадка рядом с домом, а выход позже по ходу движения — рядом с корпусом. */
  const SPEED = { bus: 300, minibus: 320, share_taxi: 320, trolleybus: 270, tram: 250 }; // метров в минуту с учётом остановок
  const TYPE_RU = { bus: 'Автобус', minibus: 'Маршрутка', share_taxi: 'Маршрутка', trolleybus: 'Троллейбус', tram: 'Трамвай' };
  function transitPlan(network, home, dest, opts) {
    if (!network || !network.routes || !home || !dest) return null;
    const maxWalk = (opts && opts.maxWalkM) || 800;
    let best = null;
    network.routes.forEach((r) => {
      const st = r.stops;
      if (!st || st.length < 2) return;
      const speed = SPEED[r.type] || 280;
      for (let i = 0; i < st.length - 1; i++) {
        const dHome = distanceM(home, st[i]);
        if (dHome > maxWalk) continue;
        let path = 0;
        for (let j = i + 1; j < st.length; j++) {
          path += distanceM(st[j - 1], st[j]);
          const dDest = distanceM(st[j], dest);
          if (dDest > maxWalk) continue;
          const walkTo = Math.max(1, Math.round(dHome * 1.3 / 75));
          const walkFrom = Math.max(1, Math.round(dDest * 1.3 / 75));
          const ride = Math.max(2, Math.round(path * 1.15 / speed));
          const total = walkTo + ride + walkFrom;
          if (!best || total < best.total) {
            best = { type: r.type, label: (TYPE_RU[r.type] || 'Транспорт') + (r.ref ? ' № ' + r.ref : ''), ref: r.ref || '', name: r.name || '',
              from: st[i].name || 'остановка', to: st[j].name || 'остановка', walkTo, ride, walkFrom, total, stops: j - i };
          }
        }
      }
    });
    if (!best) {
      const walk = walkMinutes(home, dest);
      if (walk <= 25) return { type: 'walk', label: 'Пешком', walkTo: 0, ride: walk, walkFrom: 0, total: walk, from: '', to: '', stops: 0 };
    }
    return best;
  }

  /* ---------- пробки и парковка: модель по времени суток ----------
     Бесплатных данных о пробках в реальном времени нет, поэтому — типичный профиль города:
     коэффициент к времени в пути без пробок (1 = свободно). Точки: [минута суток, коэффициент]. */
  // Пробки в баллах 0–10, как у Яндекса, по получасам (48 значений с 0:00). 1 балл ≈ +9 % к времени в пути.
  // Профиль Тулы по умолчанию: в будни пик в 7:30 (9 баллов), в 9:00 ещё 5, днём 3–4, вечером пик в 17:30; в субботу 1–3.
  const H = (spec) => { const a = new Array(48).fill(0); Object.keys(spec).forEach((k) => { const [f, t] = k.split('-').map(Number); for (let s = f; s <= (t == null ? f : t); s++) a[s] = spec[k]; }); return a; };
  const DEFAULT_JAMS = {
    weekday: H({ '11': 1, '12': 2, '13': 4, '14': 7, '15': 9, '16': 8, '17': 7, '18': 5, '19': 4, '20-23': 3, '24-31': 4, '32': 5, '33': 6, '34': 8, '35': 9, '36': 8, '37': 6, '38': 5, '39': 4, '40-41': 3, '42-43': 2, '44-45': 1 }),
    saturday: H({ '16-17': 1, '18-23': 2, '24-31': 3, '32-37': 2, '38-41': 1 }),
    sunday: H({ '18-23': 1, '24-35': 2, '36-39': 2, '40-41': 1 }),
  };

  const JAM_STEP = 0.09;
  function jamsKind(date) { const d = dayIndex(date); return d === 6 ? 'sunday' : d === 5 ? 'saturday' : 'weekday'; }
  function jamBalls(date, minute, jams) {
    const prof = (jams && jams[jamsKind(date)]) || DEFAULT_JAMS[jamsKind(date)];
    const m = Math.max(0, Math.min(1439, minute)), s = Math.floor(m / 30), fr = (m - s * 30) / 30;
    let b = prof[s] + ((prof[Math.min(47, s + 1)] - prof[s]) * fr);
    const d = dayIndex(date);
    if (d === 0 && m < 720) b += 1;      // понедельник утром
    if (d === 4 && m >= 900) b += 1;     // пятница вечером
    return Math.max(0, Math.min(10, Math.round(b * 10) / 10));
  }
  function trafficFactor(date, minute, jams) { return Math.round((1 + jamBalls(date, minute, jams) * JAM_STEP) * 100) / 100; }
  // Учимся на реальных поездках: «ехал N мин» → поправляем баллы в получасе выезда (и чуть-чуть в соседних)
  function learnJams(jams, date, departMin, driveMin, actualMin) {
    const kind = jamsKind(date), out = JSON.parse(JSON.stringify(jams || DEFAULT_JAMS));
    if (!(driveMin > 0) || !(actualMin > 0)) return out;
    const obs = Math.max(0, Math.min(10, ((actualMin / driveMin) - 1) / JAM_STEP));
    const s = Math.max(0, Math.min(47, Math.floor(departMin / 30)));
    out[kind][s] = Math.round((out[kind][s] * 0.4 + obs * 0.6) * 10) / 10;
    [s - 1, s + 1].forEach((k) => { if (k >= 0 && k < 48) out[kind][k] = Math.round((out[kind][k] * 0.8 + obs * 0.2) * 10) / 10; });
    return out;
  }
  function trafficLabel(f) { const b = Math.round((f - 1) / JAM_STEP); return b + ' ' + (b % 10 === 1 && b !== 11 ? 'балл' : b % 10 >= 2 && b % 10 <= 4 && (b < 12 || b > 14) ? 'балла' : 'баллов'); }
  // Сколько искать место и дойти до входа: у главного корпуса и на Болдина утром мест почти нет
  const DENSE = { 'Гл': 1, '6': 1, '8': 1, '9': 1, '10': 1, '11': 1, 'Лаб6': 1, 'Спорт': 1 };
  function parkingMinutes(date, arrive, bKey) {
    const d = dayIndex(date);
    let p = DENSE[bKey] ? 5 : 3;
    if (d <= 4) {
      if (arrive >= 480 && arrive <= 600) p += DENSE[bKey] ? 9 : 6;      // 8:00–10:00
      else if (arrive >= 450 && arrive < 480) p += 4;                   // 7:30–8:00
      else if (arrive > 600 && arrive <= 780) p += 5;                   // днём занято
      else p += 1;
    } else if (d === 5) p += 2;
    return p;
  }
  // Погрешность: процент от всей дороги (настройка), не меньше 0
  function errorMargin(settings, travel) {
    const pct = settings.errorPct == null ? 10 : +settings.errorPct;
    return Math.max(0, Math.round(travel * pct / 100));
  }

  /* ---------- когда выходить ---------- */
  function busDepartures(bus) {
    return bus.useInterval ? intervalTimes(bus.first, bus.last, bus.every) : parseTimes(bus.times);
  }

  /* Опасность БПЛА: включается вручную на 12 часов. Транспорт может встать, связь — пропасть,
     поэтому выходим раньше на заданный запас (пробки считаются как обычно). */
  function droneMinutes(date, settings) {
    const d = settings.drone;
    if (!d || !d.until) return 0;
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return dayStart < d.until ? Math.max(0, +d.min || 20) : 0;
  }

  function planTrip(date, schedule, settings, forecast) {
    const p = planTripBase(date, schedule, settings, forecast);
    const dm = p.drone;
    if (dm && p.status === 'ok' && p.steps && p.steps[0]) p.steps[0].text += ' — запас на опасность БПЛА +' + dm + ' мин';
    return p;
  }

  function planTripBase(date, schedule, settings, forecast) {
    const classes = classesFor(date, schedule, settings);
    if (!classes.length) return { status: 'no-classes', date };
    const first = classes[0];
    const drone = droneMinutes(date, settings);
    const target = first.start - (+settings.earlyMin || 0) - drone;
    const w = commuteWeather(forecast, date, target - 90, target);
    const delay = weatherDelay(w, settings.mode);
    const base = { date, first, classes, target, weather: w, delay, mode: settings.mode, drone };

    // корпус первой пары
    const bKey = buildingOf(first.room), bld = bKey ? BUILDINGS[bKey] : null;
    const where = bld ? bld.name.replace('Корпус', 'корпус') + ' (' + bld.addr + ')' : 'вуз';
    const aud = first.pair + ' пара: ' + (first.subject || 'занятие') + (first.room ? ', ауд. ' + first.room : '');
    Object.assign(base, { building: bld ? Object.assign({ key: bKey }, bld) : null });
    const lbl = settings.originLabel, out = lbl && lbl !== 'Дом' ? 'Выйти (' + lbl + ')' : 'Выйти из дома';

    if (settings.mode === 'car') {
      const car = settings.car;
      const r = bKey && car.routes && car.routes[bKey];
      const drive = (r && r.min) || car.routeMin || +car.manualMin;
      if (!(drive > 0)) return Object.assign(base, { status: 'no-route' });
      const autoTraffic = car.traffic === 'auto' || car.traffic == null;
      const autoParking = car.parkingAuto !== false;
      // время выезда зависит от пробок, а пробки — от времени выезда: уточняем в несколько шагов
      let leave = target - drive * 1.4 - 10, f = 1, road = drive, parking = 0, margin = 0;
      for (let k = 0; k < 4; k++) {
        f = autoTraffic ? Math.max(trafficFactor(date, leave, settings.jams), trafficFactor(date, (leave + target) / 2, settings.jams)) : +car.traffic || 1;
        road = Math.round(drive * f) + delay.minutes;
        parking = autoParking ? parkingMinutes(date, target - 5, bKey) : +car.parking || 0;
        margin = errorMargin(settings, road + parking);
        leave = target - road - parking - margin;
      }
      return Object.assign(base, {
        status: 'ok', leave, routeKm: r ? r.km : car.routeKm, traffic: f, balls: Math.round((f - 1) / JAM_STEP), parking, margin, drive,
        steps: [
          { t: leave, text: out + ' и сесть в машину' + (margin ? ' (запас на погрешность ' + margin + ' мин)' : '') },
          { t: leave + margin + road, text: 'Подъехать: ' + where + ' — ' + drive + ' мин без пробок' + (Math.round((f - 1) / JAM_STEP) > 0 ? ', пробки ' + trafficLabel(f) + ' (+' + (Math.round(drive * f) - drive) + ' мин)' : ', пробок нет') + (delay.minutes ? ', погода +' + delay.minutes + ' мин' : '') },
          { t: leave + margin + road + parking, text: 'Найти место и дойти до аудитории — ~' + parking + ' мин' + (target < first.start ? ' (до начала ещё ' + (first.start - target) + ' мин запаса)' : '') },
          { t: first.start, text: aud },
        ],
      });
    }

    const bus = settings.bus;
    // автоматический маршрут транспорта до корпуса (OpenStreetMap), если он посчитан
    const auto = bus.auto !== false && bKey && bus.plans ? bus.plans[bKey] : null;
    if (auto && auto.type === 'walk') {
      const leave = target - auto.ride - delay.minutes;
      return Object.assign(base, { status: 'ok', leave, auto, steps: [
        { t: leave, text: out + ' пешком' + (delay.minutes ? ' (с учётом погоды +' + delay.minutes + ' мин)' : '') },
        { t: target, text: 'Дойти: ' + where },
        { t: first.start, text: aud },
      ] });
    }
    const deps = busDepartures(bus);
    if (!deps.length) return Object.assign(base, { status: 'no-bus' });
    // автобусы и троллейбусы стоят в тех же пробках (слабее — есть выделенки), трамвай почти нет
    const baseRide = auto ? auto.ride : +bus.ride || 0;
    const tf = settings.trafficAuto === false ? 1 : trafficFactor(date, target - baseRide - 10, settings.jams);
    const share = auto && auto.type === 'tram' ? 0.15 : 0.6;
    const ft = Math.round((1 + (tf - 1) * share) * 100) / 100;
    const ride = Math.round(baseRide * ft) + delay.minutes;
    // от остановки до нужного корпуса — пешком
    const toBld = auto ? auto.walkFrom : bld && settings.uni ? walkMinutes(settings.uni, bld) : 0;
    const inside = auto ? 3 : +bus.walkFrom || 0; // от входа до аудитории
    const walkTo = auto ? auto.walkTo : +bus.walkTo || 0, reserve = +bus.stopReserve || 0;
    const margin = errorMargin(settings, ride + inside + toBld);
    const walkFrom = inside + toBld + margin;
    const fits = deps.filter((t) => t + ride + walkFrom <= target);
    if (!fits.length) return Object.assign(base, { status: 'no-bus-fits', earliest: deps[0] });
    const busT = fits[fits.length - 1];
    const leave = busT - walkTo - reserve;
    const prev = fits.length > 1 ? fits[fits.length - 2] : null;
    const label = auto ? auto.label : bus.number ? 'Автобус № ' + bus.number : 'Автобус';
    return Object.assign(base, {
      status: 'ok', leave, bus: busT, walkToBuilding: toBld, auto, traffic: ft, balls: Math.round((tf - 1) / JAM_STEP), margin,
      backup: prev == null ? null : { bus: prev, leave: prev - walkTo - reserve },
      steps: [
        { t: leave, text: out + (auto ? ', идти ' + walkTo + ' мин до остановки «' + auto.from + '»' : '') },
        { t: busT, text: label + ' отходит' + (auto ? ' (' + auto.stops + ' ост.)' : ' от остановки') },
        { t: busT + ride, text: (auto ? 'Выйти на остановке «' + auto.to + '»' : 'Выйти у вуза') + (ride - baseRide - delay.minutes > 0 ? ', в пробках +' + (ride - baseRide - delay.minutes) + ' мин' : '') + (delay.minutes ? ', погода +' + delay.minutes + ' мин' : '') },
        { t: busT + ride + toBld, text: 'Дойти: ' + where + (toBld ? ', пешком ' + toBld + ' мин' : '') + (margin ? '. В запасе ещё ' + margin + ' мин на погрешность' : '') },
        { t: first.start, text: aud },
      ],
    });
  }

  // Ближайшие поездки на N дней вперёд, начиная с даты now
  function upcomingTrips(now, schedule, settings, forecast, days) {
    const out = [];
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (let i = 0; i < (days || 8); i++) {
      const d = addDays(now, i);
      const p = planTrip(d, schedule, settings, forecast);
      if (p.status === 'no-classes') continue;
      if (i === 0 && p.first && nowMin > p.first.start) continue; // пары сегодня уже начались
      out.push(p);
    }
    return out;
  }

  /* ---------- календарь (.ics) ---------- */
  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function icsFold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const parts = [];
    let cur = '', bytes = 0, limit = 75;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > limit) { parts.push(cur); cur = ''; bytes = 0; limit = 74; }
      cur += ch; bytes += b;
    }
    parts.push(cur);
    return parts.join('\r\n ');
  }
  function icsDate(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

  function buildICS(trips, notifyMin, stamp) {
    const now = icsDate(stamp || new Date());
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Uspeyu//Student commute//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Успею'];
    trips.filter((t) => t.status === 'ok').forEach((t) => {
      const start = atMinutes(t.date, t.leave), end = atMinutes(t.date, t.first.start);
      const how = t.mode === 'car' ? 'На машине' : 'Автобус' + (t.bus != null ? ' в ' + fmt(t.bus) : '');
      const desc = [how, t.first.pair + ' пара в ' + fmt(t.first.start) + (t.first.subject ? ': ' + t.first.subject : '')]
        .concat(t.delay.minutes ? ['Погода: +' + t.delay.minutes + ' мин (' + t.delay.reasons.join(', ') + ')'] : [])
        .join('\n');
      L.push('BEGIN:VEVENT', 'UID:uspeyu-' + ymd(t.date) + '@uspeyu', 'DTSTAMP:' + now,
        'DTSTART:' + icsDate(start), 'DTEND:' + icsDate(end),
        'SUMMARY:' + icsEscape('Выходи в вуз — ' + fmt(t.leave)),
        'DESCRIPTION:' + icsEscape(desc));
      if (+notifyMin > 0) {
        L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT' + Math.round(+notifyMin) + 'M',
          'DESCRIPTION:' + icsEscape('Через ' + Math.round(+notifyMin) + ' мин выходить'), 'END:VALARM');
      }
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', 'DESCRIPTION:' + icsEscape('Пора выходить!'), 'END:VALARM', 'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
  }

  const Core = {
    DEFAULT_PAIRS, DAYS, DAYS_SHORT, toMin, fmt, duration, parseTimes, intervalTimes,
    parseDate, ymd, addDays, dayIndex, weekNumber, weekParity, atMinutes,
    pairTime, classesFor, parseTulsu, describe, parseForecast, commuteWeather, conditions,
    weatherDelay, clothing, warnings, BUILDINGS, buildingOf, distanceM, walkMinutes, transitPlan, trafficFactor, jamBalls, DEFAULT_JAMS, JAM_STEP, parkingMinutes, errorMargin, learnJams, busDepartures, planTrip, upcomingTrips, droneMinutes, buildICS, icsFold,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
