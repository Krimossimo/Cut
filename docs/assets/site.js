/* Cut — site de présentation : téléchargements, navigation, liens. */
(() => {
  'use strict';
  const cfg = window.CUT_CONFIG || {};
  const gh = cfg.github || {};
  const repoUrl = gh.owner && gh.repo ? `https://github.com/${gh.owner}/${gh.repo}` : '';
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ─────────────────────────────── Utilitaires
  function formatSize(bytes) {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb)} Mo`;
  }
  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function setField(name, value) {
    $$(`[data-field="${name}"]`).forEach((el) => { el.textContent = value; });
  }
  function setLink(name, url) {
    $$(`[data-link="${name}"]`).forEach((el) => {
      if (url) { el.href = url; el.hidden = false; } else { el.hidden = true; }
    });
  }

  // ─────────────────────────────── Liens
  setLink('github-repo', repoUrl);
  setLink('releases', repoUrl && `${repoUrl}/releases`);
  setLink('kofi', cfg.kofi || '');
  if (!cfg.kofi) {
    const support = document.getElementById('soutenir');
    if (support) support.hidden = true;
  }

  // ─────────────────────────────── Téléchargements
  function applyRelease(rel) {
    setField('version', rel.version);
    setField('date', formatDate(rel.date));
    setLink('release-notes', rel.notesUrl);
    for (const kind of ['setup', 'portable']) {
      const a = rel[kind];
      if (!a) continue;
      setField(`${kind}-name`, a.name);
      setField(`${kind}-size`, formatSize(a.size));
      setField(`${kind}-sha`, a.sha256 || '—');
      $$(`[data-download="${kind}"]`).forEach((el) => {
        el.href = a.url;
        el.setAttribute('download', '');
        el.title = `${a.name} · ${formatSize(a.size)}`;
      });
    }
    const total = (rel.setup?.downloads || 0) + (rel.portable?.downloads || 0);
    setField('downloads', total > 0 ? ` · ${total.toLocaleString('fr-FR')} téléchargements` : '');
  }

  // Valeurs par défaut (avant la réponse de GitHub, ou si GitHub ne répond pas)
  const fb = cfg.fallback || {};
  const tagUrl = (v, name) => `${repoUrl}/releases/download/v${v}/${name}`;
  if (fb.version && repoUrl) {
    applyRelease({
      version: fb.version,
      date: fb.date,
      notesUrl: `${repoUrl}/releases/tag/v${fb.version}`,
      setup: fb.setup && { ...fb.setup, url: tagUrl(fb.version, fb.setup.name) },
      portable: fb.portable && { ...fb.portable, url: tagUrl(fb.version, fb.portable.name) },
    });
  }

  // Dernière release publiée sur GitHub
  if (gh.owner && gh.repo && window.fetch) {
    fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        const assets = data.assets || [];
        const pick = (re) => {
          const a = assets.find((x) => re.test(x.name));
          if (!a) return null;
          const sha = typeof a.digest === 'string' && a.digest.startsWith('sha256:') ? a.digest.slice(7) : null;
          const fallbackSha = [fb.setup, fb.portable].find((f) => f && f.name === a.name);
          return {
            name: a.name,
            size: a.size,
            url: a.browser_download_url,
            downloads: a.download_count || 0,
            sha256: sha || (fallbackSha && fallbackSha.sha256) || null,
          };
        };
        const setup = pick(/setup.*\.exe$/i);
        const portable = pick(/portable.*\.exe$/i);
        if (!setup && !portable) return;
        applyRelease({
          version: String(data.tag_name || data.name || fb.version).replace(/^v/i, ''),
          date: data.published_at || fb.date,
          notesUrl: data.html_url,
          setup,
          portable,
        });
      })
      .catch(() => { /* on garde les valeurs de secours */ });
  }

  // ─────────────────────────────── Réseaux (À propos)
  const SOCIAL_LABELS = {
    twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', instagram: 'Instagram', discord: 'Discord',
  };
  const socialsEl = document.getElementById('socials');
  if (socialsEl) {
    const items = [];
    for (const [key, label] of Object.entries(SOCIAL_LABELS)) {
      const url = cfg.socials && cfg.socials[key];
      if (url) items.push({ label, url });
    }
    if (repoUrl) items.push({ label: 'GitHub', url: `https://github.com/${gh.owner}` });
    if (cfg.kofi) items.push({ label: 'Ko-fi', url: cfg.kofi });
    for (const it of items) {
      const a = document.createElement('a');
      a.className = 'social';
      a.href = it.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>';
      a.append(document.createTextNode(it.label));
      socialsEl.appendChild(a);
    }
    socialsEl.hidden = items.length === 0;
  }

  // ─────────────────────────────── Étapes (captures)
  const SHOTS = {
    accueil: { src: 'assets/img/cut-accueil.webp', alt: 'Écran d\'accueil de Cut : zone de dépôt « Glissez une vidéo ici ».' },
    editeur: { src: 'assets/img/cut-editeur.webp', alt: 'Éditeur de Cut : début et fin placés sur la barre de découpe, durée du clip affichée.' },
    export: { src: 'assets/img/cut-export.webp', alt: 'Export terminé : « Clip exporté · début exact », avec les boutons Afficher dans le dossier et Nouvelle découpe.' },
  };
  // Précharge les captures
  Object.values(SHOTS).forEach((s) => { const i = new Image(); i.src = s.src; });
  const stepImg = document.getElementById('stepShot');
  const stepBtns = $$('.step');
  function selectStep(btn) {
    stepBtns.forEach((b) => {
      const on = b === btn;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    const s = SHOTS[btn.dataset.shot];
    if (s && stepImg && stepImg.getAttribute('src') !== s.src) {
      stepImg.style.opacity = '0';
      setTimeout(() => { stepImg.src = s.src; stepImg.alt = s.alt; stepImg.style.opacity = '1'; }, 140);
    }
  }
  stepBtns.forEach((b) => {
    b.addEventListener('click', () => selectStep(b));
    b.addEventListener('mouseenter', () => { if (window.matchMedia('(hover: hover)').matches) selectStep(b); });
  });

  // ─────────────────────────────── En-tête & menu mobile
  const header = document.querySelector('.site-header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const menuBtn = document.getElementById('menuBtn');
  const nav = document.getElementById('nav');
  const closeMenu = () => { nav.classList.remove('is-open'); menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', () => {
    const open = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  const y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
})();
