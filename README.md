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

## Webflow natif (sans iframe)

L'iframe GitHub Pages n'est pas indexée sur legaleo.ai. `pnpm build:webflow`
(`scripts/build-webflow.mjs`) produit, par page, de quoi la mettre en natif
dans Webflow : le HTML va dans des éléments Code Embed, rendus dans le source
de la page (indexé), sans aucune animation à recréer. CSS et JS, trop gros
pour le custom code Webflow (50 000 caractères), restent servis par GitHub
Pages depuis `webflow/` : **relancer le build et pousser sur `main` après
chaque modification de la page**.

`webflow/home/` et `webflow/contact/` contiennent :

- `embed-1.html`, `embed-2.html`… : un Code Embed chacun, dans l'ordre ;
- `head.html` : Page settings > Custom code > Inside `<head>` tag ;
- `footer.html` : Page settings > Custom code > Before `</body>` tag ;
- `page.css`, `page.js` : chargés par ces deux snippets.

Dans le Designer, sur la page :

1. supprimer le Code Embed de l'iframe (`webflow-embed*.html`) ;
2. à sa place, sous la nav, un Div Block de classe `lg-page`, sans aucun
   style (homepage : Element settings > Tag `main` ; contact : laisser `div`,
   le `<main>` est dans l'embed) ;
3. dedans, un Code Embed par fichier `embed-N.html`, dans l'ordre ;
4. coller `head.html` et `footer.html` dans les réglages de la page, vérifier
   titre et meta description (repris de `<title>` et `<meta name="description">`
   de la page source) ;
5. newsletter et footer natifs inchangés, sous le wrapper. Publier.

Le CSS est confiné au wrapper `.lg-page` : le reset et le CSS du site Webflow
sur les balises nues (`p`, `h1`…`h6`, `ul`, `sup`…) sont neutralisés à
l'intérieur, la nav et le footer ne sont pas touchés. Le dégagement de la
nav fixe (ex-`.is-embedded`) s'applique toujours.

Les pages GitHub Pages portent un `canonical` vers legaleo.ai.
