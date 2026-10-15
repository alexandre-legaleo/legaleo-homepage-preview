// Build Webflow natif (sans iframe) : `pnpm build:webflow`.
//
// Le HTML de chaque page part dans des éléments Code Embed de la page
// Webflow. Le contenu est alors dans le source de www.legaleo.ai, donc
// indexé, ce que l'iframe GitHub Pages ne permettait pas. CSS et JS restent
// hébergés sur GitHub Pages (trop gros pour le custom code Webflow, limité
// à 50 000 caractères), chargés par les snippets head / footer de la page.
//
// Sortie : webflow/<page>/
//   embed-N.html   à coller chacun dans un Code Embed (< 50 000 caractères),
//                  dans l'ordre, à l'intérieur d'un Div Block de classe
//                  « lg-page » ;
//   head.html      Page settings > Custom code > Inside <head> tag ;
//   footer.html    Page settings > Custom code > Before </body> tag ;
//   page.css / page.js : chargés par head.html / footer.html.
//
// Le CSS est confiné au wrapper .lg-page : reset et styles de body passent
// sous :where(.lg-page) (spécificité inchangée, la nav et le footer Webflow
// ne sont pas touchés). Les règles « .is-embedded » (nav fixe de
// legaleo.ai à dégager) s'appliquent désormais toujours.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://alexandre-legaleo.github.io/legaleo-homepage-preview/";
const EMBED_MAX = 49000; // limite Webflow : 50 000 caractères par Code Embed
// Hauteur de la nav fixe de legaleo.ai (80 px desktop, 78 px mobile), plus
// un peu d'air : sections visées par une ancre, défilement de la page contact.
const NAV_OFFSET = 80;

const read = (p) => readFileSync(join(ROOT, p), "utf8");
// ?v= des snippets : empreinte du contenu, change seulement quand le fichier
// change (pas besoin de recoller head / footer dans Webflow sinon).
const hash = (...contents) => createHash("sha1").update(contents.join("\0")).digest("hex").slice(0, 8);

// ---------- CSS ----------

// reset.css confiné au wrapper. :where() garde la spécificité d'origine
// (sinon « .lg-page a » battrait « .hp-btn »).
const SCOPED_RESET = `
/* Le CSS du site Webflow style les balises nues (p 1.2rem, h1 à h6, ul
   padding 40px, sup décalé, label en bloc…), là où la page compte sur les
   valeurs du navigateur. Retour à ces valeurs (revert) dans le wrapper, à
   spécificité égale mais chargé après : nos classes passent toujours devant.
   Pas sur le SVG : revert y effacerait les attributs fill, stroke… */
:where(.lg-page) :is(p, h1, h2, h3, h4, h5, h6, ul, ol, li, a, b, strong, em, small, sub, sup, img, label, blockquote, figure, figcaption, button, input, select, textarea, summary, details, span, div, section, main, header, footer, nav, article) { all: revert; box-sizing: border-box; }
/* Typo du body Webflow (taille, interligne, graisse) : celle du navigateur. */
:where(.lg-page) { font-size: 16px; line-height: normal; font-weight: 400; letter-spacing: normal; text-align: left; }
:where(.lg-page),
:where(.lg-page) *,
:where(.lg-page) *::before,
:where(.lg-page) *::after { box-sizing: border-box; }
:where(.lg-page) { --anchor-offset: ${NAV_OFFSET + 16}px; }
:where(.lg-page) section[id] { scroll-margin-top: var(--anchor-offset, 0px); }
:where(.lg-page) img,
:where(.lg-page) svg { display: block; max-width: 100%; }
/* normalize Webflow : svg:not(:root) { overflow: hidden } bat les classes
   seules (.hp-eco-svg, .hp-sc-sigsvg, .hp-stades-curve-svg : overflow visible,
   hero.css, player.css, stades.css). À compléter si un autre SVG passe en overflow visible. */
:where(.lg-page) svg:not(:root) { overflow: revert; }
.lg-page svg:is(.hp-eco-svg, .hp-sc-sigsvg, .hp-stades-curve-svg) { overflow: visible; }
:where(.lg-page) a { color: inherit; text-decoration: none; }
:where(.lg-page) button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
:where(.lg-page) ul { margin: 0; padding: 0; list-style: none; }
:where(.lg-page) h1,
:where(.lg-page) h2,
:where(.lg-page) h3,
:where(.lg-page) h4,
:where(.lg-page) p { margin: 0; }
/* Code Embed Webflow : pas de clearfix entre les morceaux de la page. */
.lg-page > .w-embed::before,
.lg-page > .w-embed::after { content: none; }
`;

const cssFile = (file) => {
  let css = read(`css/${file}`);
  if (file === "reset.css") return SCOPED_RESET;
  if (file === "fonts.css") css = css.replaceAll("../fonts/", `${BASE}fonts/`);
  // Styles de body (base.css, contact.css) : portés par le wrapper.
  css = css.replace(/^body \{/gm, ":where(.lg-page) {");
  // Premier écran : 100svh suffit hors iframe, --fold-h n'existe plus.
  css = css.replace(/\.is-embedded \.hp-fold \{[^}]*\}\s*/g, "");
  // La nav fixe recouvre toujours le haut de la page : on la dégage.
  css = css.replaceAll(".is-embedded ", ".lg-page ");
  if (file === "platform.css") css = css.replace("scroll-margin-top: 24px;", `scroll-margin-top: ${NAV_OFFSET + 24}px;`);
  return `/* ${file} */\n${css}`;
};

const cssOf = (html) =>
  [...html.matchAll(/<link rel="stylesheet" href="css\/([^"]+)"/g)].map((m) => cssFile(m[1])).join("\n");

// ---------- HTML ----------

