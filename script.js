'use strict';
(() => {
  const LS_KEY = 'quickprompt:v1';
  const DEFAULTS = { script: '', speed: 3, fontSize: 48, mirror: false, guide: true };
  const SAMPLE = 'Welcome to QuickPrompt.\n\nPaste your script here, then press "Start prompting".\n\nTap the screen to pause or resume. Use the bar at the bottom to adjust speed and font size while you read.\n\nYour text is saved in this browser only — it never leaves your device.';

  const $ = (id) => document.getElementById(id);
  const el = {
    script: $('script'), startBtn: $('startBtn'),
    prompter: $('prompter'), viewport: $('viewport'), mover: $('mover'),
    textwrap: $('textwrap'), ptext: $('ptext'),
    progress: $('progress'), guide: $('guide'),
    countdown: $('countdown'), endcap: $('endcap'), playbar: $('playbar'),
    exitBtn: $('exitBtn'), restartBtn: $('restartBtn'), playBtn: $('playBtn'),
    speedDown: $('speedDown'), speedUp: $('speedUp'), speedVal: $('speedVal'),
    fontDown: $('fontDown'), fontUp: $('fontUp'),
    mirrorBtn: $('mirrorBtn'), guideBtn: $('guideBtn'), fsBtn: $('fsBtn'),
    timeLeft: $('timeLeft')
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---------- state & persistence ----------
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return Object.assign({}, DEFAULTS, { script: SAMPLE });
      const d = JSON.parse(raw);
      return {
        script: typeof d.script === 'string' ? d.script : '',
        speed: clamp(Number(d.speed) || DEFAULTS.speed, 0.5, 10),
        fontSize: clamp(Number(d.fontSize) || DEFAULTS.fontSize, 24, 120),
        mirror: !!d.mirror,
        guide: d.guide !== false
      };
    } catch (_) {
      return Object.assign({}, DEFAULTS, { script: SAMPLE });
    }
  }
  let settings = load();
  let saveTimer = 0;
  function save(now) {
    clearTimeout(saveTimer);
    const doSave = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (_) {} };
    if (now) doSave(); else saveTimer = setTimeout(doSave, 400);
  }

  const pxPerSec = () => settings.speed * 20;

  // ---------- prompter engine ----------
  let playing = false, pos = 0, lastT = 0, rafId = 0;
  let contentH = 0, viewH = 0, barTimer = 0, cdTimer = 0, timeAcc = 0;
  let wakeLock = null;

  const maxPos = () => Math.max(0, contentH - viewH);
  const countdownActive = () => !el.countdown.hidden;

  function measure() {
    viewH = el.viewport.clientHeight;
    contentH = el.mover.offsetHeight;
  }
  function setPos(p) {
    pos = clamp(p, 0, maxPos());
    el.mover.style.transform = 'translate3d(0,' + (-pos) + 'px,0)';
    el.progress.style.width = maxPos() ? (pos / maxPos() * 100) + '%' : '0%';
  }
  const fmt = (s) => {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  function updateTime() { el.timeLeft.textContent = fmt((maxPos() - pos) / pxPerSec()); }

  function showBar(sticky) {
    el.playbar.classList.remove('hide');
    clearTimeout(barTimer);
    if (!sticky && playing) barTimer = setTimeout(() => el.playbar.classList.add('hide'), 2600);
  }

  function play() {
    if (pos >= maxPos()) setPos(0);
    el.endcap.hidden = true;
    playing = true;
    el.playBtn.textContent = '⏸';
    el.playBtn.setAttribute('aria-label', 'Pause');
    lastT = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
    requestWake();
    showBar();
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(rafId);
    el.playBtn.textContent = '▶';
    el.playBtn.setAttribute('aria-label', 'Play');
    showBar(true);
  }
  const toggle = () => (playing ? pause() : play());

  function tick(t) {
    if (!playing) return;
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.1) dt = 0.1;
    setPos(pos + pxPerSec() * dt);
    timeAcc += dt;
    if (timeAcc > 0.3) { timeAcc = 0; updateTime(); }
    if (pos >= maxPos()) { ended(); return; }
    rafId = requestAnimationFrame(tick);
  }
  function ended() {
    playing = false;
    el.playBtn.textContent = '▶';
    el.playBtn.setAttribute('aria-label', 'Play');
    el.endcap.hidden = false;
    updateTime();
    showBar(true);
  }
  function restart() {
    stopCountdown();
    el.endcap.hidden = true;
    setPos(0);
    updateTime();
    if (playing) lastT = performance.now(); else showBar(true);
  }

  // ---------- countdown ----------
  function startCountdown() {
    let n = 3;
    el.countdown.hidden = false;
    el.countdown.textContent = n;
    cdTimer = setInterval(() => {
      n--;
      if (n <= 0) { stopCountdown(); play(); } else el.countdown.textContent = n;
    }, 800);
  }
  function stopCountdown() {
    clearInterval(cdTimer); cdTimer = 0;
    el.countdown.hidden = true;
  }

  // ---------- open / close ----------
  function openPrompter() {
    save(true);
    el.ptext.textContent = settings.script;
    applyFont(); applyMirror(); applyGuide();
    el.prompter.hidden = false;
    document.body.classList.add('lock');
    el.endcap.hidden = true;
    measure(); setPos(0); updateTime();
    requestWake();
    showBar(true);
    startCountdown();
  }
  function closePrompter() {
    stopCountdown();
    pause();
    releaseWake();
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
    el.prompter.hidden = true;
    document.body.classList.remove('lock');
    save(true);
  }

  // ---------- settings ----------
  function applyFont() { el.ptext.style.fontSize = settings.fontSize + 'px'; }
  function applyMirror() {
    el.textwrap.classList.toggle('mirror', settings.mirror);
    el.mirrorBtn.setAttribute('aria-pressed', String(settings.mirror));
  }
  function applyGuide() {
    el.guide.hidden = !settings.guide;
    el.guideBtn.setAttribute('aria-pressed', String(settings.guide));
  }
  function setSpeed(v) {
    settings.speed = clamp(Math.round(v * 10) / 10, 0.5, 10);
    el.speedVal.textContent = settings.speed.toFixed(1);
    updateTime(); save();
  }
  function setFont(v) {
    const ratio = maxPos() ? pos / maxPos() : 0;
    settings.fontSize = clamp(v, 24, 120);
    applyFont();
    if (!el.prompter.hidden) { measure(); setPos(ratio * maxPos()); updateTime(); }
    save();
  }
  function toggleMirror() { settings.mirror = !settings.mirror; applyMirror(); save(); }
  function toggleGuide() { settings.guide = !settings.guide; applyGuide(); save(); }

  // ---------- wake lock ----------
  async function requestWake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) { wakeLock = null; }
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (_) {} wakeLock = null; }

  // ---------- hold-to-repeat buttons ----------
  function holdable(btn, fn) {
    let iv = 0, to = 0;
    const stop = () => { clearTimeout(to); clearInterval(iv); iv = to = 0; };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); fn(); showBar();
      to = setTimeout(() => { iv = setInterval(fn, 80); }, 400);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); showBar(); }
    });
  }

  // ---------- wiring ----------
  el.script.value = settings.script;
  const updateStart = () => { el.startBtn.disabled = el.script.value.trim() === ''; };
  updateStart();
  el.script.addEventListener('input', () => {
    settings.script = el.script.value; updateStart(); save();
  });
  el.script.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !el.startBtn.disabled) openPrompter();
  });
  el.startBtn.addEventListener('click', openPrompter);

  el.viewport.addEventListener('click', () => {
    if (countdownActive()) { stopCountdown(); play(); } else { toggle(); }
  });
  el.exitBtn.addEventListener('click', closePrompter);
  el.restartBtn.addEventListener('click', restart);
  el.playBtn.addEventListener('click', toggle);
  holdable(el.speedDown, () => setSpeed(settings.speed - 0.1));
  holdable(el.speedUp, () => setSpeed(settings.speed + 0.1));
  holdable(el.fontDown, () => setFont(settings.fontSize - 4));
  holdable(el.fontUp, () => setFont(settings.fontSize + 4));
  el.mirrorBtn.addEventListener('click', toggleMirror);
  el.guideBtn.addEventListener('click', toggleGuide);

  const fsRoot = document.documentElement;
  const fsSupported = !!(fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen);
  if (!fsSupported) el.fsBtn.hidden = true;
  el.fsBtn.addEventListener('click', () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        const r = el.prompter.requestFullscreen || el.prompter.webkitRequestFullscreen;
        const p = r.call(el.prompter);
        if (p && p.catch) p.catch(() => {});
      }
    } catch (_) {}
  });

  document.addEventListener('keydown', (e) => {
    if (el.prompter.hidden || e.target === el.script) return;
    const k = e.key;
    if (k === ' ') {
      e.preventDefault();
      if (countdownActive()) { stopCountdown(); play(); } else toggle();
    } else if (k === 'ArrowUp') { e.preventDefault(); setSpeed(settings.speed + 0.1); showBar(); }
    else if (k === 'ArrowDown') { e.preventDefault(); setSpeed(settings.speed - 0.1); showBar(); }
    else if (k === 'ArrowRight') { e.preventDefault(); setPos(pos + 120); updateTime(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); setPos(pos - 120); updateTime(); }
    else if (k === 'PageDown') { e.preventDefault(); setPos(pos + 300); updateTime(); }
    else if (k === 'PageUp') { e.preventDefault(); setPos(pos - 300); updateTime(); }
    else if (k === '+' || k === '=') { setFont(settings.fontSize + 4); }
    else if (k === '-' || k === '_') { setFont(settings.fontSize - 4); }
    else if (k === 'm' || k === 'M') { toggleMirror(); showBar(); }
    else if (k === 'g' || k === 'G') { toggleGuide(); showBar(); }
    else if (k === 'f' || k === 'F') { if (!el.fsBtn.hidden) el.fsBtn.click(); }
    else if (k === 'r' || k === 'R' || k === 'Home') { restart(); }
    else if (k === 'Escape') { if (!document.fullscreenElement) closePrompter(); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastT = performance.now();
      if (!el.prompter.hidden) requestWake();
    } else {
      if (countdownActive()) { stopCountdown(); showBar(true); }
      if (playing) pause();
    }
  });

  let rzTimer = 0;
  window.addEventListener('resize', () => {
    if (el.prompter.hidden) return;
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      const r = maxPos() ? pos / maxPos() : 0;
      measure(); setPos(r * maxPos()); updateTime();
    }, 150);
  });

  // initial bar labels / states
  setSpeed(settings.speed);
  applyMirror();
  applyGuide();
})();
