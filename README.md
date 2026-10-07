# front-legaleo-homepage

Refonte de la homepage de [legaleo.ai](https://www.legaleo.ai/), à partir de la
base [legaleo.webflow.io/homepage-v2](https://legaleo.webflow.io/homepage-v2) :
mêmes textes et même ordre de sections, rendu retravaillé (mockups animés,
bento, chat Leo interactif).

Même principe que `front-legaleo-leo` : HTML/CSS/JS statique, publié sur
GitHub Pages, et affiché dans Webflow via un Embed iframe
(`webflow-embed.html`) entre la nav et le footer natifs du site.

## Lancer en local

```sh
pnpm install
pnpm dev   # http://localhost:5174
```

## Structure

- `index.html` : toute la page (préfixe de classes `hp-`).
- `css/` : un fichier par zone (`hero`, `stades`, `platform` + `mockups`,
  `avocat`, `why`, `audiences`, `leo`, `closing`), `tokens.css` partagé avec
  la page Leo.
- `js/embed.js` : mode iframe (hauteur, ancres), messages `legaleo-home:*`.
- `js/main.js` : apparitions au scroll, boucles des mockups, chat Leo.
- `leo-anims/` : animations Lottie de Leo, copiées de `front-legaleo-leo`
  (même fichier source, à resynchroniser si l'export change).
- `webflow-embed.html` : snippet à coller dans l'élément Embed Webflow.
- `leo-widget/` : agent Leo (bulle de pré-vente et de support), build copié
  de `leo-agent-pour-alex/dist/` (à recopier après chaque `build.py`).
  Réglages dans `leo-widget/config.js`. Leo propose les deux mêmes choix
  que la page contact (réserver une démo, envoyer un message) et passe par
  son script Google (mode « script » : mêmes HubSpot, Encharge, Slack et
  agenda ; e-mail de confirmation de démo désactivé, `LEO_CONFIRM_MAIL`) : actions `leo` et
  `leo-book` de `apps-script/contact.gs`.
  Chargé par `index.html` quand la page est ouverte directement, et par
  `webflow-embed.html` côté page parente quand elle est dans l'iframe.
- `contact.html` (+ `css/contact.css`, `js/contact.js`) : nouvelle page
  contact (www.legaleo.ai/contact), en 2 étapes : qualification, puis au
  choix une démo (créneau libre de l'agenda Google de Mehdi, lien Meet) ou
  un simple message. Snippet Webflow : `webflow-embed-contact.html`.
- `apps-script/contact.gs` : le script Google Apps Script qui reçoit la page
  contact (agenda, HubSpot, Encharge, Slack). Installation pas à pas en tête
  du fichier ; son URL de déploiement va dans `API_URL` (js/contact.js).
  Tant qu'elle est vide, la page est en mode maquette (créneaux fictifs,
  rien n'est envoyé). Les propriétés HubSpot « points de vente » et
  « situation » se renseignent dans `CONFIG.HUBSPOT_PROPS` du script.
  Pré-sélection depuis un lien : `/contact?reseau=lancement`,
  `developpement` ou `structure`.

## Hors de l'iframe (reste natif Webflow)

- nav et footer du site ;
- la section newsletter (le formulaire Webflow ne peut pas fonctionner depuis
  l'iframe) : à garder en natif sous l'Embed.

## Étape suivante prévue

Migration native Webflow une fois le design validé (import HTMLtoflow du
statique + recréation des animations), pour que le contenu de la homepage
soit indexé sur legaleo.ai et non sur github.io.
