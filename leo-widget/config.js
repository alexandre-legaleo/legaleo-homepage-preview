// Réglages de l'agent Leo (widget de pré-vente et de support, source :
// leo-agent-pour-alex, voir son LISEZ-MOI-Alex.md, section 3). Chargé avant
// leo-widget.min.js, par index.html (page ouverte directement) et par
// webflow-embed.html (page parente, sur legaleo.ai).
window.LEO_CONFIG = {
  position: "right", // 'right' ou 'left'
  hubspot: {
    mode: "forms", // 'forms' (API Formulaires) | 'endpoint' | 'simulate'
    portalId: "147898530",
    formGuid: "", // À RENSEIGNER : formulaire « Leo (chat) ». Vide : Leo affiche un message d'erreur au lieu de perdre la demande
    region: "eu1",
    leadSource: "", // 'Chat Leo (site)' une fois l'option créée dans HubSpot
  },
  meetings: {
    mode: "link", // 'link' | 'iframe' | 'simulate'
    url: "https://meetings-eu1.hubspot.com/mehdi3/legaleo-ai",
  },
};
