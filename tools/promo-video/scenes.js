// Раскадровка ролика. Всё считается от времени t (секунды): renderFrame(t) ставит каждый элемент в нужное положение,
// поэтому кадры можно снимать по одному и в любом порядке (render.mjs).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const E = {
    lin: (t) => t,
    out2: (t) => 1 - (1 - t) * (1 - t),
    out3: (t) => 1 - Math.pow(1 - t, 3),
    out4: (t) => 1 - Math.pow(1 - t, 4),
    in2: (t) => t * t,
    in3: (t) => t * t * t,
    inOut3: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inOut2: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    back: (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    backBig: (t) => { const c1 = 2.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  const P = (t, a, d, e = E.lin) => e(clamp((t - a) / d));
  const mk = (tag, cls, parent, html) => { const el = document.createElement(tag); if (cls) el.className = cls; if (html !== undefined) el.innerHTML = html; if (parent) parent.appendChild(el); return el; };

  // ── время сцен ──
  const S = { hook: [0, 6.3], pain: [6.1, 15.1], upload: [15.0, 22.2], analysis: [22.2, 33.0], price: [33.0, 40.5], review: [40.5, 49.5], package: [49.5, 57.5], trust: [57.4, 63.6], cta: [63.5, 69] };
  const TOTAL = 69;
  const WIN = { x: 110, y: 176, w: 1360 };
  const K = WIN.w / 1440; // масштаб «экран приложения → окно»

  // ── фон ──
  const dots = Array.from({ length: 46 }, (_, i) => {
    const r = (n) => { const x = Math.sin(i * 91.7 + n * 13.3) * 43758.5453; return x - Math.floor(x); };
    return { x: r(1) * 1920, y0: r(2) * 1180, size: 2 + r(3) * 4, speed: 8 + r(4) * 26, ph: r(5) * 6.28, el: mk('div', 'dot', $('#dots')) };
  });
  function bg(t) {
    $('#b1').style.transform = `translate(${Math.sin(t * 0.33) * 110}px,${Math.cos(t * 0.27) * 80}px)`;
    $('#b2').style.transform = `translate(${Math.cos(t * 0.29) * -120}px,${Math.sin(t * 0.31) * 90}px)`;
    $('#b3').style.transform = `translate(${Math.sin(t * 0.21) * 160}px,${Math.cos(t * 0.25) * -60}px)`;
    for (const d of dots) {
      const y = ((d.y0 - t * d.speed) % 1180 + 1180) % 1180 - 50;
      d.el.style.cssText = `left:${d.x}px;top:${y}px;width:${d.size}px;height:${d.size}px;opacity:${0.1 + 0.32 * Math.abs(Math.sin(t * 0.7 + d.ph))}`;
    }
  }

  // ── вспомогательное: текст по буквам ──
  function chars(el, text) {
    el.textContent = '';
    return [...text].map((c) => { const s = mk('span', 'ch', el); s.textContent = c === ' ' ? ' ' : c; return s; });
  }
  function fade(el, o, y = 0, s = 1, blur = 0) {
    el.style.opacity = o;
    el.style.transform = `translateY(${y}px) scale(${s})`;
    el.style.filter = blur > 0.05 ? `blur(${blur}px)` : '';
  }
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };

  // ── 1. заставка ──
  const hk1 = chars($('#hk-t1'), 'Тендерная заявка');
  const hk2 = $('#hk-t2'); hk2.innerHTML = '<span class="grad" id="hk-g">за 15 минут</span>';
  function hook(t) {
    const el = $('#hook'); show(el, t < S.hook[1] + 0.2);
    const out = P(t, 5.5, 0.75, E.in3);
    fade(el, 1 - out, -out * 60, 1 + out * 0.05, out * 6);
    const lp = P(t, 0.15, 1.4, E.out4);
    const logo = $('#hk-logo');
    logo.style.opacity = lp; logo.style.transform = `translateY(${(1 - lp) * 50}px) scale(${0.5 + 0.5 * lp}) rotate(${(1 - lp) * -30}deg)`;
    const ring = $('#hk-ring'); ring.style.opacity = P(t, 0.3, 1.1) * 0.9; ring.style.transform = `scale(${1 + (1 - lp) * 0.7 + 0.04 * Math.sin(t * 2.6)})`;
    hk1.forEach((c, i) => { const q = P(t, 1.0 + i * 0.04, 0.6, E.out4); c.style.opacity = q; c.style.transform = `translateY(${(1 - q) * 80}px)`; c.style.filter = q < 1 ? `blur(${(1 - q) * 8}px)` : ''; });
    const q2 = P(t, 2.0, 1.0, E.backBig);
    fade(hk2, clamp(q2 * 1.6), (1 - q2) * 110, 0.86 + 0.14 * q2, (1 - clamp(q2)) * 10);
    $('#hk-g').style.backgroundSize = '240% 100%'; $('#hk-g').style.backgroundPosition = `${50 + 50 * Math.sin(t * 0.9)}% 0`;
    fade($('#hk-sub'), P(t, 3.5, 0.9, E.out3), (1 - P(t, 3.5, 0.9, E.out3)) * 24);
  }

  // ── 2. боль ──
  const SHEETS = [
    ['Извещение', -330, -40, -15], ['Техническое задание', -250, 50, -10], ['Проект договора', -165, -30, -6], ['Порядок оценки', -80, 55, -2],
    ['Требования к заявке', 5, -25, 3], ['Приложение № 1', 90, 50, 7], ['Приложение № 2', 175, -20, 11], ['Разъяснения', 260, 45, 15],
  ].map(([label, dx, dy, rot], i) => {
    const el = mk('div', 'sheet', $('#pn-sheets'));
    el.style.left = `${1490 - 215 + dx * 0.82}px`; el.style.top = `${300 + dy}px`;
    mk('div', 'h', el, label);
    [92, 100, 86, 100, 74, 96, 100, 62, 90, 100, 80, 54].forEach((w, j) => { mk('div', 'b' + ((i * 3 + j) % 7 === 0 ? ' y' : ''), el).style.width = w + '%'; });
    return { el, dx, dy, rot, a: 6.5 + i * 0.34 };
  });
  const PHRASES = [
    { a: 6.7, b: 9.9, lines: ['Сотни страниц', 'документации'], cls: ['', 'grad'] },
    { a: 9.9, b: 12.5, lines: ['Десятки требований', 'и форм заказчика'], cls: ['', 'grad'] },
    { a: 12.5, b: 15.2, lines: ['Одна ошибка —', 'и заявку отклонят'], cls: ['', ''] },
  ].map((p) => {
    const box = mk('div', '', $('#pn-ph')); box.style.cssText = 'position:absolute;left:0;top:0;width:1000px';
    p.box = box;
    p.rows = p.lines.map((txt, j) => {
      const row = mk('div', '', box); row.style.cssText = 'overflow:hidden;padding:6px 0 14px;margin-bottom:-6px;white-space:nowrap';
      const inner = mk('div', '', row); inner.style.cssText = 'font-size:88px;font-weight:720;letter-spacing:-.035em;line-height:1.02';
      inner.innerHTML = p.cls[j] ? `<span class="${p.cls[j]}">${txt}</span>` : txt;
      if (p.a === 12.5 && j === 1) inner.style.color = '#f87171';
      return inner;
    });
    return p;
  });
  function pain(t) {
    const el = $('#pain'); show(el, t > S.pain[0] - 0.1 && t < S.pain[1] + 0.2);
    const exit = P(t, 14.3, 0.8, E.in3);
    el.style.opacity = 1 - exit; el.style.transform = `scale(${1 - exit * 0.06})`; el.style.filter = exit > 0.02 ? `blur(${exit * 14}px)` : '';
    const dim = P(t, 12.6, 0.4);
    SHEETS.forEach((s, i) => {
      const q = P(t, s.a, 0.8, E.back);
      const fl = Math.sin(t * 1.1 + i) * 7;
      s.el.style.opacity = clamp(q * 1.8);
      s.el.style.transform = `translate(${(1 - q) * 1000}px,${(1 - q) * 300 + fl}px) rotate(${s.rot + (1 - q) * 34}deg)`;
      s.el.style.filter = `brightness(${1 - dim * 0.35})`;
    });
    PHRASES.forEach((p) => {
      const on = t > p.a - 0.05 && t < p.b + 0.05;
      p.box.style.display = on ? '' : 'none';
      if (!on) return;
      p.rows.forEach((r, j) => {
        const qi = P(t, p.a + j * 0.14, 0.65, E.out4), qo = P(t, p.b - 0.4 - j * 0.05, 0.4, E.in3);
        r.style.transform = `translateY(${(1 - qi) * 112 - qo * 112}%)`;
      });
    });
    // печать
    const stamp = $('#pn-stamp');
    const q = P(t, 12.5, 0.22, E.out3);
    const shake = t > 12.7 && t < 13.15 ? Math.sin((t - 12.7) * 90) * (1 - P(t, 12.7, 0.45)) * 10 : 0;
    stamp.style.opacity = q < 0.02 ? 0 : 1;
    stamp.style.transform = `translate(${shake}px,${-shake * 0.6}px) rotate(-13deg) scale(${3.1 - 2.1 * q})`;
    $('#red').style.opacity = t > 12.65 ? 0.9 * (1 - P(t, 12.65, 0.8)) : 0;
    const cap = $('#pn-stamp-cap'); fade(cap, P(t, 13.3, 0.6, E.out3), (1 - P(t, 13.3, 0.6, E.out3)) * 20);
    $('#pn-sheets').style.transform = `translate(${shake * 0.8}px,${shake * 0.5}px)`;
  }

  // ── подписи шагов ──
  const CAPS = [
    { id: 'upload', chip: 'Шаг 1 из 5', title: 'Загрузите документы закупки', sub: 'PDF, Word, Excel, ZIP, сканы и фото — прямо с площадки' },
    { id: 'analysis', chip: 'Шаг 2 из 5', title: 'ИИ находит все требования', sub: 'Сверху — то, без чего отклонят. У каждого — цитата и место в документе' },
    { id: 'price', chip: 'Шаг 3 из 5', title: 'Считает, до какой цены снижаться', sub: 'Нижняя цена без убытка — по вашим расходам, без ИИ' },
    { id: 'review', chip: 'Шаг 4 из 5', title: 'Проверяет заявку перед подачей', sub: 'Жёлтым — что дописать или подтвердить. Видно, чем рискуете' },
    { id: 'package', chip: 'Шаг 5 из 5', title: 'Собирает пакет документов', sub: 'Файлы Word, PDF и ODT — по одному или одним архивом' },
  ];
  const railEls = [...document.querySelectorAll('#rail b')];
  function caps(t) {
    const cap = $('#cap');
    const idx = CAPS.findIndex((c) => t >= S[c.id][0] - 0.3 && t < S[c.id][1] - 0.3);
    show(cap, idx >= 0);
    if (idx < 0) return;
    const c = CAPS[idx], [a, b] = S[c.id];
    if (cap.dataset.id !== c.id) {
      cap.dataset.id = c.id;
      $('#cap-chip').innerHTML = `<span class="chip"><span class="mono">${c.chip}</span></span>`;
      $('#cap-title').textContent = c.title; $('#cap-sub').textContent = c.sub;
    }
    const qi = P(t, a, 0.7, E.out4), qo = P(t, b - 0.7, 0.45, E.in3);
    fade($('#cap-chip'), qi * (1 - qo), (1 - qi) * 20 - qo * 14);
    fade($('#cap-title'), P(t, a + 0.08, 0.7, E.out4) * (1 - qo), (1 - P(t, a + 0.08, 0.7, E.out4)) * 34 - qo * 18, 1, (1 - P(t, a + 0.08, 0.7, E.out3)) * 8);
    fade($('#cap-sub'), P(t, a + 0.2, 0.7, E.out3) * (1 - qo), (1 - P(t, a + 0.2, 0.7, E.out3)) * 22 - qo * 12);
    railEls.forEach((r, i) => { r.style.background = i < idx ? 'rgba(129,140,248,.8)' : i === idx ? 'linear-gradient(90deg,#818cf8,#22d3ee)' : 'rgba(255,255,255,.14)'; r.style.opacity = i === idx ? 1 : 0.9; });
  }

  // ── окно и камера ──
  const SCREENS = ['upload', 'analysis', 'price', 'review', 'package'];
  // камера: cx, cy — какая точка экрана приложения (в px 1440×900) в центре окна; s — увеличение; sc — прокрутка страницы
  const CAM = {
    upload: [[14.8, 720, 450, 1, 0], [16.2, 760, 470, 1.02, 0], [17.0, 852, 480, 1.5, 0], [19.4, 852, 500, 1.5, 0], [20.6, 860, 690, 1.22, 0], [22.4, 860, 700, 1.22, 0]],
    analysis: [[22.0, 720, 450, 1, 0], [23.3, 860, 470, 1.25, 0], [25.4, 860, 480, 1.25, 0], [26.6, 860, 450, 1.25, 380], [29.0, 860, 450, 1.25, 380], [30.0, 860, 520, 1.35, 640], [33.2, 860, 520, 1.35, 640]],
    price: [[32.8, 720, 450, 1, 0], [34.0, 860, 500, 1.2, 0], [37.0, 860, 500, 1.2, 0], [38.2, 1080, 470, 1.45, 0], [40.7, 1080, 470, 1.45, 0]],
    review: [[40.3, 720, 450, 1, 0], [41.6, 860, 420, 1.25, 0], [44.2, 860, 420, 1.25, 0], [45.2, 860, 470, 1.3, 0], [47.0, 860, 470, 1.3, 0], [48.0, 1000, 540, 1.3, 0], [49.7, 1000, 540, 1.3, 0]],
    package: [[49.3, 720, 450, 1, 0], [50.6, 860, 400, 1.3, 0], [52.2, 860, 400, 1.3, 0], [53.2, 860, 450, 1.25, 560], [56.0, 860, 450, 1.25, 560], [56.9, 860, 450, 1.25, 900], [57.7, 860, 450, 1.25, 900]],
  };
  function camAt(id, t) {
    const kf = CAM[id];
    if (t <= kf[0][0]) return { cx: kf[0][1], cy: kf[0][2], s: kf[0][3], sc: kf[0][4] };
    for (let i = 0; i < kf.length - 1; i++) {
      const [t0, x0, y0, s0, c0] = kf[i], [t1, x1, y1, s1, c1] = kf[i + 1];
      if (t <= t1) { const q = E.inOut3(clamp((t - t0) / (t1 - t0))); return { cx: lerp(x0, x1, q), cy: lerp(y0, y1, q), s: lerp(s0, s1, q), sc: lerp(c0, c1, q) }; }
    }
    const l = kf[kf.length - 1]; return { cx: l[1], cy: l[2], s: l[3], sc: l[4] };
  }
  // точка экрана приложения → точка на сцене (для выносок)
  function toStage(id, t, ax, ay, tall) {
    const c = camAt(id, t);
    const x = tall ? ax + 280 : ax, y = tall ? ay - c.sc : ay;
    return [WIN.x + 680 + K * c.s * (x - c.cx), WIN.y + 36 + 425 + K * c.s * (y - c.cy)];
  }
  const winEl = $('#win');
  function win(t) {
    const on = t > 14.6 && t < 58.1; show(winEl, on);
    if (!on) return;
    const wi = P(t, 14.8, 1.2, E.out4), wo = P(t, 57.0, 0.9, E.in3);
    winEl.style.opacity = clamp(wi * 1.5) * (1 - wo);
    winEl.style.transform = `perspective(2800px) translateY(${(1 - wi) * 380 - wo * 90}px) rotateX(${(1 - wi) * 18}deg) scale(${0.9 + 0.1 * wi + wo * 0.1})`;
    winEl.style.filter = wo > 0.02 ? `blur(${wo * 10}px)` : '';
    for (const id of SCREENS) {
      const el = $('#scr-' + id), [a, b] = S[id];
      const o = P(t, a - 0.25, 0.5) * (1 - P(t, b - 0.2, 0.5));
      el.style.display = o > 0.003 ? '' : 'none';
      if (o <= 0.003) continue;
      const c = camAt(id, t);
      el.style.opacity = o;
      el.style.transform = `translate(${680 - K * c.s * c.cx}px,${425 - K * c.s * c.cy}px) scale(${K * c.s})`;
      const tall = el.querySelector('.scroller img'); if (tall) tall.style.top = `${-c.sc}px`;
      const sc = el.querySelector('.scroller'); if (sc) sc.style.display = c.sc > 0.5 ? '' : 'none';
      const fab = el.querySelector('.fab'); if (fab) fab.style.display = c.sc > 0.5 ? '' : 'none';
    }
  }

  // ── загрузка: файлы летят в окно ──
  const UP_FILES = ['Извещение.pdf', 'Техническое задание.docx', 'Проект контракта.pdf', 'Порядок оценки.pdf'];
  const upChips = UP_FILES.map((name, i) => {
    const el = mk('div', 'pill', $('#fx'), `<span style="display:inline-block;width:26px;height:30px;margin-right:12px;vertical-align:-6px;border-radius:5px;background:linear-gradient(160deg,#a5b4fc,#6366f1)"></span>${name}`);
    el.style.fontSize = '24px'; el.style.padding = '12px 20px'; el.style.left = '0px'; el.style.top = '0px'; el.style.whiteSpace = 'nowrap';
    return { el, a: 16.6 + i * 0.55, from: [[-260, 220], [-260, 560], [-260, 870], [-260, 380]][i] };
  });
  function upload(t) {
    const cover = $('#up-cover');
    const q = P(t, 18.4, 1.7, E.inOut3);
    cover.style.top = `${610 + 290 * q}px`; cover.style.height = `${290 * (1 - q)}px`;
    const target = toStage('upload', t, 852, 497, false);
    upChips.forEach((c) => {
      const f = P(t, c.a, 0.95, E.inOut2);
      const on = t > c.a - 0.05 && t < c.a + 1.05;
      c.el.style.display = on ? '' : 'none';
      if (!on) return;
      const x = lerp(c.from[0], target[0] - 120, f), y = lerp(c.from[1], target[1] - 28, f) - Math.sin(f * Math.PI) * 130;
      const land = P(t, c.a + 0.78, 0.2);
      c.el.style.opacity = 1 - land; c.el.style.transform = `translate(${x}px,${y}px) rotate(${(1 - f) * -10}deg) scale(${1 - land * 0.55})`;
    });
  }

  // ── цена: ползунок (по снимку на каждый процент) ──
  const PR_V = Array.from({ length: 35 }, (_, i) => i);
  const prImgs = PR_V.map((v) => { const im = mk('img', 'abs', $('#scr-price')); im.src = `shots/price-${String(v).padStart(2, '0')}.png`; im.style.cssText = 'left:280px;top:342.5px;width:658px'; return im; });
  $('#pr-card').style.display = 'none';
  const sliderAt = (t) => (t < 34.7 ? 0 : t < 36.3 ? 20 * E.inOut3(P(t, 34.7, 1.6)) : t < 36.9 ? 20 : 20 + 14 * E.inOut3(P(t, 36.9, 1.3)));
  function price(t) {
    const v = Math.round(sliderAt(t));
    prImgs.forEach((im, i) => { im.style.opacity = i === v ? 1 : 0; });
  }

  // ── выноски ──
  // anchor: [x, y, tall] — точка на экране приложения (или функция от времени); at — где на сцене плашка; иначе dx, dy от точки
  const CALLS = [
    { scr: 'upload', a: 16.9, b: 19.4, anchor: [852, 470], dx: 330, dy: -250, tag: 'indigo', text: 'Всё, что скачали с площадки', sub: 'PDF, Word, Excel, ZIP, сканы и фото' },
    { scr: 'upload', a: 20.0, b: 22.0, anchor: [1290, 623], at: [1130, 400], tag: 'green', text: 'Комплект распознан', sub: 'Извещение, ТЗ, проект контракта, порядок оценки' },
    { scr: 'analysis', a: 23.5, b: 26.4, anchor: [250, 486, true], at: [900, 668], tag: 'red', text: 'Сразу видно, чего не хватает', sub: 'И ИИ составит техническое предложение' },
    { scr: 'analysis', a: 26.9, b: 29.8, anchor: [575, 779, true], at: [1010, 640], tag: 'indigo', text: () => { const n = Math.round(24 * E.out3(P(tNow, 27.0, 1.2))); return `Найдено требований: ${n}`; }, sub: 'Кто участвует · Что подать · ТЗ · Сроки и деньги · Оценка' },
    { scr: 'analysis', a: 30.3, b: 33.0, anchor: [367, 1170, true], at: [1150, 520], tag: 'cyan', text: 'Числа и границы читает код', sub: 'ИИ их не придумывает, ваши данные — ваши' },
    { scr: 'price', a: 35.0, b: 37.4, anchor: (t) => [280 + 21 + (sliderAt(t) / 99) * 616 + 6, 437.5], at: [1130, 345], tag: 'indigo', text: 'Двигайте ползунок', sub: 'Цена, экономия заказчика, предел до убытка' },
    { scr: 'price', a: 37.6, b: 40.3, anchor: [1200, 409], at: [1020, 862], tag: 'green', text: 'Нижняя цена — без убытка', sub: '449 289,74 ₽ — ниже контракт в убыток. Расчёт без ИИ' },
    { scr: 'review', a: 41.8, b: 44.3, anchor: [806, 415], at: [1130, 598], tag: 'green', text: 'Что заполнено само — и что вписать вам', sub: 'Автозаполнение · нужно ввести · требует действия' },
    { scr: 'review', a: 44.9, b: 47.2, anchor: [913, 467], at: [1130, 520], tag: 'red', text: 'Риск отклонения — с причинами', sub: 'Уровень по замечаниям проверки, без выдуманных процентов' },
    { scr: 'review', a: 47.9, b: 49.5, anchor: [1050, 560], at: [640, 330], tag: 'amber', text: 'Живой предпросмотр заявки', sub: 'Жёлтым — места, которые дописывает человек' },
    { scr: 'package', a: 50.8, b: 52.5, anchor: [1340, 485], at: [1050, 640], tag: 'amber', text: 'Итоговая проверка перед подачей', sub: 'Что заполнено, что подтвердить, что подписать' },
    { scr: 'package', a: 53.2, b: 54.9, anchor: [425, 710, true], at: [900, 700], tag: 'indigo', text: 'Word, PDF или ODT', sub: 'Один и тот же текст, жёлтые места те же' },
    { scr: 'package', a: 54.9, b: 56.6, anchor: [1120, 919, true], at: [900, 560], tag: 'green', text: 'Всё одним архивом — ZIP', sub: 'Все документы заявки одним файлом' },
    { scr: 'package', a: 56.7, b: 57.5, anchor: [1128, 1179, true], at: [900, 560], tag: 'cyan', text: 'Реестровые номера товаров', sub: 'Ищет в РПП и РЭП сразу, подставляет с пометкой «проверьте»' },
  ].map((c) => {
    const pill = mk('div', 'pill', $('#fx'));
    const dot = mk('div', 'anchor', $('#fx'));
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'rgba(165,180,252,.95)'); line.setAttribute('stroke-width', '3'); line.setAttribute('stroke-linecap', 'round');
    $('#lines').appendChild(line);
    return { ...c, pill, dot, line, w: 0, h: 0 };
  });
  let tNow = 0;
  function calls(t) {
    for (const c of CALLS) {
      const on = t > c.a - 0.05 && t < c.b + 0.05 && t > 14.9 && t < 57.6;
      c.pill.style.display = c.dot.style.display = c.line.style.display = on ? '' : 'none';
      if (!on) continue;
      const txt = typeof c.text === 'function' ? c.text() : c.text;
      if (!c.w || typeof c.text === 'function') {
        c.pill.style.width = '392px';
        c.pill.innerHTML = `<span class="tag tg-${c.tag}"></span>${txt}${c.sub ? `<small>${c.sub}</small>` : ''}`;
        c.w = c.w || c.pill.offsetWidth; c.h = c.h || c.pill.offsetHeight;
      }
      const anc = typeof c.anchor === 'function' ? c.anchor(t) : c.anchor;
      const [ax, ay] = toStage(c.scr, t, anc[0], anc[1], !!anc[2]);
      const px = 1500, py = clamp(ay - c.h / 2, 205, 1050 - c.h);
      const q = P(t, c.a, 0.5, E.back), qo = P(t, c.b - 0.4, 0.4, E.in2);
      const o = clamp(q * 1.8) * (1 - qo);
      c.pill.style.left = `${px}px`; c.pill.style.top = `${py}px`;
      c.pill.style.opacity = o; c.pill.style.transform = `scale(${0.7 + 0.3 * q}) translateY(${(1 - q) * 16 + qo * -10}px)`;
      c.dot.style.left = `${ax}px`; c.dot.style.top = `${ay}px`;
      c.dot.style.opacity = o; c.dot.style.transform = `scale(${(0.4 + 0.6 * q) * (1 + 0.18 * Math.sin(t * 7))})`;
      // линия от точки к ближайшему краю плашки
      const ex = px >= ax ? px : px + c.w, ey = py + c.h / 2;
      const len = Math.hypot(ex - ax, ey - ay);
      const d = P(t, c.a + 0.05, 0.4, E.out3);
      c.line.setAttribute('d', `M${ax},${ay} L${ex},${ey}`); c.line.setAttribute('stroke-width', '2.5');
      c.line.style.strokeDasharray = `${len}`; c.line.style.strokeDashoffset = `${len * (1 - d)}`;
      c.line.style.opacity = o;
    }
  }

  // ── 7. принципы ──
  const trT = chars($('#tr-title'), 'На что можно положиться');
  const PC = ['#pc1', '#pc2', '#pc3'].map((s) => $(s));
  function trust(t) {
    const el = $('#trust'); show(el, t > S.trust[0] - 0.1 && t < S.trust[1] + 0.2);
    const out = P(t, 62.9, 0.65, E.in3);
    fade(el, 1 - out, -out * 40, 1 + out * 0.05, out * 8);
    trT.forEach((c, i) => { const q = P(t, 57.85 + i * 0.03, 0.55, E.out4); c.style.opacity = q; c.style.transform = `translateY(${(1 - q) * 60}px)`; });
    fade($('#tr-sub'), P(t, 58.5, 0.7, E.out3), (1 - P(t, 58.5, 0.7, E.out3)) * 20);
    PC.forEach((c, i) => {
      const q = P(t, 58.7 + i * 0.35, 0.85, E.back);
      c.style.opacity = clamp(q * 1.8); c.style.transform = `translateY(${(1 - q) * 140 + Math.sin(t * 1.3 + i * 1.7) * 6}px) scale(${0.88 + 0.12 * q})`;
      c.querySelector('img').style.transform = `translateY(${Math.sin(t * 1.9 + i) * 8}px) rotate(${Math.sin(t * 1.1 + i) * 3}deg)`;
    });
    const qs = P(t, 61.0, 0.8, E.out3);
    $('#tr-soon').style.opacity = qs;
    $('#tr-soon').style.transform = `translateX(-50%) translateY(${(1 - qs) * 30}px)`;
  }

  // ── 8. финал ──
  const ctName = chars($('#ct-name'), 'Тендерный юрист');
  const ctTag = $('#ct-tag'); ctTag.innerHTML = '<span class="grad" id="ct-g">Готовая заявка за 15 минут</span>';
  function cta(t) {
    const el = $('#cta'); show(el, t > S.cta[0] - 0.1);
    const lp = P(t, 63.7, 1.2, E.out4);
    const logo = $('#ct-logo'); logo.style.opacity = lp; logo.style.transform = `scale(${0.6 + 0.4 * lp}) rotate(${(1 - lp) * 40}deg)`;
    $('#ct-ring').style.opacity = lp * 0.9; $('#ct-ring').style.transform = `scale(${1 + (1 - lp) * 0.6 + 0.04 * Math.sin(t * 2.6)})`;
    ctName.forEach((c, i) => { const q = P(t, 64.5 + i * 0.04, 0.6, E.out4); c.style.opacity = q; c.style.transform = `translateY(${(1 - q) * 70}px)`; c.style.filter = q < 1 ? `blur(${(1 - q) * 8}px)` : ''; });
    const q2 = P(t, 65.4, 0.9, E.back); fade(ctTag, clamp(q2 * 1.6), (1 - q2) * 60, 0.9 + 0.1 * q2);
    $('#ct-g').style.backgroundSize = '240% 100%'; $('#ct-g').style.backgroundPosition = `${50 + 50 * Math.sin(t * 0.9)}% 0`;
    const b = $('#cta-btn'); const qb = P(t, 66.1, 0.8, E.back);
    b.style.opacity = clamp(qb * 1.8); b.style.transform = `translateX(-50%) translateY(${(1 - qb) * 50}px) scale(${0.8 + 0.2 * qb + 0.025 * Math.sin(t * 4.2) * P(t, 66.9, 0.4)})`;
    b.style.boxShadow = `0 0 ${50 + 30 * Math.sin(t * 4.2)}px rgba(129,140,248,${0.55 * P(t, 66.6, 0.5)})`;
    fade($('#ct-foot'), P(t, 66.8, 0.8), 0);
  }

  // ── общий кадр ──
  function renderFrame(t) {
    tNow = t;
    bg(t); hook(t); pain(t); win(t); upload(t); price(t); caps(t); calls(t); trust(t); cta(t);
    const f = t > 14.55 && t < 15.5 ? 0.38 * Math.sin(Math.PI * P(t, 14.55, 0.95)) : 0;
    $('#flash').style.opacity = f;
    $('#black').style.opacity = Math.max(1 - P(t, 0, 0.5), P(t, 68.2, 0.8));
  }
  window.renderFrame = renderFrame;
  window.VIDEO = { FPS: 30, TOTAL };
  window.ready = (async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
    await Promise.all(['500 40px Geist', '700 40px Geist', '400 20px "Geist Mono"'].map((f) => document.fonts.load(f, 'Тендерный юрист АБВ abc 0123')));
    renderFrame(0);
    return true;
  })();

  const m = /[?&]t=([\d.]+)/.exec(location.search);
  const fit = /[?&]fit/.test(location.search);
  if (fit) { const f = () => { const s = Math.min(innerWidth / 1920, innerHeight / 1080); $('#stage').style.transform = `scale(${s})`; }; f(); addEventListener('resize', f); }
  if (m) window.ready.then(() => renderFrame(parseFloat(m[1])));
})();
