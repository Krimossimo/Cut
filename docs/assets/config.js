/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  Configuration du site Cut — c'est le SEUL fichier à modifier.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Le bouton « Télécharger » interroge automatiquement la dernière release
 *  GitHub du dépôt ci-dessous (version, taille, empreinte SHA-256, date).
 *  Les valeurs « fallback » ne servent que si GitHub ne répond pas.
 *
 *  Un lien laissé vide ('') est simplement masqué sur le site.
 */
window.CUT_CONFIG = {
  // Dépôt GitHub qui héberge le site et les releases (github.com/<owner>/<repo>)
  github: { owner: 'Krimossimo', repo: 'Cut' },

  // Lien de don Ko-fi
  kofi: 'https://ko-fi.com/krimossimo',

  // Réseaux de Krimossimo affichés dans « À propos » (laisser '' pour masquer)
  socials: {
    twitch: '',
    youtube: '',
    tiktok: '',
    x: '',
    instagram: '',
    discord: '',
  },

  // Valeurs de secours (si l'API GitHub est indisponible)
  fallback: {
    version: '1.1.0',
    date: '2026-11-01',
    setup: {
      name: 'Cut-Setup-1.1.0.exe',
      size: 152546233,
      sha256: 'bbbd9d7713f877447a2f82876fc5098543344d71e24a20af9316d81440f72625',
    },
    portable: {
      name: 'Cut-1.1.0-Portable.exe',
      size: 152497069,
      sha256: 'c8b29e152a010012a686737b597d830ec0d711cb4595a17824bcded9c260af32',
    },
  },
};
