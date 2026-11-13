/*
 * Cut — logique de l'interface.
 */
(() => {
  'use strict';

  const TC = window.Timecode;
  const api = window.cut;
  const $ = (id) => document.getElementById(id);

  const el = {
    body: document.body,
    empty: $('emptyState'), dropCard: $('dropCard'), emptyLoading: $('emptyLoading'),
    editor: $('editor'),
    fileName: $('fileName'), fileChips: $('fileChips'),
    video: $('video'), stage: $('stage'), stageOverlay: $('stageOverlay'), stageBanner: $('stageBanner'),
    previewChip: $('previewChip'),
    btnPlay: $('btnPlay'), timeCurrent: $('timeCurrent'), timeTotal: $('timeTotal'),
    btnMute: $('btnMute'), volume: $('volume'),
    area: $('tlArea'), track: $('tlTrack'), sel: $('tlSel'), ghost: $('tlGhost'), playhead: $('tlPlayhead'),
    hover: $('tlHover'), hoverLabel: $('tlHoverLabel'), ticks: $('tlTicks'),
    hIn: $('hIn'), hOut: $('hOut'),
    zoom: $('tlZoom'), zoomThumb: $('tlZoomThumb'), btnZoomReset: $('btnZoomReset'),
    inStart: $('inStart'), inEnd: $('inEnd'),
    btnSetIn: $('btnSetIn'), btnSetOut: $('btnSetOut'), btnGoIn: $('btnGoIn'), btnGoOut: $('btnGoOut'),
    clipDuration: $('clipDuration'),
    btnPreview: $('btnPreview'), btnReset: $('btnReset'),
    modeButtons: [...document.querySelectorAll('.segmented button')],
    modeInfo: $('modeInfo'), explain: $('explain'),
    exportRow: $('exportRow'), exportDir: $('exportDir'), btnChangeDir: $('btnChangeDir'),
    exportName: $('exportName'), exportExt: $('exportExt'), btnExport: $('btnExport'),
    exportStatus: $('exportStatus'), statusTitle: $('statusTitle'), statusDetail: $('statusDetail'),
    progressFill: $('progressFill'), statusActions: $('statusActions'),
    dropOverlay: $('dropOverlay'), toast: $('toast'),
  };

  const state = {
    info: null,
    in: 0,
    out: 0,
    mode: 'smart', // 'smart' (début exact) | 'copy' (sans perte, calé sur une image clé)
    snap: 'prev',
    keyframes: null, // { prev, next, list, forIn }
    kfToken: 0,
    exportDir: null,
    customExportDir: null,
    nameDirty: false,
    exporting: false,
    previewing: false,
    previewEnd: 0,
    view: { start: 0, end: 0 },
    playable: true,
    // Chromium place l'horloge du lecteur sur les timestamps absolus du fichier quand
    // celui-ci ne commence pas à 0 ; FFmpeg compte à partir du début du fichier.
    mediaOffset: 0,
    loadToken: 0,
    settings: {},
  };

  // ------------------------------------------------------------------ utilitaires
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // Au-delà de cet écart entre le point choisi et l'image clé, on prévient clairement.
  const FAR_KEYFRAME = 10;
  const fps = () => (state.info && state.info.video && state.info.video.fps) || 30;
  const frameDur = () => 1 / fps();
  const duration = () => (state.info ? state.info.duration : 0);

  function fmtBytes(n) {
    if (!Number.isFinite(n)) return '';
    const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`;
  }

  function fmtSec(s) {
    return `${s.toFixed(2).replace('.', ',')} s`;
  }

  function sanitizeName(name) {
    return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer = null;
  function toast(msg, { error = false, ms = 4500 } = {}) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('error', error);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, error ? Math.max(ms, 7000) : ms);
  }

  function saveSettings(patch) {
    Object.assign(state.settings, patch);
    api.setSettings(patch);
  }

  // ------------------------------------------------------------------ chargement
  async function openPath(file) {
    if (!file) return;
    if (state.exporting) {
      toast('Un export est en cours. Attendez la fin ou annulez-le avant d\'ouvrir une autre vidéo.');
      return;
    }
    const token = ++state.loadToken;
    const hadVideo = !!state.info;
    if (!hadVideo) { el.dropCard.hidden = true; el.emptyLoading.hidden = false; }
    const res = await api.probe(file);
    if (token !== state.loadToken) return;
    if (!hadVideo) { el.dropCard.hidden = false; el.emptyLoading.hidden = true; }
    if (!res.ok) {
      toast(res.error, { error: true });
      return;
    }
    loadVideo(res.info);
  }

  function loadVideo(info) {
    stopPreview();
    state.info = info;
    state.in = 0;
    state.out = info.duration;
    state.keyframes = null;
    state.nameDirty = false;
    state.view = { start: 0, end: info.duration };
    state.playable = !info.video || info.video.previewable;
    state.mediaOffset = Math.max(0, info.startTime || 0);
    // Chaque nouvelle vidéo repart en mode sans perte.
    state.mode = 'smart';
    state.snap = 'prev';
    for (const b of el.modeButtons) b.setAttribute('aria-checked', String(b.dataset.mode === 'smart'));

    document.title = `${info.name} — Cut`;
    el.body.classList.remove('is-empty');
    el.empty.hidden = true;
    el.editor.hidden = false;

    el.fileName.textContent = info.name;
    el.fileName.title = info.path;
    const chips = [];
    if (info.video) {
      chips.push(`${info.video.width}×${info.video.height}`);
      if (info.video.fps) chips.push(`${Math.round(info.video.fps * 100) / 100} i/s`);
      chips.push(info.video.codecLabel);
    }
    if (info.audio.length) {
      chips.push(info.audio.length > 1 ? `${info.audio[0].codecLabel} ×${info.audio.length}` : info.audio[0].codecLabel);
    }
    chips.push(TC.format(info.duration, { ms: false }));
    if (info.size) chips.push(fmtBytes(info.size));
    el.fileChips.textContent = chips.join('  ·  ');
    el.timeTotal.textContent = `/ ${TC.format(info.duration)}`;

    // Lecteur
    el.stageOverlay.hidden = true;
    el.stageBanner.hidden = true;
    const v = el.video;
    v.pause();
    v.removeAttribute('src');
    v.load();
    if (info.video && !info.video.previewable) {
      showUnplayable();
    } else {
      v.src = info.url;
      v.load();
    }
    const badAudio = info.audio.find((a) => !a.previewable);
    if (badAudio && info.audio.every((a) => !a.previewable)) {
      el.stageBanner.textContent = `Aperçu sans son : le lecteur ne sait pas lire l'audio ${badAudio.codecLabel}. L'export conserve l'audio original.`;
      el.stageBanner.hidden = false;
    }

    // Export
    const ext = info.ext;
    const options = ['mp4', 'mkv', 'mov'];
    if (!options.includes(ext) && ext) options.unshift(ext);
    el.exportExt.innerHTML = options.map((o) => `<option value="${o}">.${o}</option>`).join('');
    const defaultExt = ['mp4', 'mkv', 'mov', 'webm'].includes(ext) ? ext : ext === 'm4v' ? 'm4v' : 'mp4';
    el.exportExt.value = options.includes(defaultExt) ? defaultExt : 'mp4';
    el.exportExt.title = `Format du fichier exporté. Les flux sont copiés tels quels (source : .${ext}).`;
    resolveExportDir();

    showExportRow();
    updateAll();
    requestKeyframes();
  }

  function showUnplayable() {
    state.playable = false;
    const codec = state.info.video ? state.info.video.codecLabel : '';
    el.stageOverlay.innerHTML = `<strong>Aperçu indisponible pour ce format</strong>
      <span>Le lecteur intégré ne sait pas décoder la vidéo ${escapeHtml(codec)}.<br>
      Vous pouvez quand même saisir le début et la fin, puis exporter : la découpe fonctionne normalement.</span>`;
    el.stageOverlay.hidden = false;
    updateButtons();
  }

  async function resolveExportDir() {
    const custom = state.settings.exportDir;
    if (custom && await api.dirOk(custom)) state.exportDir = custom;
    else state.exportDir = state.info.dir;
    el.exportDir.textContent = '‎' + state.exportDir + '‎';
    el.exportDir.title = state.exportDir;
  }

  // ------------------------------------------------------------------ sélection & images clés
  /**
   * Mode « début exact » : comment le clip sera produit (même logique que le moteur).
   *   copy    : le début tombe sur une image clé → copie intégrale sans réencodage
   *   smart   : seules les `head` secondes jusqu'à l'image clé suivante sont réencodées
   *   precise : tout le clip est réencodé (clip très court, ou codec qui ne s'y prête pas)
   * null pendant la recherche des images clés.
   */
  function smartDecision() {
    if (!state.info || !state.info.video || state.in <= 0.0005) return { kind: 'copy' };
    const kf = state.keyframes;
    if (!kf || Math.abs(kf.forIn - state.in) > 1e-6) return null;
    const half = frameDur() / 2;
    if (Math.abs(kf.prev - state.in) <= half) return { kind: 'copy', exact: true };
    const v = state.info.video;
    if (!['h264', 'hevc'].includes(v.codec) || (v.rotation && v.rotation % 360 !== 0)) return { kind: 'precise', reason: 'codec' };
    if (kf.next == null || kf.next >= state.out - half) return { kind: 'precise', reason: 'short' };
    return { kind: 'smart', head: kf.next - state.in };
  }

  function effectiveStart() {
    if (state.mode === 'smart') return smartDecision() ? state.in : null;
    if (state.in <= 0.0005) return state.in;
    const kf = state.keyframes;
    if (!kf || Math.abs(kf.forIn - state.in) > 1e-6) return null; // en cours de calcul
    if (state.snap === 'next' && kf.next != null && kf.next < state.out) return kf.next;
    return kf.prev;
  }

  let kfTimer = null;
  function requestKeyframes() {
    clearTimeout(kfTimer);
    if (!state.info || !state.info.video) {
      state.keyframes = { prev: state.in, next: null, list: [], forIn: state.in };
      updateAll();
      return;
    }
    if (state.in <= 0.0005) {
      state.keyframes = { prev: 0, next: null, list: [0], forIn: state.in };
      updateAll();
      return;
    }
    const token = ++state.kfToken;
    const t = state.in;
    kfTimer = setTimeout(async () => {
      const res = await api.keyframes(state.info.path, t, state.info);
      if (token !== state.kfToken) return;
      if (res.ok) state.keyframes = { prev: res.prev, next: res.next, list: res.list, forIn: t };
      else state.keyframes = { prev: t, next: null, list: [], forIn: t, error: res.error };
      updateAll();
    }, 120);
  }

  function setIn(t, { seek = false } = {}) {
    if (!state.info) return false;
    t = clamp(t, 0, duration());
    if (t >= state.out - 0.001) {
      toast('Le début doit être placé avant la fin du clip.');
      updateFields();
      return false;
    }
    state.in = t;
    afterSelectionChange();
    requestKeyframes();
    if (seek) seekTo(t);
    return true;
  }

  function setOut(t, { seek = false } = {}) {
    if (!state.info) return false;
    t = clamp(t, 0, duration());
    if (t <= state.in + 0.001) {
      toast('La fin doit être placée après le début du clip.');
      updateFields();
      return false;
    }
    state.out = t;
    afterSelectionChange();
    if (seek) seekTo(t);
    return true;
  }

  function afterSelectionChange() {
    if (!state.exporting && !el.exportStatus.hidden) showExportRow();
    updateAll();
  }

  function resetSelection() {
    if (!state.info) return;
    stopPreview();
    state.in = 0;
    state.out = duration();
    state.nameDirty = false;
    requestKeyframes();
    afterSelectionChange();
  }

  // ------------------------------------------------------------------ rendu
  function updateAll() {
    updateFields();
    updateTimeline();
    updateModeInfo();
    updateExportName();
    updateButtons();
  }

  function updateFields() {
    if (document.activeElement !== el.inStart) el.inStart.value = TC.format(state.in);
    if (document.activeElement !== el.inEnd) el.inEnd.value = TC.format(state.out);
    el.inStart.classList.remove('invalid');
    el.inEnd.classList.remove('invalid');
    const eff = effectiveStart();
    const d = state.out - (eff == null ? state.in : eff);
    el.clipDuration.textContent = TC.format(Math.max(0, d));
    el.clipDuration.title = eff != null && Math.abs(eff - state.in) > 0.0005
      ? `Durée réelle du fichier exporté (sélection : ${TC.format(state.out - state.in)})`
      : '';
  }

  function updateButtons() {
    const busy = state.exporting;
    el.btnExport.disabled = busy || !state.info || effectiveStart() == null;
    const dec = state.mode === 'smart' ? smartDecision() : null;
    el.btnExport.textContent = dec && dec.kind === 'precise' ? 'Exporter (réencodage)' : 'Exporter';
    el.btnPreview.disabled = !state.playable;
    el.btnPlay.disabled = !state.playable;
    for (const b of el.modeButtons) b.disabled = busy;
  }

  function updateModeInfo() {
    if (!state.info) return;
    const m = el.modeInfo;
    const why = ' <button class="link-btn" data-act="explain">Pourquoi ?</button>';
    const lossless = '<span class="ok-dot"></span>Copie directe des flux, <strong>sans réencodage</strong> : qualité, codecs et audio identiques à l\'original.';
    if (state.in <= 0.0005 || !state.info.video) {
      m.innerHTML = `${lossless} Le clip commence au tout début de la vidéo.`;
      return;
    }
    const kf = state.keyframes;
    if (!kf || Math.abs(kf.forIn - state.in) > 1e-6) {
      m.innerHTML = 'Recherche de l\'image clé la plus proche…';
      return;
    }

    if (state.mode === 'smart') {
      const d = smartDecision();
      if (d.kind === 'copy') {
        m.innerHTML = `${lossless} Votre point de début tombe exactement sur une image clé.`;
        return;
      }
      const rest = state.out - state.in;
      if (d.kind === 'precise') {
        m.innerHTML = d.reason === 'short'
          ? `Le clip commence exactement à votre point. Très court, il est <span class="warn">entièrement réencodé</span> en très haute qualité (${TC.human(rest)}).${why}`
          : `Pour cette vidéo (${escapeHtml(state.info.video.codecLabel)}), commencer exactement à votre point demande de `
            + `<span class="warn">réencoder tout le clip</span> (${TC.human(rest)}) en très haute qualité. `
            + `<button class="link-btn" data-act="mode-copy">Copier sans perte depuis une image clé</button> ·${why}`;
        return;
      }
      const far = d.head > FAR_KEYFRAME;
      m.innerHTML = `Le clip commence <strong>exactement à votre point</strong>. `
        + `Seules les ${far ? '<span class="warn">' : '<strong>'}${fmtSec(d.head)}${far ? '</span>' : '</strong>'} jusqu'à la première image clé sont réencodées en très haute qualité ; `
        + `le reste (${TC.human(Math.max(0, rest - d.head))}) est copié tel quel, <strong>sans perte</strong>.${why}`;
      return;
    }

    // Mode « sans perte » : le clip démarre sur une image clé.
    const half = frameDur() / 2;
    if (Math.abs(kf.prev - state.in) <= half) {
      m.innerHTML = `${lossless} Votre point de début tombe exactement sur une image clé.`;
      return;
    }
    const nextUsable = kf.next != null && kf.next < state.out;
    if (state.snap === 'next' && nextUsable) {
      m.innerHTML = `Le clip commencera à l'image clé suivante, <strong>${TC.format(kf.next)}</strong>, `
        + `soit ${fmtSec(kf.next - state.in)} <strong>après</strong> votre point (partie hachurée exclue). `
        + `<button class="link-btn" data-act="snap-prev">Image clé précédente</button> · `
        + `<button class="link-btn" data-act="mode-smart">Début exact</button> ·${why}`;
      return;
    }
    const offset = state.in - kf.prev;
    let html = offset > FAR_KEYFRAME
      ? `<span class="warn">Pas d'image clé proche.</span> Le clip commencerait à <strong>${TC.format(kf.prev)}</strong>, `
        + `soit ${TC.human(offset)} <strong>avant</strong> votre point. `
      : `Le clip commencera à l'image clé <strong>${TC.format(kf.prev)}</strong>, `
        + `soit ${fmtSec(offset)} <strong>avant</strong> votre point (partie hachurée incluse). `;
    if (nextUsable) html += `<button class="link-btn" data-act="snap-next">Image clé suivante</button> · `;
    html += `<button class="link-btn" data-act="mode-smart">Début exact</button> ·${why}`;
    m.innerHTML = html;
  }

  el.modeInfo.addEventListener('click', (e) => {
    const act = e.target && e.target.dataset && e.target.dataset.act;
    if (!act) return;
    if (act === 'explain') el.explain.hidden = !el.explain.hidden;
    if (act === 'snap-next') setSnap('next');
    if (act === 'snap-prev') setSnap('prev');
    if (act === 'mode-smart') setMode('smart');
    if (act === 'mode-copy') setMode('copy');
  });

  function setSnap(s) {
    state.snap = s; // volontairement non mémorisé : chaque vidéo repart sur l'image clé précédente
    afterSelectionChange();
  }

  function setMode(mode) {
    if (state.exporting) return;
    state.mode = mode;
    for (const b of el.modeButtons) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    afterSelectionChange();
  }
  for (const b of el.modeButtons) b.addEventListener('click', () => setMode(b.dataset.mode));

  function updateExportName() {
    if (!state.info || state.nameDirty) return;
    el.exportName.value = `${state.info.base} [${TC.forFilename(state.in)}-${TC.forFilename(state.out)}]`;
  }

  // ------------------------------------------------------------------ timeline
  const viewSpan = () => Math.max(1e-6, state.view.end - state.view.start);
  const timeToPct = (t) => ((t - state.view.start) / viewSpan()) * 100;
  function xToTime(clientX) {
    const r = el.track.getBoundingClientRect();
    const ratio = clamp((clientX - r.left) / r.width, 0, 1);
    return state.view.start + ratio * viewSpan();
  }

  function updateTimeline() {
    if (!state.info) return;
    const a = timeToPct(state.in);
    const b = timeToPct(state.out);
    el.sel.style.left = `${a}%`;
    el.sel.style.width = `${Math.max(0, b - a)}%`;
    const eff = effectiveStart();
    if (eff != null && Math.abs(eff - state.in) > 0.0005) {
      const lo = Math.min(eff, state.in);
      const hi = Math.max(eff, state.in);
      el.ghost.hidden = false;
      el.ghost.classList.toggle('excluded', eff > state.in);
      el.ghost.style.left = `${timeToPct(lo)}%`;
      el.ghost.style.width = `${Math.max(0.15, timeToPct(hi) - timeToPct(lo))}%`;
    } else {
      el.ghost.hidden = true;
    }
    updatePlayhead();
    renderTicks();
    const zoomed = viewSpan() < duration() - 1e-6;
    el.zoom.hidden = !zoomed;
    if (zoomed) {
      el.zoomThumb.style.left = `${(state.view.start / duration()) * 100}%`;
      el.zoomThumb.style.width = `${(viewSpan() / duration()) * 100}%`;
    }
  }

  function currentTime() {
    if (!state.playable) return state.virtualTime || 0;
    return Math.max(0, el.video.currentTime - state.mediaOffset);
  }

  function placePlayhead(t) {
    const pct = timeToPct(t);
    el.playhead.hidden = pct < -0.01 || pct > 100.01; // hors de la vue zoomée
    el.playhead.style.left = `${clamp(pct, 0, 100)}%`;
    el.timeCurrent.textContent = TC.format(t);
  }

  function updatePlayhead() {
    placePlayhead(currentTime());
  }

  function niceStep(span, px) {
    const target = span / Math.max(1, px / 110);
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
    return steps.find((s) => s >= target) || steps[steps.length - 1];
  }

  function tickLabel(t, step) {
    const totalMs = Math.round(t * 1000);
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    const p = (n) => String(n).padStart(2, '0');
    let txt = duration() >= 3600 ? `${h}:${p(m)}:${p(s)}` : `${p(m + h * 60)}:${p(s)}`;
    if (step < 1) txt += `.${String(Math.round(ms / 100))}`;
    return txt;
  }

  function renderTicks() {
    const w = el.track.clientWidth;
    if (!w) return;
    const span = viewSpan();
    const step = niceStep(span, w);
    const first = Math.ceil(state.view.start / step) * step;
    const frag = document.createDocumentFragment();
    for (let t = first; t <= state.view.end + 1e-9; t += step) {
      const pct = timeToPct(t);
      if (pct < 2 || pct > 98) continue;
      const span = document.createElement('span');
      span.className = 'tl-tick';
      span.style.left = `${pct}%`;
      span.textContent = tickLabel(t, step);
      frag.appendChild(span);
    }
    el.ticks.replaceChildren(frag);
  }

  function setView(start, end) {
    const d = duration();
    const minSpan = Math.min(d, Math.max(2, frameDur() * 30));
    let span = clamp(end - start, minSpan, d);
    start = clamp(start, 0, d - span);
    state.view = { start, end: start + span };
    updateTimeline();
  }

  el.area.addEventListener('wheel', (e) => {
    if (!state.info) return;
    e.preventDefault();
    const span = viewSpan();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const delta = (e.shiftKey ? e.deltaY : e.deltaX) || e.deltaY;
      const shift = (delta / el.track.clientWidth) * span * 2;
      setView(state.view.start + shift, state.view.end + shift);
      return;
    }
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    const anchor = xToTime(e.clientX);
    const r = (anchor - state.view.start) / span;
    const newSpan = span * factor;
    setView(anchor - r * newSpan, anchor - r * newSpan + newSpan);
  }, { passive: false });

  el.btnZoomReset.addEventListener('click', () => setView(0, duration()));

  function followPlayhead() {
    const t = currentTime();
    if (viewSpan() >= duration() - 1e-6) return;
    if (t > state.view.end || t < state.view.start) {
      const span = viewSpan();
      const start = t > state.view.end ? t - span * 0.1 : t - span * 0.9;
      setView(start, start + span);
    }
  }

  // Glisser sur la timeline : tête de lecture ou poignées
  let drag = null;
  el.area.addEventListener('pointerdown', (e) => {
    if (!state.info || e.button !== 0) return;
    stopPreview();
    const onKnob = e.target.classList && e.target.classList.contains('ph-knob');
    const target = onKnob ? 'playhead' : e.target === el.hIn ? 'in' : e.target === el.hOut ? 'out' : 'seek';
    drag = { target, id: e.pointerId };
    el.area.setPointerCapture(e.pointerId);
    if (target === 'playhead') el.area.classList.add('dragging-ph');
    else applyDrag(e.clientX); // sur la poignée : on attrape sans sauter
  });
  el.area.addEventListener('pointermove', (e) => {
    if (!state.info) return;
    const t = xToTime(e.clientX);
    const r = el.track.getBoundingClientRect();
    el.hover.hidden = false;
    el.hover.style.left = `${e.clientX - r.left}px`;
    el.hover.classList.toggle('flip', e.clientX - r.left > r.width - 110);
    el.hoverLabel.textContent = TC.format(t);
    if (drag && drag.id === e.pointerId) applyDrag(e.clientX);
  });
  el.area.addEventListener('pointerleave', () => { el.hover.hidden = true; });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const target = drag.target;
    drag = null;
    el.area.classList.remove('dragging-ph');
    if (target === 'in') requestKeyframes();
  };
  el.area.addEventListener('pointerup', endDrag);
  el.area.addEventListener('pointercancel', endDrag);

  function applyDrag(clientX) {
    let t = xToTime(clientX);
    if (drag.target === 'seek' || drag.target === 'playhead') {
      seekTo(t);
    } else if (drag.target === 'in') {
      t = clamp(t, 0, state.out - frameDur());
      state.in = t;
      state.keyframes = null;
      afterSelectionChange();
      seekTo(t);
    } else {
      t = clamp(t, state.in + frameDur(), duration());
      state.out = t;
      afterSelectionChange();
      seekTo(t);
    }
  }

  // ------------------------------------------------------------------ lecteur
  let seekBusy = false;
  let seekPending = null;
  function seekTo(t) {
    t = clamp(t, 0, duration());
    if (!state.playable) {
      state.virtualTime = t;
      updatePlayhead();
      return;
    }
    if (seekBusy) { seekPending = t; updatePlayheadAt(t); return; }
    seekBusy = true;
    el.video.currentTime = t + state.mediaOffset;
    updatePlayheadAt(t);
  }
  function updatePlayheadAt(t) {
    placePlayhead(t);
  }
  el.video.addEventListener('seeked', () => {
    seekBusy = false;
    if (seekPending != null) {
      const t = seekPending;
      seekPending = null;
      seekTo(t);
    } else {
      updatePlayhead();
    }
  });
  el.video.addEventListener('loadedmetadata', () => {
    // Codec vidéo non décodable sur ce PC (ex. HEVC sans prise en charge matérielle) :
    // Chromium peut lire l'audio seul sans signaler d'erreur.
    if (state.info && state.info.video && el.video.videoWidth === 0) {
      el.video.removeAttribute('src');
      el.video.load();
      showUnplayable();
      return;
    }
    if (state.mediaOffset > 0) el.video.currentTime = state.mediaOffset;
  });
  el.video.addEventListener('error', () => {
    if (state.info && el.video.getAttribute('src')) showUnplayable();
  });

  function togglePlay() {
    if (!state.info || !state.playable) return;
    if (el.video.paused) {
      if (currentTime() >= duration() - 0.05) el.video.currentTime = state.mediaOffset;
      el.video.play().catch(() => {});
    } else {
      el.video.pause();
    }
  }

  let raf = null;
  function loop() {
    updatePlayhead();
    followPlayhead();
    raf = el.video.paused ? null : requestAnimationFrame(loop);
  }
  el.video.addEventListener('play', () => {
    el.btnPlay.classList.add('is-playing');
    if (!raf) raf = requestAnimationFrame(loop);
  });
  el.video.addEventListener('pause', () => {
    el.btnPlay.classList.remove('is-playing');
    updatePlayhead();
    if (state.previewing && !state.previewStopping) stopPreview();
  });
  el.video.addEventListener('timeupdate', () => { if (el.video.paused) updatePlayhead(); });
  el.video.addEventListener('click', togglePlay);
  el.btnPlay.addEventListener('click', togglePlay);

  function step(seconds) {
    if (!state.info) return;
    stopPreview();
    seekTo(currentTime() + seconds);
    followPlayhead();
  }
  function stepFrame(n) {
    if (!state.info) return;
    stopPreview();
    if (state.playable) el.video.pause();
    // Se cale sur la grille des images (timestamps du lecteur) pour éviter les erreurs d'arrondi.
    const fd = frameDur();
    const abs = currentTime() + state.mediaOffset;
    const idx = Math.floor((abs + 1e-4) / fd) + n;
    seekTo(Math.max(0, idx * fd + Math.min(0.0005, fd / 4) - state.mediaOffset));
    followPlayhead();
  }
  document.querySelectorAll('.step-btn').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.frame) stepFrame(parseInt(b.dataset.frame, 10));
    else step(parseFloat(b.dataset.step));
  }));

  // Volume
  function applyVolume() {
    el.video.volume = state.settings.volume;
    el.video.muted = !!state.settings.muted;
    el.volume.value = state.settings.volume;
    el.volume.style.setProperty('--fill', `${state.settings.volume * 100}%`);
    el.btnMute.classList.toggle('is-muted', el.video.muted || state.settings.volume === 0);
  }
  el.volume.addEventListener('input', () => {
    saveSettings({ volume: parseFloat(el.volume.value), muted: false });
    applyVolume();
  });
  el.btnMute.addEventListener('click', () => {
    saveSettings({ muted: !state.settings.muted });
    applyVolume();
  });

  // ------------------------------------------------------------------ aperçu
  function startPreview() {
    if (!state.info || !state.playable) return;
    const eff = effectiveStart();
    const start = eff == null ? state.in : eff;
    state.previewing = true;
    state.previewEnd = state.out;
    el.previewChip.hidden = false;
    el.video.currentTime = start + state.mediaOffset;
    el.video.play().catch(() => {});
    watchPreview();
  }
  function watchPreview() {
    if (!state.previewing) return;
    const v = el.video;
    const check = () => {
      if (!state.previewing) return;
      if (v.currentTime - state.mediaOffset >= state.previewEnd - frameDur() * 0.5) {
        state.previewStopping = true;
        v.pause();
        state.previewStopping = false;
        stopPreview();
        return;
      }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(check);
      else requestAnimationFrame(check);
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(check);
    else requestAnimationFrame(check);
  }
  function stopPreview() {
    if (!state.previewing) return;
    state.previewing = false;
    el.previewChip.hidden = true;
    if (!el.video.paused) el.video.pause();
  }
  el.btnPreview.addEventListener('click', () => (state.previewing ? stopPreview() : startPreview()));

  // ------------------------------------------------------------------ saisie des timestamps
  function bindTcInput(input, which) {
    const commit = () => {
      const t = TC.parse(input.value);
      if (t == null) {
        input.classList.add('invalid');
        toast('Format de temps non reconnu. Exemples : 1:02:03.500, 02:03, 95.5, 1h02m03s');
        return false;
      }
      const ok = which === 'in' ? setIn(t, { seek: true }) : setOut(t, { seek: true });
      if (!ok) input.classList.add('invalid');
      return ok;
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { if (commit()) input.blur(); e.preventDefault(); }
      if (e.key === 'Escape') { input.blur(); updateFields(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => {
      const t = TC.parse(input.value);
      const cur = which === 'in' ? state.in : state.out;
      if (t != null && Math.abs(t - cur) > 0.0005) commit();
      else updateFields();
    });
    input.addEventListener('focus', () => input.select());
  }
  bindTcInput(el.inStart, 'in');
  bindTcInput(el.inEnd, 'out');

  el.btnSetIn.addEventListener('click', () => setIn(currentTime()));
  el.btnSetOut.addEventListener('click', () => setOut(currentTime()));
  el.btnGoIn.addEventListener('click', () => { stopPreview(); seekTo(state.in); ensureVisible(state.in); });
  el.btnGoOut.addEventListener('click', () => { stopPreview(); seekTo(state.out); ensureVisible(state.out); });
  el.btnReset.addEventListener('click', resetSelection);

  function ensureVisible(t) {
    if (t < state.view.start || t > state.view.end) {
      const span = viewSpan();
      setView(t - span / 2, t + span / 2);
    }
  }

  // ------------------------------------------------------------------ export
  el.exportName.addEventListener('input', () => { state.nameDirty = true; });
  el.exportName.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') doExport();
  });
  el.btnChangeDir.addEventListener('click', async () => {
    const dir = await api.chooseFolder(state.exportDir);
    if (!dir) return;
    saveSettings({ exportDir: dir });
    resolveExportDir();
  });
  el.btnExport.addEventListener('click', doExport);

  async function doExport() {
    if (!state.info || state.exporting || el.btnExport.disabled) return;
    stopPreview();
    const name = sanitizeName(el.exportName.value);
    if (!name) {
      toast('Indiquez un nom de fichier.', { error: true });
      el.exportName.focus();
      return;
    }
    if (!(await api.dirOk(state.exportDir))) {
      toast('Le dossier d\'exportation est introuvable. Choisissez-en un autre.', { error: true });
      return;
    }
    const output = await api.joinPath(state.exportDir, `${name}.${el.exportExt.value}`);
    if (output.toLowerCase() === state.info.path.toLowerCase()) {
      toast('Ce nom correspond à la vidéo source. Choisissez un autre nom pour ne pas l\'écraser.', { error: true });
      return;
    }
    if (await api.exists(output)) {
      if (!(await api.confirmOverwrite(output))) return;
    }
    if (state.mode === 'copy') {
      const eff = effectiveStart();
      if (eff != null && state.in - eff > FAR_KEYFRAME) {
        const choice = await api.confirmFarKeyframe({ startText: TC.format(eff), offsetText: TC.human(state.in - eff) });
        if (choice === 'cancel') return;
        if (choice === 'smart') setMode('smart');
      }
    }

    state.exporting = true;
    updateButtons();
    showStatus('progress', {
      title: 'Export en cours…',
      detail: (() => {
        const d = state.mode === 'smart' ? smartDecision() : null;
        if (d && d.kind === 'smart') return `Début exact : ${fmtSec(d.head)} réencodées, le reste copié sans perte`;
        if (d && d.kind === 'precise') return 'Réencodage du clip en très haute qualité';
        return 'Copie directe des flux, sans réencodage';
      })(),
      ratio: 0,
      actions: [{ label: 'Annuler', act: 'cancel' }],
    });
    const t0 = performance.now();
    const unsub = api.onExportProgress((p) => {
      const pct = Math.round(p.ratio * 100);
      let detail = `${pct} %`;
      const elapsed = (performance.now() - t0) / 1000;
      if (p.ratio > 0.03 && p.ratio < 1 && elapsed > 2) {
        const remaining = elapsed / p.ratio - elapsed;
        detail += `  ·  environ ${TC.human(remaining)} restantes`;
      }
      if (p.speed) detail += `  ·  ×${p.speed.toFixed(p.speed >= 10 ? 0 : 1)}`;
      el.statusDetail.textContent = detail;
      el.progressFill.style.width = `${pct}%`;
    });

    let res;
    try {
      res = await api.startExport({
        input: state.info.path,
        output,
        start: state.in,
        end: state.out,
        mode: state.mode,
        snap: state.snap,
        info: state.info,
      });
    } catch (err) {
      res = { ok: false, error: String(err && err.message ? err.message : err) };
    } finally {
      unsub();
      state.exporting = false;
      updateButtons();
    }

    if (res.ok) {
      const name2 = res.output.split(/[\\/]/).pop();
      const parts = [name2, TC.format(res.clipDuration), fmtBytes(res.size), `${(res.elapsedMs / 1000).toFixed(1).replace('.', ',')} s`];
      let title = 'Clip exporté sans perte';
      if (res.kind === 'smart') title = `Clip exporté · début exact (${fmtSec(res.reencodedSeconds)} réencodées)`;
      else if (res.reencode) title = 'Clip exporté (réencodé)';
      if (res.warning) title = 'Clip exporté, à vérifier';
      showStatus(res.warning ? 'warn' : 'done', {
        title,
        wrap: !!res.notice,
        detail: res.warning || (res.notice ? `${res.notice}  ·  ${parts.filter(Boolean).join('  ·  ')}` : parts.filter(Boolean).join('  ·  ')),
        ratio: 1,
        actions: [
          { label: 'Afficher dans le dossier', act: 'reveal', path: res.output },
          { label: 'Nouvelle découpe', act: 'new', primary: true },
        ],
      });
      lastExport = res.output;
    } else if (res.cancelled) {
      showExportRow();
      toast('Export annulé. Le fichier incomplet a été supprimé.');
    } else {
      showStatus('error', {
        title: 'Échec de l\'export',
        detail: res.error || 'Erreur inconnue',
        ratio: 0,
        actions: [{ label: 'Retour', act: 'back' }],
      });
      if (res.detail) el.statusDetail.title = res.detail;
    }
  }

  let lastExport = null;
  function showStatus(kind, { title, detail, ratio, actions, wrap = false }) {
    el.exportRow.hidden = true;
    el.exportStatus.hidden = false;
    el.exportStatus.classList.toggle('done', kind === 'done');
    el.exportStatus.classList.toggle('error', kind === 'error' || kind === 'warn');
    const check = kind === 'done'
      ? '<span class="status-check"><svg viewBox="0 0 20 20"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
      : '';
    el.statusTitle.innerHTML = check + escapeHtml(title);
    el.statusDetail.textContent = detail;
    el.statusDetail.title = '';
    el.statusDetail.classList.toggle('wrap', wrap || kind === 'error' || kind === 'warn');
    el.progressFill.style.width = `${Math.round(ratio * 100)}%`;
    el.progressFill.parentElement.hidden = kind === 'error';
    el.statusActions.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `btn${a.primary ? ' primary' : ''}`;
      b.textContent = a.label;
      b.addEventListener('click', () => {
        if (a.act === 'cancel') { api.cancelExport(); b.disabled = true; b.textContent = 'Annulation…'; }
        if (a.act === 'reveal') api.showItem(a.path);
        if (a.act === 'new') resetSelection();
        if (a.act === 'back') showExportRow();
      });
      el.statusActions.appendChild(b);
    }
  }

  function showExportRow() {
    el.exportStatus.hidden = true;
    el.exportRow.hidden = false;
  }

  // ------------------------------------------------------------------ ouverture : boutons & glisser-déposer
  async function openDialog() {
    const file = await api.openVideoDialog();
    if (file) openPath(file);
  }
  $('btnOpen').addEventListener('click', openDialog);
  $('btnOpenEmpty').addEventListener('click', openDialog);

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (state.info) el.dropOverlay.hidden = false;
    else el.dropCard.classList.add('is-over');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) { el.dropOverlay.hidden = true; el.dropCard.classList.remove('is-over'); }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.dropOverlay.hidden = true;
    el.dropCard.classList.remove('is-over');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const p = api.pathForFile(file);
    if (!p) { toast('Impossible de lire ce fichier.', { error: true }); return; }
    openPath(p);
  });

  // ------------------------------------------------------------------ raccourcis clavier
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); openDialog(); return; }
    if (!state.info) return;
    if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); doExport(); return; }
    if (ctrl || e.altKey) return;
    switch (k) {
      case ' ': case 'k': case 'K':
        e.preventDefault(); if (state.previewing) stopPreview(); else togglePlay(); break;
      case 'i': case 'I': setIn(currentTime()); break;
      case 'o': case 'O': setOut(currentTime()); break;
      case 'p': case 'P': state.previewing ? stopPreview() : startPreview(); break;
      case 'Escape': stopPreview(); break;
      case 'ArrowLeft': e.preventDefault(); step(e.shiftKey ? -10 : -1); break;
      case 'ArrowRight': e.preventDefault(); step(e.shiftKey ? 10 : 1); break;
      case ',': stepFrame(-1); break;
      case '.': stepFrame(1); break;
      case 'Home': e.preventDefault(); stopPreview(); seekTo(state.in); ensureVisible(state.in); break;
      case 'End': e.preventDefault(); stopPreview(); seekTo(state.out); ensureVisible(state.out); break;
      case 'm': case 'M': el.btnMute.click(); break;
      default: break;
    }
  });

  window.addEventListener('resize', () => { if (state.info) renderTicks(); });

  // ------------------------------------------------------------------ démarrage
  (async () => {
    state.settings = await api.getSettings();
    // Toujours démarrer en mode sans perte : jamais de réencodage par défaut.
    state.mode = 'smart';
    state.snap = 'prev';
    for (const b of el.modeButtons) b.setAttribute('aria-checked', String(b.dataset.mode === state.mode));
    applyVolume();
    api.onOpen((file) => openPath(file));
    const pending = await api.takePendingOpen();
    if (pending) openPath(pending);
  })();

  // Exposé pour les tests automatisés uniquement (lecture seule).
  window.__cutState = state;
})();
