// Запуск: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

const OLD_PAIRS = [['09:00', '10:35'], ['10:45', '12:20'], ['13:00', '14:35'], ['14:45', '16:20'], ['16:30', '18:05'], ['18:15', '19:50']];
const settings = (over) => Object.assign({
  mode: 'bus', earlyMin: 10, errorPct: 0, trafficAuto: false, semesterStart: '2026-09-01', pairTimes: OLD_PAIRS,
  bus: { number: '16', walkTo: 7, stopReserve: 2, ride: 25, walkFrom: 5, useInterval: false, times: '7:00 7:15 7:30 7:45 8:00 8:15' },
  car: { manualMin: 20, traffic: 1.3, parking: 7, parkingAuto: false, routeMin: null },
}, over);
const MON = new Date(2026, 8, 28); // понедельник, 5-я неделя (нечётная)
const schedule = [
  { day: 0, pair: 2, subject: 'Программирование', week: 'all' },
  { day: 0, pair: 1, subject: 'Матанализ', room: '301', week: 'all' },
  { day: 2, pair: 1, subject: 'Английский', week: 'even' },
];

function forecastWith(hours) {
  const hourly = {};
  for (let h = 0; h < 24; h++) hourly['2026-09-28T' + String(h).padStart(2, '0')] = Object.assign(
    { temp: 8, feels: 5, precip: 0, snow: 0, code: 3, wind: 3, gust: 6 }, hours[h] || hours.all || {});
  return { current: {}, hourly, daily: { '2026-09-28': { max: 12, min: 4, uv: 2, precip: 0 } } };
}

test('время: разбор и форматирование', () => {
  assert.equal(C.toMin('7:05'), 425);
  assert.equal(C.toMin('07.05'), 425);
  assert.ok(isNaN(C.toMin('25:00')));
  assert.equal(C.fmt(425), '7:05');
  assert.equal(C.fmt(-5), '23:55');
  assert.deepEqual(C.parseTimes('7:30, 7:00;7:30 ерунда 8:00'), [420, 450, 480]);
  assert.deepEqual(C.intervalTimes('06:00', '06:30', 15), [360, 375, 390]);
  assert.equal(C.duration(95), '1 ч 35 мин');
});

test('чётность недели считается от начала семестра', () => {
  assert.equal(C.weekNumber(new Date(2026, 8, 1), '2026-09-01'), 1);
  assert.equal(C.weekParity(new Date(2026, 8, 1), '2026-09-01'), 'odd');
  assert.equal(C.weekParity(new Date(2026, 8, 7), '2026-09-01'), 'even');
  assert.equal(C.weekNumber(MON, '2026-09-01'), 5);
});

test('первая пара дня выбирается по времени, чётность учитывается', () => {
  const s = settings();
  assert.equal(C.classesFor(MON, schedule, s)[0].subject, 'Матанализ');
  assert.equal(C.classesFor(C.addDays(MON, 2), schedule, s).length, 0); // среда нечётной недели
  assert.equal(C.classesFor(C.addDays(MON, 9), schedule, s).length, 1); // среда чётной недели
});

test('автобус: выбирается последний автобус, на котором успеваешь', () => {
  // пара 9:00, прийти к 8:50, ехать 25 + идти 5 → автобус не позже 8:20 → 8:15
  const p = C.planTrip(MON, schedule, settings(), forecastWith({}));
  assert.equal(p.status, 'ok');
  assert.equal(C.fmt(p.bus), '8:15');
  assert.equal(C.fmt(p.leave), '8:06'); // 8:15 − 7 − 2
  assert.equal(C.fmt(p.backup.bus), '8:00');
});

test('гололёд сдвигает выход на более ранний автобус', () => {
  const p = C.planTrip(MON, schedule, settings(), forecastWith({ all: { temp: 0, feels: -4, precip: 0.8, code: 61 } }));
  assert.ok(p.delay.reasons.includes('гололёд'));
  assert.equal(p.delay.minutes, 10);
  assert.equal(C.fmt(p.bus), '8:00');
});

test('машина: пробки, погода и парковка', () => {
  const s = settings({ mode: 'car' });
  const p = C.planTrip(MON, schedule, s, forecastWith({}));
  // 8:50 − round(20×1.3)=26 − 7 = 8:17
  assert.equal(C.fmt(p.leave), '8:17');
  s.car.routeMin = 10;
  assert.equal(C.fmt(C.planTrip(MON, schedule, s, null).leave), '8:30');
});

