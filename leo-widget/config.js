// Réglages de l'agent Leo (widget de pré-vente et de support, source :
// leo-agent-pour-alex, voir son LISEZ-MOI-Alex.md, section 3). Chargé avant
// leo-widget.min.js, par index.html (page ouverte directement) et par
// webflow-embed.html (page parente, sur legaleo.ai).
window.LEO_CONFIG = {
  position: "right", // 'right' ou 'left'
  // Bulle d'accroche : une seule, au bout de 30 s (défaut : 5 s puis une
  // seconde à 28 s, jugé trop intrusif). teaserMax: 0 la supprime.
  teaserDelay: 30000,
  teaserMax: 1,
  // Mêmes deux choix que la page contact (démo ou message), même circuit, via
  // son script Google (apps-script/contact.gs, actions « leo » et « leo-book ») :
  // HubSpot (contact, deal, note), Encharge, Slack #sales, agenda Google de
  // Mehdi (invitation avec le lien Meet). Même URL que API_URL dans
  // js/contact.js.
  script: {
    url: "https://script.google.com/macros/s/AKfycbwH1XasqUgamR6kw4-OPh5Glo0ZpbjqMPtNrynXPmwIQQ8sQ-wmEkc2Srql0Wti4AmuTQ/exec",
    contactUrl: "https://www.legaleo.ai/contact", // repli si l'agenda ne répond pas
  },
  hubspot: {
    mode: "script", // 'script' (page contact) | 'forms' | 'endpoint' | 'simulate'
  },
  meetings: {
    mode: "script", // 'script' (agenda Google de la page contact) | 'link' | 'iframe' | 'simulate'
  },
};
