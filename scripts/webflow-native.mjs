// Migration native Webflow (éléments + classes Webflow, sans Code Embed
// géant) : `node scripts/webflow-native.mjs`.
//
// Pour chaque page (homepage, contact, Leo), prépare ce que le MCP Webflow
// importe avec data_whtml_builder (HTML + CSS -> éléments et classes natifs) :
//
//   webflow-native/<page>/sections/NN.html  HTML d'un bloc de premier niveau,
//                                           à insérer dans l'ordre dans le
//                                           wrapper .lg-page ;
//   webflow-native/<page>/sections/NN.css   règles CSS natives de ce bloc ;
//   webflow-native/<page>/embeds/<nom>.html sous-arbres gardés en Code Embed
//                                           (mini-applis pilotées par le JS :
//                                           formulaire de réservation…),
//                                           repérés dans le HTML par
//                                           <div class="lg-slot" data-lg-slot="<nom>"> ;
//   webflow-native/<page>/custom.css        tout ce que l'import natif refuse,
//                                           servi par GitHub Pages et chargé
//                                           dans le head de la page.
//
// Ce que l'import natif accepte (vérifié sur le site) : sélecteurs d'une
// classe ou de classes combinées (.a, .a.b), états :hover/:focus…, media
// queries des breakpoints Webflow (991 / 767 / 479 px). Il refuse les
// sélecteurs imbriqués et les pseudo-éléments, ignore les variables CSS, et
// abîme `translate` (« -50% 0 » -> « -50%0 ») et les listes de polices.
// Tout le reste part dans custom.css, avec les keyframes, les autres
// breakpoints (640, 1100 px…), prefers-reduced-motion et les variables.
// Une classe sans règle native est supprimée à l'import : chaque classe du
// HTML natif reçoit au moins une règle (vide si besoin) pour que le JS et
// custom.css la retrouvent.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { parse } from "node-html-parser";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEO_ROOT = join(ROOT, "..", "front-legaleo-leo");
const OUT = join(ROOT, "webflow-native");
const HOME_BASE = "https://alexandre-legaleo.github.io/legaleo-homepage-preview/";
const LEO_BASE = "https://alexandre-legaleo.github.io/legaleo-leo-preview/";
const NAV_OFFSET = 80; // nav fixe de legaleo.ai

// Images déjà dans la médiathèque Webflow (chemin local -> URL CDN Webflow).
const ASSETS = JSON.parse(readFileSync(join(ROOT, "webflow-assets.json"), "utf8"));

const PAGES = [
  {
    name: "contact",
    root: ROOT,
    base: HOME_BASE,
    html: "contact.html",
    body: (h) => h.slice(h.indexOf("<body>") + 6, h.indexOf('<script src="js/contact.js">')),
    wrapperTag: "div", // le <main class="ct-page"> est dans le contenu
    embeds: { reservation: "[data-book]" },
  },
  {
    name: "home",
    root: ROOT,
    base: HOME_BASE,
    html: "index.html",
    body: (h) => h.slice(h.indexOf("<main>") + 6, h.lastIndexOf("</main>")),
    wrapperTag: "main",
    embeds: {},
    // Mockups animés : conteneur natif (classes, taille), contenu injecté par
    // le JS depuis includes.json (voir plus bas). Données de démo, rien à
    // éditer dans Webflow ni à indexer.
    includes: [".hp-hero-visual", ".hp-marquee", ".hp-feature-visual", ".hp-av-visual", ".hp-params", ".hp-costchart", ".hp-chat", ".hp-sv", ".hp-stades-curve", ".hp-aud-net"],
  },
  {
    name: "leo",
    root: LEO_ROOT,
    base: LEO_BASE,
    html: "index.html",
    body: (h) => h.slice(h.indexOf("<main>") + 6, h.lastIndexOf("</main>")),
    wrapperTag: "main",
    embeds: {},
    skipCss: ["footer.css"],
    // Le CSS du site garde des classes lb-* d'un ancien import de la page :
    // tout passe en lv-* (comme le build Code Embed et son JS, webflow/leo/).
    rename: [/(?<![\w-])lb-(?=[a-zA-Z0-9])/g, "lv-"],
    extraCss: ["code-components/preview-dist/code-components.css"],
  },
];

