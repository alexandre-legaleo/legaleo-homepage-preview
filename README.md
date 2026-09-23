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
- `webflow-embed.html` : snippet à coller dans l'élément Embed Webflow.

## Hors de l'iframe (reste natif Webflow)

- nav et footer du site ;
- la section newsletter (le formulaire Webflow ne peut pas fonctionner depuis
  l'iframe) : à garder en natif sous l'Embed.

## Étape suivante prévue

Migration native Webflow une fois le design validé (import HTMLtoflow du
statique + recréation des animations), pour que le contenu de la homepage
soit indexé sur legaleo.ai et non sur github.io.