test('особые случаи: нет пар, нет автобуса, автобус не успевает', () => {
  assert.equal(C.planTrip(new Date(2026, 9, 4), schedule, settings(), null).status, 'no-classes'); // воскресенье
  const noBus = settings(); noBus.bus.times = '';
  assert.equal(C.planTrip(MON, schedule, noBus, null).status, 'no-bus');
  const late = settings(); late.bus.times = '8:40 9:00';
  assert.equal(C.planTrip(MON, schedule, late, null).status, 'no-bus-fits');
});

test('одежда и предупреждения', () => {
  const w = C.commuteWeather(forecastWith({ all: { temp: -20, feels: -27, gust: 17 } }), MON, 420, 530);
  assert.match(C.clothing(w).main, /Пуховик/);
  const warn = C.warnings(w).join(' ');
  assert.match(warn, /мороз/);
  assert.match(warn, /Порывы/);
  const rain = C.commuteWeather(forecastWith({ all: { temp: 12, feels: 11, precip: 2, code: 63 } }), MON, 420, 530);
  assert.ok(C.clothing(rain).extra.some((x) => /Зонт/.test(x)));
});

test('календарь .ics: события, напоминания и перенос строк', () => {
  const trips = C.upcomingTrips(new Date(2026, 8, 28, 6, 0), schedule, settings(), forecastWith({}), 7);
  const ics = C.buildICS(trips, 10, new Date(2026, 8, 28));
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /TRIGGER:-PT10M/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, trips.filter((t) => t.status === 'ok').length);
  const enc = new TextEncoder();
  ics.split('\r\n').forEach((line) => assert.ok(enc.encode(line).length <= 75, 'длинная строка: ' + line));
});

test('разбор ответа Open-Meteo', () => {
  const f = C.parseForecast({
    current: { temperature_2m: 5, apparent_temperature: 2, weather_code: 3, wind_speed_10m: 4 },
    hourly: { time: ['2026-09-28T07:00'], temperature_2m: [5], apparent_temperature: [2], precipitation: [0], snowfall: [0], weather_code: [3], wind_speed_10m: [4], wind_gusts_10m: [8] },
    daily: { time: ['2026-09-28'], temperature_2m_max: [10], temperature_2m_min: [3], uv_index_max: [2], precipitation_sum: [0] },
  });
  assert.equal(f.hourly['2026-09-28T07'].feels, 2);
  assert.throws(() => C.parseForecast({}));
});

test('время пар ТулГУ по умолчанию: 1 пара в 7:45, 2 пара в 9:40', () => {
  assert.equal(C.DEFAULT_PAIRS[0][0], '07:45');
  assert.equal(C.DEFAULT_PAIRS[1][0], '09:40');
  // 19.10.2026 — чётная неделя, как в расписании ТулГУ
  assert.equal(C.weekParity(new Date(2026, 9, 19), '2026-09-01'), 'even');
});

test('ливень сдвигает на один интервал автобуса раньше', () => {
  const s = { mode: 'bus', earlyMin: 10, errorPct: 0, trafficAuto: false, semesterStart: '2026-09-01', pairTimes: C.DEFAULT_PAIRS,
    bus: { walkTo: 7, stopReserve: 2, ride: 25, walkFrom: 5, useInterval: true, first: '06:00', last: '22:30', every: 15 }, car: {} };
  const sch = [{ day: 0, pair: 2, subject: 'ОС', week: 'all' }];
  const MON = new Date(2026, 9, 26);
  const dry = C.planTrip(MON, sch, s, forecastWith({}));
  assert.equal(C.fmt(dry.leave), '8:51');
  const hourly = {};
  for (let h = 0; h < 24; h++) hourly['2026-10-26T' + String(h).padStart(2, '0')] = { temp: 7, feels: 4, precip: 4.5, snow: 0, code: 65, wind: 5, gust: 9 };
  const wet = C.planTrip(MON, sch, s, { current: {}, hourly, daily: {} });
  assert.deepEqual(wet.delay.reasons, ['ливень']);
  assert.equal(C.fmt(wet.bus), '8:45');
  assert.equal(C.fmt(wet.leave), '8:36');
});