// ---------- CSS ----------

const NATIVE_MEDIA = /^(screen and )?\(max-width:\s*991px\)$/;
const NATIVE_PSEUDO = new Set([":hover", ":focus", ":active"]); // seuls états acceptés

// Sélecteur importable tel quel : une ou plusieurs classes collées, plus un
// état éventuel. Renvoie la liste des classes, ou null.
function nativeSelector(sel) {
  let ok = true;
  const classes = [];
  selectorParser((root) => {
    if (root.nodes.length !== 1) return (ok = false);
    root.nodes[0].each((n) => {
      if (n.type === "class") classes.push(n.value);
      else if (n.type === "pseudo" && NATIVE_PSEUDO.has(n.value) && !n.nodes.length) return;
      else ok = false;
    });
  }).processSync(sel);
  return ok && classes.length ? classes : null;
}

// Déclaration que l'import ne restitue pas fidèlement.
const unsafeDecl = (d) =>
  d.prop.startsWith("--") ||
  d.important ||
  ["translate", "content", "font"].includes(d.prop) ||
  // background à plusieurs couches avec taille (« … 0 0 / 18px 18px, … ») :
  // l'import ne garde que la dernière couche
  (d.prop === "background" && d.value.includes(",") && d.value.includes("/")) ||
  // data URI avec « ; » (styles SVG embarqués) : refusée par l'import
  (/url\(\s*["']?data:/.test(d.value) && d.value.includes(";")) ||
  (d.prop === "font-family" && !/^var\(/.test(d.value));

// reset.css confiné au wrapper, comme pour le build Code Embed : le CSS du
// site style les balises nues (p, h1…h6, ul…), la page compte sur les valeurs
// du navigateur. Spécificité 0,0,1 chargée après le CSS du site : les classes
// (natives ou non) passent toujours devant.
const SCOPED_RESET = `
:where(.lg-page) :is(p, h1, h2, h3, h4, h5, h6, ul, ol, li, a, b, strong, em, small, sub, sup, img, label, blockquote, figure, figcaption, button, input, select, textarea, summary, details, span, div, section, main, header, footer, nav, article) { all: revert; box-sizing: border-box; }
:where(.lg-page) { font-size: 16px; line-height: normal; font-weight: 400; letter-spacing: normal; text-align: left; --anchor-offset: ${NAV_OFFSET + 16}px; }
:where(.lg-page), :where(.lg-page) *, :where(.lg-page) *::before, :where(.lg-page) *::after { box-sizing: border-box; }
:where(.lg-page) section[id] { scroll-margin-top: var(--anchor-offset, 0px); }
:where(.lg-page) img, :where(.lg-page) svg { display: block; max-width: 100%; }
:where(.lg-page) svg:not(:root) { overflow: revert; }
:where(.lg-page) a { color: inherit; text-decoration: none; }
:where(.lg-page) button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
:where(.lg-page) ul { margin: 0; padding: 0; list-style: none; }
:where(.lg-page) h1, :where(.lg-page) h2, :where(.lg-page) h3, :where(.lg-page) h4, :where(.lg-page) p { margin: 0; }
/* hidden retiré par Webflow à la publication (voir processHtml). */
[data-lg-hidden] { display: none !important; }
/* normalize Webflow : svg:not(:root) { overflow: hidden } bat les classes
   seules qui veulent overflow visible. */
.lg-page svg:is(.hp-eco-svg, .hp-sc-sigsvg, .hp-stades-curve-svg) { overflow: visible; }
/* <button> importé = lien .w-button Webflow (fond bleu, padding 9px 15px) :
   retour à l'aspect du bouton remis à zéro (reset ci-dessus). */
.lg-page .w-button { padding: 1px 6px; background-color: transparent; border-radius: 0; line-height: normal; }
/* Code Embed Webflow : pas de clearfix autour des embeds de la page. */
.lg-page .w-embed::before, .lg-page .w-embed::after { content: none; }
`;

function processCss(page, htmlSource, nativeClasses, classLists) {
  // Une classe combinée (.a.b) n'est créée par l'import que si un élément
  // porte déjà toutes ces classes : les états ajoutés par le JS
  // (.hp-sc.is-active…) restent donc dans custom.css.
  const comboExists = (classes) => classes.length === 1 || classLists.some((list) => classes.every((c) => list.includes(c)));
  const files = [...htmlSource.matchAll(/<link rel="stylesheet" href="css\/([^"]+)"/g)]
    .map((m) => m[1])
    .filter((f) => f !== "reset.css" && !(page.skipCss || []).includes(f));
  const read = (p) => readFileSync(join(page.root, p), "utf8");
  let src = files.map((f) => `/* ${f} */\n` + read(`css/${f}`)).join("\n");
  for (const f of page.extraCss || []) src += `\n/* ${f} */\n` + read(f);

  if (page.rename) src = src.replace(...page.rename);
  // Le site Webflow charge Fraunces depuis Google Fonts (réglages du site,
  // utilisé par les autres pages) : même nom de famille, chargée après,
  // elle remplace la Fraunces auto-hébergée (sans « wonky », taille optique
  // automatique). Nom propre à la nôtre, comme la police installée sur le
  // site (« Fraunces LG »). Leo garde Google Fraunces, comme sa source.
  if (page.root === ROOT) src = src.replaceAll('"Fraunces"', '"Fraunces LG"');
  // Ajustements « hors iframe » (même logique que build-webflow.mjs).
  src = src
    .replaceAll("../fonts/", `${page.base}fonts/`)
    .replaceAll("url('/assets/", `url('${page.base}assets/`)
    .replace(/\.is-embedded \.hp-fold \{[^}]*\}\s*/g, "")
    .replaceAll("var(--embed-vh, auto)", "100svh")
    .replace(/^body \{/gm, ".lg-page {");

  const root = postcss.parse(src);
  // .is-embedded X : la nav fixe recouvre toujours le haut, la règle devient X.
  root.walkRules((r) => {
    r.selectors = r.selectors.map((s) => s.replace(/^\.is-embedded\s+/, ""));
  });
  if (page.name === "home") {
    root.walkDecls("scroll-margin-top", (d) => {
      if (d.value === "24px") d.value = `${NAV_OFFSET + 24}px`;
    });
  }

  const native = []; // { media|null, selector, decls[], classes[] }
  const custom = postcss.root();
  const keep = (node) => custom.append(node.clone());

  root.each((node) => {
    if (node.type === "comment") return;
    if (node.type === "atrule") {
      if (node.name === "media" && NATIVE_MEDIA.test(node.params.trim())) {
        const rest = postcss.atRule({ name: "media", params: node.params });
        node.each((r) => splitRule(r, "screen and (max-width: 991px)", rest));
        if (rest.nodes?.length) custom.append(rest);
      } else keep(node);
      return;
    }
    if (node.type === "rule") splitRule(node, null, custom);
  });

  function splitRule(rule, media, residualParent) {
    if (rule.type !== "rule") return residualParent.append(rule.clone());
    const nativeSels = [];
    const otherSels = [];
    for (const sel of rule.selectors) {
      const classes = nativeSelector(sel);
      // .lg-page (ex-body) : classe commune aux trois pages, mais fond et
      // couleur propres à chacune (contact : beige) -> custom.css de la page.
      if (classes && !classes.includes("lg-page") && classes.every((c) => nativeClasses.has(c)) && comboExists(classes)) nativeSels.push({ sel, classes });
      else otherSels.push(sel);
    }
    const decls = rule.nodes.filter((n) => n.type === "decl");
    const safe = decls.filter((d) => !unsafeDecl(d));
    const unsafe = decls.filter(unsafeDecl);
    for (const { sel, classes } of nativeSels) {
      // Une propriété déclarée deux fois : seule la dernière compte (l'import
      // pourrait garder la première).
      const last = [...new Map(safe.map((d) => [d.prop, d])).values()];
      if (safe.length) native.push({ media, selector: sel, classes, decls: last.map((d) => `${d.prop}: ${d.value.replace(/\s*\n\s*/g, " ")}`) });
    }
    const residualSels = [...otherSels, ...(unsafe.length ? nativeSels.map((s) => s.sel) : [])];
    if (otherSels.length) residualParent.append(rule.clone({ selectors: otherSels }));
    if (unsafe.length && nativeSels.length)
      residualParent.append(postcss.rule({ selectors: nativeSels.map((s) => s.sel), nodes: unsafe.map((d) => d.clone()) }));
    return residualSels;
  }

  // Classes sans règle native : règle vide, sinon l'import les supprime.
  const covered = new Set(native.filter((r) => r.classes.length === 1 && r.selector === `.${r.classes[0]}`).map((r) => r.classes[0]));
  for (const c of nativeClasses) {
    if (!covered.has(c)) native.unshift({ media: null, selector: `.${c}`, classes: [c], decls: ["--lg-keep: 0"] });
  }

  const customCss = `/* Généré par scripts/webflow-native.mjs — ne pas éditer à la main. */\n${SCOPED_RESET}\n${custom.toString()}\n`;
  return { native, customCss };
}

// Le Designer n'exécute pas le custom code de la page : sans custom.css, pas
// de reset, de puces, de coches… Copie des règles de custom.css qui touchent
// les éléments natifs (pas les mockups : leurs conteneurs sont vides dans le
// Designer), servie par GitHub Pages (designer.css) et chargée par un Code
// Embed en tête du wrapper (designer-embed.html). Chaque sélecteur est
// préfixé par :where(.wf-design-mode), classe que Webflow pose sur <html>
// dans le canvas seulement (vérifié) : spécificité inchangée, et sur le site
// publié la copie ne s'applique pas (custom.css reste la seule source).
const DESIGN_MODE = ":where(.wf-design-mode)";

function designerCss(customCss, includeOnly) {
  const root = postcss.parse(customCss);
  const touchesInclude = (sel) => {
    let hit = false;
    selectorParser((r) => r.walkClasses((c) => { if (includeOnly.has(c.value)) hit = true; })).processSync(sel);
    return hit;
  };
  const scope = (sel) => (/^:root\b/.test(sel) ? sel.replace(/^:root/, DESIGN_MODE) : `${DESIGN_MODE} ${sel}`);
  const filter = (container) => {
    container.each((node) => {
      if (node.type === "comment") return node.remove();
      if (node.type === "atrule") {
        // keyframes, font-face… : inutiles dans le canvas
        if (node.name !== "media" && node.name !== "supports") return node.remove();
        filter(node);
        if (!node.nodes?.length) node.remove();
        return;
      }
      if (node.type !== "rule") return;
      const sels = node.selectors.filter((s) => !touchesInclude(s));
      if (!sels.length) return node.remove();
      node.selectors = sels.map(scope);
    });
  };
  filter(root);
  return `/* Généré par scripts/webflow-native.mjs — ne pas éditer à la main. */\n${root.toString()}\n`;
}

const nativeCssFor = (rules) => {
  const base = rules.filter((r) => !r.media).map((r) => `${r.selector} { ${r.decls.join("; ")}; }`);
  const mq = rules.filter((r) => r.media).map((r) => `  ${r.selector} { ${r.decls.join("; ")}; }`);
  return base.join("\n") + (mq.length ? `\n@media screen and (max-width: 991px) {\n${mq.join("\n")}\n}` : "") + "\n";
};

// ---------- HTML ----------

function processHtml(page, html) {
  let body = page.body(html).replace(/<!--[\s\S]*?-->/g, "");
  if (page.rename) body = body.replace(...page.rename);
  // Images -> médiathèque Webflow ; autres chemins relatifs -> GitHub Pages.
  body = body.replace(/(src|href)="((?:assets|fonts|leo-anims)\/[^"]+)"/g, (m, attr, path) =>
    ASSETS[path] ? `${attr}="${ASSETS[path]}"` : `${attr}="${page.base}${path}"`
  );
  body = body.replace(/\s+/g, " ").replace(/> </g, "><").trim();

  const wrapper = parse(`<${page.wrapperTag} class="lg-page">${body}</${page.wrapperTag}>`, {
    lowerCaseTagName: false,
    comment: false,
    blockTextElements: { script: true, style: true, template: true },
  }).firstChild;

  const embeds = {};
  for (const [name, selector] of Object.entries(page.embeds)) {
    const el = wrapper.querySelector(selector);
    if (!el) throw new Error(`${page.name} : ${selector} introuvable`);
    embeds[name] = el.outerHTML;
    el.replaceWith(parse(`<div class="lg-slot" data-lg-slot="${name}"></div>`).firstChild);
  }

  // Includes : le conteneur reste (vide, data-lg-include), le contenu part
  // dans includes.json.
  const includes = {};
  for (const selector of page.includes || []) {
    wrapper.querySelectorAll(selector).forEach((el, i) => {
      const name = `${selector.replace(/^[.#]/, "")}-${i + 1}`;
      includes[name] = el.innerHTML;
      el.set_content("");
      el.setAttribute("data-lg-include", name);
    });
  }

  const classes = new Set(["lg-page"]);
  const classLists = [];
  wrapper.querySelectorAll("[class]").forEach((el) => {
    classLists.push(el.classList.value);
    el.classList.value.forEach((c) => classes.add(c));
  });

  // Styles inline : l'import les supprime. Chaque élément concerné reçoit
  // data-lg-style="N" et sa déclaration part dans custom.css.
  const inlineStyles = [];
  wrapper.querySelectorAll("[style]").forEach((el) => {
    inlineStyles.push(el.getAttribute("style"));
    el.removeAttribute("style");
    el.setAttribute("data-lg-style", String(inlineStyles.length));
  });

  // Webflow retire l'attribut booléen hidden à la publication : il devient
  // data-lg-hidden (masqué par custom.css, remis en hidden au chargement,
  // voir LG_HIDDEN_SCRIPT), pour que le JS de la page le retrouve.
  wrapper.querySelectorAll("[hidden]").forEach((el) => {
    el.removeAttribute("hidden");
    el.setAttribute("data-lg-hidden", "");
  });

  // Blocs de premier niveau : un appel d'import par bloc (taille raisonnable).
  const sections = wrapper.childNodes.filter((n) => n.nodeType === 1).map((n) => n.outerHTML);
  return { wrapperTag: page.wrapperTag, sections, embeds, includes, classes, classLists, inlineStyles };
}

const classesIn = (html) => {
  const set = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).filter(Boolean).forEach((c) => set.add(c));
  return set;
};

// Remet hidden sur les éléments marqués data-lg-hidden dès que le DOM est
// prêt, avant le JS de la page (chargé en pied de page).
const LG_HIDDEN_SCRIPT = `<script>document.addEventListener("DOMContentLoaded",function(){document.querySelectorAll("[data-lg-hidden]").forEach(function(e){e.hidden=true;e.removeAttribute("data-lg-hidden")})});</script>`;

// ---------- Pages ----------

rmSync(OUT, { recursive: true, force: true });
for (const page of PAGES) {
  if (!existsSync(join(page.root, page.html))) continue;
  const html = readFileSync(join(page.root, page.html), "utf8");
  const { wrapperTag, sections, embeds, includes, classes, classLists, inlineStyles } = processHtml(page, html);
  let { native, customCss } = processCss(page, html, classes, classLists);
  customCss += inlineStyles.map((st, i) => `.lg-page [data-lg-style="${i + 1}"] { ${st} }`).join("\n") + "\n";

  const dir = join(OUT, page.name);
  mkdirSync(join(dir, "sections"), { recursive: true });
  mkdirSync(join(dir, "embeds"), { recursive: true });

  // Règles natives réparties par bloc : celles dont toutes les classes sont
  // dans le bloc ; une règle n'est envoyée qu'une fois (premier bloc qui l'a).
  const sent = new Set();
  const report = [];
  sections.forEach((s, i) => {
    const inSection = classesIn(s);
    const rules = native.filter((r, k) => !sent.has(k) && r.classes.every((c) => inSection.has(c)) && sent.add(k));
    const n = String(i + 1).padStart(2, "0");
    writeFileSync(join(dir, "sections", `${n}.html`), s + "\n");
    writeFileSync(join(dir, "sections", `${n}.css`), nativeCssFor(rules));
    report.push(`${n}: html ${s.length}, ${rules.length} règles`);
  });
  const orphan = native.filter((_, k) => !sent.has(k));
  if (orphan.length) console.warn(`${page.name}: ${orphan.length} règle(s) natives sans bloc (classes réparties sur plusieurs blocs) -> wrapper`);
  writeFileSync(join(dir, "wrapper.css"), `.lg-page { --lg-keep: 0; }\n` + nativeCssFor(orphan.filter((r) => r.selector !== ".lg-page")));
  for (const [name, h] of Object.entries(embeds)) writeFileSync(join(dir, "embeds", `${name}.html`), h + "\n");
  writeFileSync(join(dir, "custom.css"), customCss);

  const sectionClasses = new Set(sections.flatMap((s) => [...classesIn(s)]).concat(Object.values(embeds).flatMap((h) => [...classesIn(h)])));
  const includeOnly = new Set([...classesIn(Object.values(includes).join(""))].filter((c) => !sectionClasses.has(c)));
  const designer = designerCss(customCss, includeOnly);
  writeFileSync(join(dir, "designer.css"), designer);
  // Contenu du Code Embed : URL fixe (pas de ?v=), le Designer recharge la
  // feuille à l'ouverture de la page.
  writeFileSync(join(dir, "designer-embed.html"), `<link rel="stylesheet" href="${HOME_BASE}webflow-native/${page.name}/designer.css" />\n`);

  // Custom code de la page (Page settings > Custom code), posé par le MCP :
  // polices, custom.css (GitHub Pages) ; en pied de page, le JS de la page
  // (même bundle que le build Code Embed : webflow/<page>/footer.html).
  const v = createHash("sha1").update(customCss).digest("hex").slice(0, 8);
  const head = [
    `<link rel="preconnect" href="https://fonts.googleapis.com" />`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`,
    page.name === "leo"
      ? `<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@300;400;500;600;700&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet" />`
      : `<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />\n<link rel="preload" href="${page.base}fonts/Fraunces-latin.woff2" as="font" type="font/woff2" crossorigin />`,
    `<link rel="stylesheet" href="${HOME_BASE}webflow-native/${page.name}/custom.css?v=${v}" />`,
    page.name === "home" ? `<script>document.documentElement.classList.add("js-reveal");</script>` : "",
    LG_HIDDEN_SCRIPT,
  ].filter(Boolean).join("\n");
  writeFileSync(join(dir, "head.html"), head + "\n");
  let footer = readFileSync(join(page.root, "webflow", page.name, "footer.html"), "utf8");
  if (Object.keys(includes).length) {
    const json = JSON.stringify(includes);
    writeFileSync(join(dir, "includes.json"), json);
    const iv = createHash("sha1").update(json).digest("hex").slice(0, 8);
    // Le JS de la page attend les mockups : il est chargé après l'injection.
    footer = footer.replace(/<script src="([^"]*\/page\.js\?v=[^"]*)"><\/script>/, (m, src) => `<script>
(function () {
  // Mockups (includes.json, GitHub Pages) injectés dans leurs conteneurs
  // [data-lg-include], puis JS de la page. Généré par webflow-native.mjs.
  function run() { var s = document.createElement("script"); s.src = "${src}"; document.body.appendChild(s); }
  fetch("${HOME_BASE}webflow-native/${page.name}/includes.json?v=${iv}")
    .then(function (r) { return r.json(); })
    .then(function (m) {
      document.querySelectorAll("[data-lg-include]").forEach(function (el) {
        if (m[el.getAttribute("data-lg-include")] != null) el.innerHTML = m[el.getAttribute("data-lg-include")];
      });
    })
    .catch(function () {})
    .then(run);
})();
</script>`);
  }
  writeFileSync(join(dir, "footer.html"), footer);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ wrapperTag, sections: sections.length, embeds: Object.keys(embeds) }, null, 1));
  console.log(`${page.name}: ${sections.length} bloc(s), ${native.length} règles natives, custom.css ${customCss.length} car.\n  ${report.join("\n  ")}`);
}