const absolutize = (html) => html.replace(/(src|href|srcset|poster)="(assets|fonts|leo-anims)\//g, `$1="${BASE}$2/`);

const minify = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

// Découpe en morceaux < EMBED_MAX, uniquement entre deux éléments de premier
// niveau (un Code Embed doit contenir du HTML complet).
const topLevelBlocks = (html) => {
  const blocks = [];
  let depth = 0;
  let start = 0;
  const re = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
  const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "stop", "use", "feGaussianBlur", "feOffset", "feBlend", "feMerge", "feMergeNode", "feColorMatrix", "feComposite", "feFlood"]);
  let m;
  while ((m = re.exec(html))) {
    const [, closing, tag, selfClosing] = m;
    if (selfClosing || (VOID.has(tag) && !closing)) {
      if (depth === 0) {
        blocks.push(html.slice(start, re.lastIndex));
        start = re.lastIndex;
      }
      continue;
    }
    // Contenu de <script>/<style>/<template> : pas de balises à suivre dedans
    if (!closing && (tag === "script" || tag === "style")) {
      const end = html.indexOf(`</${tag}>`, re.lastIndex);
      re.lastIndex = end + tag.length + 3;
      if (depth === 0) {
        blocks.push(html.slice(start, re.lastIndex));
        start = re.lastIndex;
      }
      continue;
    }
    depth += closing ? -1 : 1;
    if (depth < 0) throw new Error(`Balise fermante en trop : </${tag}> à ${m.index}`);
    if (depth === 0) {
      blocks.push(html.slice(start, re.lastIndex));
      start = re.lastIndex;
    }
  }
  if (depth !== 0) throw new Error(`HTML non équilibré (profondeur ${depth})`);
  const rest = html.slice(start).trim();
  if (rest) blocks.push(rest);
  return blocks.map((b) => b.trim()).filter(Boolean);
};

const chunk = (blocks) => {
  const chunks = [];
  let cur = "";
  for (const b of blocks) {
    if (b.length > EMBED_MAX) throw new Error(`Bloc trop gros pour un Code Embed (${b.length}) : ${b.slice(0, 80)}`);
    if (cur && cur.length + 1 + b.length > EMBED_MAX) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${b}` : b;
  }
  if (cur) chunks.push(cur);
  return chunks;
};

const between = (html, open, close) => {
  const a = html.indexOf(open);
  const b = html.lastIndexOf(close);
  if (a < 0 || b < 0) throw new Error(`${open} … ${close} introuvable`);
  return html.slice(a + open.length, b);
};

// ---------- Pages ----------

const FONTS_HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="preload" href="${BASE}fonts/Fraunces-latin.woff2" as="font" type="font/woff2" crossorigin />`;

const LEO_WIDGET = `<!-- Agent Leo (bulle en bas à droite). S'il passe un jour dans le Footer
     code du site (toutes les pages), retirer ces trois lignes. -->
<link rel="stylesheet" href="${BASE}leo-widget/leo-widget.min.css?v=${hash(read("leo-widget/leo-widget.min.css"))}">
<script src="${BASE}leo-widget/config.js?v=${hash(read("leo-widget/config.js"))}" defer></script>
<script src="${BASE}leo-widget/leo-widget.min.js?v=${hash(read("leo-widget/leo-widget.min.js"))}" defer></script>`;

const PAGES = [
  {
    name: "home",
    source: "index.html",
    // Le wrapper .lg-page est le <main> (Div Block, tag « main » dans Webflow).
    body: (html) => between(html, "<main>", "</main>"),
    js: () => read("js/main.js").replaceAll("fetch(`leo-anims/", `fetch(\`${BASE}leo-anims/`),
    head: () => `<!-- Active les apparitions au scroll avant le premier rendu (.js-reveal). -->
<script>document.documentElement.classList.add("js-reveal");</script>`,
    footer: (v) => `<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js"></script>
<script src="${BASE}webflow/home/page.js?v=${v}"></script>
${LEO_WIDGET}`,
  },
  {
    name: "contact",
    source: "contact.html",
    // <main class="ct-page"> + bouton collé en bas : le wrapper .lg-page est
    // un simple Div Block (tag div, le <main> est dans l'embed).
    body: (html) => between(html, "<body>", '<script src="js/contact.js"></script>'),
    js: () => read("js/contact.js"),
    head: () => "",
    footer: (v) => `<script>window.legaleoNavOffset = ${NAV_OFFSET};</script>
<script src="${BASE}webflow/contact/page.js?v=${v}"></script>`,
  },
];

rmSync(join(ROOT, "webflow"), { recursive: true, force: true });

for (const page of PAGES) {
  const html = read(page.source);
  const out = join(ROOT, "webflow", page.name);
  mkdirSync(out, { recursive: true });

  const body = minify(absolutize(page.body(html)));
  const embeds = chunk(topLevelBlocks(body));
  embeds.forEach((e, i) => writeFileSync(join(out, `embed-${i + 1}.html`), e + "\n"));

  const css = cssOf(html);
  const js = page.js();
  writeFileSync(join(out, "page.css"), css);
  writeFileSync(join(out, "page.js"), js);

  const head = [FONTS_HEAD, `<link rel="stylesheet" href="${BASE}webflow/${page.name}/page.css?v=${hash(css)}" />`, page.head()]
    .filter(Boolean)
    .join("\n");
  writeFileSync(join(out, "head.html"), head + "\n");
  const footer = page.footer(hash(js));
  writeFileSync(join(out, "footer.html"), footer + "\n");

  const sizes = embeds.map((e) => e.length);
  console.log(`${page.name}: ${embeds.length} embed(s) [${sizes.join(", ")}], head ${head.length}, footer ${footer.length} car.`);
}
