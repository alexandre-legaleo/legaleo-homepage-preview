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

## Webflow natif : éléments et classes Webflow (pages *-v3)

Version en place sur Webflow depuis le 15/10/2026 : pages brouillon
`/home-v3`, `/contact-v3`, `/leo-v3` (hors sitemap), construites par le MCP
Webflow. `pnpm` n'est pas nécessaire : `node scripts/webflow-native.mjs`
régénère `webflow-native/<page>/` à partir des sources (index.html,
contact.html, ../front-legaleo-leo/index.html).

Ce qui est où :

- **Natif Webflow** (éditable dans le Designer par l'équipe) : textes,
  titres, boutons, liens, FAQ, images (médiathèque Webflow,
  `webflow-assets.json`), mise en page via classes Webflow (`hp-*`, `ct-*`,
  `lv-*` pour Leo) et breakpoint 991 px.
- **Mockups animés** (player du hero, visuels de la plateforme, chat…) :
  conteneur natif vide `data-lg-include`, contenu injecté au chargement
  depuis `webflow-native/<page>/includes.json` (GitHub Pages). Données de
  démo : ni à éditer dans Webflow ni à indexer.
- **Code Embed** : carte de réservation de la page contact (pilotée par
  `js/contact.js`).
- **custom.css** (GitHub Pages, chargé dans le head de la page) : tout ce
  que l'import natif refuse (sélecteurs imbriqués, `::before`, keyframes,
  breakpoints 640/1100 px…, variables CSS, reset confiné à `.lg-page`).
- **JS** : bundles `webflow/<page>/page.js` (build Code Embed), chargés en
  pied de page.

Pièges Webflow gérés par le convertisseur (détails en tête du script) :
classe sans règle supprimée, classes combinées d'état (`.is-active`)
créées seulement si présentes au départ, attribut `hidden` retiré à la
publication (-> `data-lg-hidden`), styles inline supprimés
(-> `data-lg-style`), `translate` abîmé, data URI avec `;` refusées,
`<button>` converti en lien `.w-button`.

Rendu dans le Designer (qui n'exécute pas custom.css) :

- **Variables** : les tokens de `css/tokens.css` existent comme variables
  Webflow dans « Base collection », sous le même nom (`color-black`,
  `font-serif`, `radius-xl`…). Webflow leur donne le nom CSS
  `--color-black` : les `var(--…)` des styles natifs se résolvent donc
  dans le Designer sans lien explicite. Ne pas les créer dans une autre
  collection (nom CSS préfixé `--_collection---`). Valeurs de la homepage ;
  le mode « Leo » porte les valeurs de front-legaleo-leo qui diffèrent
  (rayons xl/lg, `wrap-max`, orange et vert) et s'applique à `lv-hero`,
  `lv-pourquoi`, `lv-block`. Pas de variable pour les ombres ni
  `ease-out` (aucun type Webflow). Un token modifié dans `tokens.css` se
  reporte à la main dans la variable.
- **Fraunces** : installée sur le site sous le nom « Fraunces LG »
  (fichiers de `fonts/`, axe `wght` 300-700). Les réglages du site chargent
  aussi Fraunces depuis Google Fonts (autres pages, et Leo) : sous le même
  nom, elle remplaçait la nôtre (glyphes « wonky », pas de taille optique).
  Le convertisseur renomme donc la famille en `"Fraunces LG"` pour la
  homepage et le contact ; la variable `font-serif` vaut
  `Fraunces LG, Fraunces, Georgia, serif` (mode Leo : `Fraunces`).
- **Fond de page** : les règles `body` des sources deviennent `.lg-page`,
  classe commune aux trois pages ; elles restent dans le custom.css de
  chaque page (contact : beige).
- **Règles de custom.css** (reset, puces, coches, sélecteurs imbriqués) :
  copie dans `webflow-native/<page>/designer.css`, chargée par le premier
  Code Embed de `.lg-page` (`designer-embed.html`). Sélecteurs préfixés par
  `:where(.wf-design-mode)`, classe posée sur `<html>` par le canvas
  seulement : aucun effet sur le site publié (vérifié). Règles des mockups
  exclues. Se met à jour avec le reste (`node scripts/webflow-native.mjs`,
  push sur `main`). Ne pas supprimer cet embed.

Mettre à jour après une modification :

- **CSS / mockups / JS** : `node scripts/webflow-native.mjs` (et
  `node scripts/build-webflow.mjs` pour le JS), push sur `main`. Rien à
  toucher dans Webflow, sauf le `?v=` des snippets head/footer si on veut
  forcer le cache (10 min sinon).
- **Texte d'une section** : directement dans le Designer (équipe), ou
  depuis Claude Code via le MCP Webflow.
- **Nouvelle section / nouvelle classe** : régénérer, puis réimporter le
  bloc concerné avec le MCP (`data_whtml_builder`, HTML + CSS de
  `sections/NN.*`).

## Webflow par Code Embeds (étape intermédiaire, remplacée par les pages v3)

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