test('расписание ТулГУ: разбор ответа и занятия по датам', () => {
  const raw = [
    { DATE_Z: '26.10.2026', TIME_Z: '09:40 - 11:15', DISCIP: 'Операционные системы и среды', KOW: 'Лекции', AUD: 'Гл.-403', PREP: 'Андриянова М. А.', GROUPS: [{ GROUP_P: '221351', PRIM: '' }], CLASS: 'lecture' },
    { DATE_Z: '26.10.2026', TIME_Z: '07:45 - 09:20', DISCIP: 'Физика', KOW: 'Практические занятия', AUD: '9-428', PREP: 'Горбунова О. Ю.', GROUPS: [{ GROUP_P: '221351', PRIM: '' }], CLASS: 'practice' },
    { DATE_Z: '26.10.2026', TIME_Z: '07:45 - 09:20', DISCIP: 'Физика', KOW: 'Практические занятия', AUD: '9-428', PREP: 'Горбунова О. Ю.', GROUPS: [{ GROUP_P: '221351', PRIM: '2 подгр.' }], CLASS: 'practice' },
    { DATE_Z: 'плохая дата', TIME_Z: '07:45 - 09:20', DISCIP: 'X' },
  ];
  const lessons = C.parseTulsu(raw);
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].subject, 'Физика (практика)');
  const s = { semesterStart: '2026-09-01', pairTimes: C.DEFAULT_PAIRS };
  const day = C.classesFor(new Date(2026, 9, 26), lessons, s);
  assert.equal(day[0].pair, 1);
  assert.equal(C.fmt(day[0].start), '7:45');
  assert.equal(day[1].pair, 2);
  assert.equal(C.classesFor(new Date(2026, 9, 27), lessons, s).length, 0);
  assert.throws(() => C.parseTulsu({ error: 'x' }));
});

test('корпус ТулГУ определяется по аудитории, путь пешком от остановки', () => {
  assert.equal(C.buildingOf('Гл.-403'), 'Гл');
  assert.equal(C.buildingOf('9-306'), '9');
  assert.equal(C.buildingOf('9-601-2'), '9');
  assert.equal(C.buildingOf('12-205'), '12');
  assert.equal(C.buildingOf('Спорткорп-18'), 'Спорт');
  assert.equal(C.buildingOf('2-Л2'), '2');
  assert.equal(C.buildingOf('спортзал'), 'Спорт');
  assert.equal(C.buildingOf('301'), null);
  const uni = C.BUILDINGS['Гл'];
  assert.equal(C.walkMinutes(uni, C.BUILDINGS['9']), 0);
  assert.ok(C.walkMinutes(uni, C.BUILDINGS['12']) >= 15); // Агеева, 1Б — далеко от главного
  const s = { mode: 'bus', earlyMin: 10, errorPct: 0, trafficAuto: false, semesterStart: '2026-09-01', pairTimes: C.DEFAULT_PAIRS, uni,
    bus: { walkTo: 7, stopReserve: 2, ride: 25, walkFrom: 5, useInterval: true, first: '06:00', last: '22:30', every: 15 }, car: { manualMin: 20, traffic: 1, parking: 5, parkingAuto: false, routes: { '12': { min: 12, km: 4 } } } };
  const day = new Date(2026, 9, 27);
  const near = C.planTrip(day, [{ date: '2026-10-27', start: 580, end: 675, subject: 'А', room: 'Гл.-104' }], s, null);
  const far = C.planTrip(day, [{ date: '2026-10-27', start: 580, end: 675, subject: 'Б', room: '12-205' }], s, null);
  assert.equal(far.building.key, '12');
  assert.ok(far.leave < near.leave, 'в 12 корпус выходить раньше');
  s.mode = 'car';
  const car = C.planTrip(day, [{ date: '2026-10-27', start: 580, end: 675, subject: 'Б', room: '12-205' }], s, null);
  assert.equal(C.fmt(car.leave), '9:13'); // 9:30 − 12 − 5
});

test('транспорт: подбирается маршрут с посадкой у дома и выходом у корпуса, по ходу движения', () => {
  const home = { lat: 54.1935, lon: 37.6177 }, dest = C.BUILDINGS['12'];
  const line = (n) => Array.from({ length: n }, (_, i) => ({ name: 'Ост ' + i, lat: home.lat + (dest.lat - home.lat) * i / (n - 1), lon: home.lon + (dest.lon - home.lon) * i / (n - 1) }));
  const there = line(8), back = line(8).reverse();
  const net = { routes: [{ type: 'tram', ref: '14', name: 'туда', stops: there }, { type: 'bus', ref: '99', name: 'обратно', stops: back }] };
  const pl = C.transitPlan(net, home, dest);
  assert.equal(pl.label, 'Трамвай № 14');     // автобус 99 идёт в обратную сторону
  assert.equal(pl.from, 'Ост 0'); assert.equal(pl.to, 'Ост 7');
  assert.ok(pl.ride >= 8 && pl.ride <= 14, 'время в пути ' + pl.ride);
  // пары в 12 корпусе, интервал 10 минут
  const s = { mode: 'bus', earlyMin: 10, semesterStart: '2026-09-01', pairTimes: C.DEFAULT_PAIRS,
    bus: { auto: true, plans: { '12': pl }, stopReserve: 2, useInterval: true, first: '06:00', last: '22:00', every: 10 }, car: {} };
  const trip = C.planTrip(new Date(2026, 9, 27), [{ date: '2026-10-27', start: 580, end: 675, subject: 'Матан', room: '12-205' }], s, null);
  assert.equal(trip.status, 'ok');
  assert.match(trip.steps[1].text, /Трамвай № 14/);
  assert.ok(trip.bus + pl.ride + pl.walkFrom + 3 <= 570);
  assert.equal(C.transitPlan({ routes: [] }, home, C.BUILDINGS['Гл']), null); // далеко и нет маршрутов
});

test('пробки и парковка по времени суток, погрешность', () => {
  const tue = new Date(2026, 9, 27), sun = new Date(2026, 10, 1);
  assert.ok(C.trafficFactor(tue, 8 * 60 + 15) >= 1.5, 'утренний час пик');
  assert.ok(C.trafficFactor(tue, 7 * 60 + 30) >= 1.7, 'в 7:30 пик');
  assert.ok(C.trafficFactor(tue, 9 * 60) < C.trafficFactor(tue, 7 * 60 + 30) - 0.3, 'к 9:00 свободнее, чем в 7:30');
  assert.ok(C.jamBalls(tue, 9 * 60) >= 4.5, 'в 9:00 ещё около 5 баллов');
  assert.ok(C.trafficFactor(new Date(2026, 9, 31), 7 * 60 + 30) <= 1.1, 'в субботу утром пусто');
  assert.ok(C.trafficFactor(tue, 11 * 60) < 1.35, 'днём 3 балла');
  assert.ok(C.trafficFactor(tue, 3 * 60) <= 1.03, 'ночью свободно');
  assert.ok(C.trafficFactor(sun, 8 * 60) < 1.1, 'в воскресенье утром свободно');
  assert.ok(C.parkingMinutes(tue, 9 * 60, 'Гл') > C.parkingMinutes(tue, 7 * 60, 'Гл'), 'к 9 утра место искать дольше');
  assert.ok(C.parkingMinutes(tue, 9 * 60, 'Гл') > C.parkingMinutes(tue, 9 * 60, '12'));
  assert.equal(C.errorMargin({ errorPct: 20 }, 30), 6);
  assert.equal(C.errorMargin({}, 30), 3); // по умолчанию 10 %
  // одна и та же поездка на машине: к 1 паре (утро) выезжать заметно раньше «без пробок»
  const base = { mode: 'car', earlyMin: 10, errorPct: 0, semesterStart: '2026-09-01', pairTimes: C.DEFAULT_PAIRS,
    car: { manualMin: 20, traffic: 'auto', parkingAuto: true, routes: {} }, bus: {} };
  const lesson = (start) => [{ date: '2026-10-27', start, end: start + 95, subject: 'X', room: 'Гл.-104' }];
  const morning = C.planTrip(tue, lesson(7 * 60 + 45), base, null);
  assert.ok(morning.traffic >= 1.5, 'коэффициент ' + morning.traffic);
  const late = C.planTrip(tue, lesson(9 * 60 + 40), base, null);
  assert.ok(late.parking >= 10, 'к 9:30 у главного парковка ' + late.parking);
  const evening = C.planTrip(tue, lesson(20 * 60 + 30), base, null);
  assert.ok((7 * 60 + 35) - morning.leave > (20 * 60 + 20) - evening.leave + 5, 'утром дорога дольше');
  const careful = C.planTrip(tue, lesson(7 * 60 + 45), Object.assign({}, base, { errorPct: 30 }), null);
  assert.ok(careful.leave < morning.leave && careful.margin > 0);
});

test('пробки: обучение на реальной поездке', () => {
  const tue = new Date(2026, 9, 27);
  const before = C.jamBalls(tue, 8 * 60 + 40, null);
  // выехал в 8:40, без пробок 20 мин, ехал 36 мин → пробки сильнее, чем думали
  const learned = C.learnJams(null, tue, 8 * 60 + 40, 20, 40);
  const after = C.jamBalls(tue, 8 * 60 + 40, learned);
  assert.ok(after >= before + 1.5, before + ' → ' + after);
  const calm = C.learnJams(null, tue, 8 * 60 + 40, 20, 22);
  assert.ok(C.jamBalls(tue, 8 * 60 + 40, calm) < before - 2, 'если доехал быстро — пробок меньше');
  assert.equal(C.jamBalls(new Date(2026, 9, 31), 8 * 60 + 40, learned), C.jamBalls(new Date(2026, 9, 31), 8 * 60 + 40, null), 'суббота не тронута');
});
