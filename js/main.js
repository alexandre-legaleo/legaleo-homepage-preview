// Animations et interactions de la homepage.
//
// Tout ce qui « joue » (mockups, compteurs) passe par IntersectionObserver
// avec la racine implicite : ça marche aussi dans l'iframe Webflow, où la page
// ne défile jamais elle-même (c'est le parent qui défile). Pour la même
// raison, pas de rootMargin (ignoré dans un iframe cross-origin) ni
// d'écouteur de scroll.
//
// prefers-reduced-motion : chaque mockup s'affiche directement dans son état
// final, sans boucle.
(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Joue `cycle` en boucle tant que `el` est visible. Un cycle entamé va
  // jusqu'au bout ; le suivant ne démarre que si l'élément est encore visible.
  function loopWhileVisible(el, cycle, threshold = 0.35) {
    let visible = false;
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      while (visible) await cycle();
      running = false;
    };
    new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) run();
      },
      { threshold }
    ).observe(el);
  }

  function onceVisible(el, fn, threshold = 0.35) {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        fn();
      },
      { threshold }
    );
    io.observe(el);
  }

  function countUp(el, to, duration = 1100) {
    if (reduced) {
      el.textContent = to;
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      // Borné à 0 : l'horodatage de la frame peut précéder `start`.
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function typeInto(el, text, speed = 70) {
    for (let i = 1; i <= text.length; i++) {
      el.textContent = text.slice(0, i);
      await wait(speed);
    }
  }

  // Applique `mutate` (changement de classes, de texte…) en animant la
  // hauteur de `el` de l'ancienne valeur à la nouvelle au lieu de sauter.
  // Mesure partie de la hauteur affichée : une animation en cours est reprise
  // là où elle en est, sans à-coup.
  const heightAnims = new WeakMap();
  function smoothHeight(el, mutate, duration = 500) {
    const from = el.getBoundingClientRect().height;
    heightAnims.get(el)?.cancel();
    mutate();
    const to = el.getBoundingClientRect().height;
    if (reduced || Math.abs(to - from) < 1) return;
    heightAnims.set(
      el,
      el.animate([{ height: from + "px" }, { height: to + "px" }], {
        duration,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      })
    );
  }

  function setPill(pill, tone, label) {
    pill.className = "hp-pill hp-pill--" + tone;
    pill.textContent = label;
  }

  // Ressort amorti (même modèle que les transitions « spring » de Framer
  // Motion), échantillonné en easing linear() pour les animations WAAPI.
  // Renvoie { easing, duration } : la durée est celle qu'il faut au ressort
  // pour se poser. Navigateur sans linear() : repli sur une courbe proche.
  const supportsLinearEasing = CSS.supports("animation-timing-function", "linear(0, 1)");
  function spring({ stiffness = 260, damping = 24, mass = 1 } = {}) {
    const w0 = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    let x;
    let settle;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      x = (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
      settle = Math.log(1000 * (1 + (zeta * w0) / wd)) / (zeta * w0);
    } else {
      x = (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
      settle = 9 / w0;
    }
    const duration = Math.round(settle * 1000);
    if (!supportsLinearEasing) return { easing: "cubic-bezier(0.22, 1, 0.36, 1)", duration };
    const steps = 48;
    const points = [];
    for (let i = 0; i <= steps; i++) points.push(+x((settle * i) / steps).toFixed(4));
    points[steps] = 1;
    return { easing: `linear(${points.join(", ")})`, duration };
  }

  // ---------- Leo : animations Lottie ----------
  // Portage de front-legaleo-leo/js/anims.js : renderer canvas (le SVG laisse
  // un filet clair entre les paths qui se touchent), caps ronds (encoche au
  // bout des traits sous Safari), canvas forcé à remplir son conteneur.
  // Chaque conteneur .hp-leo-lottie est posé sur un picto statique
  // .hp-leo-glyph, masqué seulement une fois l'animation prête : sans lottie,
  // sans réseau ou en reduced-motion, le picto statique reste.
  const leoAnims = (() => {
    const sources = new Map();
    const players = new Map();

    const roundCaps = (node) => {
      if (Array.isArray(node)) node.forEach(roundCaps);
      else if (node && typeof node === "object") {
        if (node.ty === "st" || node.ty === "gs") node.lc = 2;
        Object.values(node).forEach(roundCaps);
      }
      return node;
    };

    // Mémorisé en texte et reparsé à chaque usage : lottie écrit dans l'objet
    // qu'on lui passe, deux badges ne peuvent pas partager le même.
    const load = (file) => {
      if (!sources.has(file)) {
        sources.set(
          file,
          fetch(`leo-anims/${file}`)
            .then((r) => {
              if (!r.ok) throw new Error(r.status);
              return r.json();
            })
            .then((data) => JSON.stringify(roundCaps(data)))
        );
      }
      return sources.get(file).then(JSON.parse);
    };

    // Hors écran, l'animation est mise en pause.
    const io = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        const anim = players.get(target)?.anim;
        if (!anim) return;
        if (isIntersecting) anim.play();
        else anim.pause();
      });
    });

    // Joue `file` dans `container`, en remplaçant l'animation en cours.
    // Un jeton par conteneur : si un autre play arrive pendant le chargement,
    // le plus récent l'emporte. `segment` ([début, fin] en frames) ne joue
    // qu'une partie du fichier. `transform` retouche les données (copie
    // propre à ce conteneur) avant lecture. Renvoie l'instance lottie (ou null).
    function play(container, file, { loop = true, segment = null, onComplete, transform } = {}) {
      if (!container || !window.lottie || reduced) return Promise.resolve(null);
      let state = players.get(container);
      if (!state) {
        state = { token: 0, anim: null };
        players.set(container, state);
        io.observe(container);
      }
      const token = ++state.token;
      return load(file)
        .then((animationData) => {
          if (state.token !== token) return null;
          if (transform) animationData = transform(animationData);
          state.anim?.destroy();
          const anim = window.lottie.loadAnimation({ container, renderer: "canvas", loop, autoplay: !segment, animationData });
          state.anim = anim;
          if (segment) anim.playSegments(segment, true);
          anim.addEventListener("DOMLoaded", () => {
            const canvas = $("canvas", container);
            if (canvas) Object.assign(canvas.style, { width: "100%", height: "100%", display: "block" });
            container.parentElement.classList.add("has-lottie");
          });
          if (!loop && onComplete) anim.addEventListener("complete", onComplete);
          return anim;
        })
        .catch(() => null);
    }

    return { play };
  })();

  // Badges déclarés dans le HTML : <span class="hp-leo-lottie" data-leo-anim="idle.json">
  function initLeoAnims() {
    $$("[data-leo-anim]").forEach((el) => leoAnims.play(el, el.dataset.leoAnim));
  }

  // ---------- Apparition au scroll ----------
  function initReveal() {
    const items = $$("[data-reveal]");
    if (reduced) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.12 }
    );
    items.forEach((el) => io.observe(el));
  }

  // ---------- Logos : boucle continue ----------
  function initMarquee() {
    const marquee = $(".hp-marquee");
    if (!marquee || reduced) return;
    const track = $(".hp-marquee-track", marquee);
    Array.from(track.children).forEach((img) => {
      const clone = img.cloneNode(true);
      clone.alt = "";
      clone.setAttribute("aria-hidden", "true");
      track.appendChild(clone);
    });
    marquee.classList.add("is-running");
  }

  // ---------- Hero : écosystème (GSAP) ----------
  // Le cœur Legaleo au centre, six satellites autour. Intro une fois, puis en
  // boucle tant que c'est visible : des documents voyagent sur les liaisons
  // (import et génération vers le cœur, puis avocat, signature, échéances,
  // Leo) et chaque satellite réagit.
  // Sans GSAP (CDN injoignable) ou en reduced-motion : scène à l'arrêt.
  function initHeroEcosystem() {
    const eco = $("#hp-eco");
    if (!eco) return;
    const gsap = window.gsap;
    if (reduced || !gsap) {
      eco.classList.add("is-ready");
      return;
    }

    const NS = "http://www.w3.org/2000/svg";
    const stage = $(".hp-eco-stage", eco);
    const flows = $(".hp-eco-flows", eco);
    const core = $(".hp-eco-core-card", eco);
    const countEl = $("#hp-eco-count", eco);
    const satEls = $$("[data-sat]", eco);
    const sats = {};
    satEls.forEach((el) => {
      sats[el.dataset.sat] = {
        el,
        ico: $(".hp-eco-ico", el),
        status: $(".hp-eco-status", el),
        spoke: $(`[data-spoke="${el.dataset.sat}"]`, eco),
      };
    });
    let count = Number(countEl.textContent);

    const svgEl = (tag, attrs) => {
      const node = document.createElementNS(NS, tag);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
      return node;
    };

    function pulseCore() {
      count += 1;
      countEl.textContent = count;
      gsap.fromTo(core, { scale: 1.05 }, { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.6)" });
    }

    // Un document parcourt la liaison d'un satellite : vers le cœur
    // (inbound) ou depuis le cœur. Traînée « façon Uber » : découpée en
    // tranches dont l'opacité décroît de la tête vers la queue. Le jeton
    // s'arrête au bout, la queue continue et se résorbe dans l'arrivée.
    const SLICES = 16;
    function flow(key, inbound, duration = 1.3) {
      const spoke = sats[key].spoke;
      const d = spoke.getAttribute("d");
      const len = spoke.getTotalLength();
      const seg = len * 0.6;
      const s = seg / SLICES;

      const glow = svgEl("g", { class: "hp-eco-trail hp-eco-trail--glow" });
      const line = svgEl("g", { class: "hp-eco-trail" });
      const slices = [];
      for (let i = 0; i < SLICES; i++) {
        const alpha = Math.pow(1 - i / SLICES, 1.3);
        [glow, line].forEach((group) => {
          // +0.6 : léger recouvrement pour éviter les jours entre tranches.
          const path = svgEl("path", { d, opacity: alpha, "stroke-dasharray": `${s + 0.6} ${len * 3}` });
          group.append(path);
          slices.push({ path, i });
        });
      }
      const token = svgEl("g", {});
      token.append(
        svgEl("circle", { r: 16, class: "hp-eco-token-glow" }),
        svgEl("circle", { r: 5, class: "hp-eco-token-dot" })
      );
      flows.append(glow, line, token);

      const state = { p: 0 };
      let arrived = false;
      const render = () => {
        const { p } = state;
        // Position de la tête sur le tracé (qui part toujours du satellite).
        const head = inbound ? p : len - p;
        slices.forEach(({ path, i }) => {
          const start = inbound ? head - (i + 1) * s : head + i * s;
          path.setAttribute("stroke-dashoffset", -start);
        });
        const pt = spoke.getPointAtLength(gsap.utils.clamp(0, len, head));
        token.setAttribute("transform", `translate(${pt.x} ${pt.y})`);
        token.setAttribute("opacity", p > len ? Math.max(0, 1 - (p - len) / (seg * 0.35)) : Math.min(1, p / 12));
        if (!arrived && p >= len) {
          arrived = true;
          if (inbound) pulseCore();
        }
      };
      render();

      return gsap.to(state, {
        p: len + seg,
        duration,
        ease: "power1.inOut",
        onUpdate: render,
        onComplete: () => [glow, line, token].forEach((n) => n.remove()),
      });
    }

    // Picto Leo animé (voir leoAnims) : accéléré pendant sa scène.
    let leoAnim = null;

    function setStatus(key, text, isDone = false) {
      const s = sats[key].status;
      gsap.timeline()
        .to(s, { opacity: 0, y: -4, duration: 0.15, ease: "power1.in" })
        .call(() => {
          s.textContent = text;
          s.classList.toggle("is-done", isDone);
        })
        .fromTo(s, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" });
    }

    function activate(key, text) {
      sats[key].el.classList.add("is-active");
      gsap.fromTo(sats[key].ico, { scale: 1 }, { scale: 1.18, duration: 0.18, yoyo: true, repeat: 1, ease: "power1.out" });
      setStatus(key, text);
    }

    function done(key, text) {
      sats[key].el.classList.remove("is-active");
      setStatus(key, "✓ " + text, true);
    }

    // Une scène par satellite : jouée à la suite par la boucle, ou seule au
    // clic sur le satellite. Chaque scène active son satellite dès le départ
    // pour que le clic ait un retour immédiat.
    const scenes = {
      // Import en lot des contrats déjà signés
      import: async () => {
        activate("import", "Lyon_2019.pdf…");
        for (let i = 0; i < 3; i++) {
          flow("import", true, 1.15);
          await wait(280);
        }
        await wait(1000);
        done("import", "+3 contrats");
      },
      // Génération d'un DIP
      create: async () => {
        activate("create", "Génération du DIP…");
        await wait(600);
        await flow("create", true);
        done("create", "DIP généré");
      },
      // Relecture par l'avocat
      lawyer: async () => {
        activate("lawyer", "Envoi à l'avocat…");
        await flow("lawyer", false);
        setStatus("lawyer", "Relecture en cours…");
        await wait(1000);
        done("lawyer", "Validé par l'avocat");
      },
      // Signature
      sign: async () => {
        activate("sign", "Envoi eIDAS…");
        await flow("sign", false);
        setStatus("sign", "Signature en cours");
        await wait(900);
        done("sign", "Signé · eIDAS");
      },
      // Suivi des échéances
      track: async () => {
        activate("track", "Analyse du parc…");
        await flow("track", false);
        setStatus("track", "Renouvellement J-90");
        gsap.fromTo($("svg", sats.track.ico), { rotation: -18 }, { rotation: 0, duration: 1, ease: "elastic.out(1, 0.25)", transformOrigin: "50% 10%" });
        await wait(900);
        done("track", "Alerte programmée");
      },
      // Une question à Leo, et sa réponse
      leo: async () => {
        activate("leo", "Question posée…");
        leoAnim?.setSpeed(2.2); // Leo « réfléchit »
        await flow("leo", true);
        await flow("leo", false);
        leoAnim?.setSpeed(1);
        done("leo", "Réponse en 3 s");
      },
    };

    const running = new Set();
    const reverts = {};
    const resetStatus = (key) => setStatus(key, sats[key].status.dataset.idle);

    // Une scène ne se superpose jamais à elle-même (clics répétés, ou clic
    // pendant que la boucle la joue).
    async function play(key, revertAfter = 0) {
      if (running.has(key)) return;
      running.add(key);
      reverts[key]?.kill();
      await scenes[key]();
      running.delete(key);
      if (revertAfter) reverts[key] = gsap.delayedCall(revertAfter, () => resetStatus(key));
    }

    // Après un clic, la boucle automatique se met en retrait quelques
    // secondes pour laisser la main au visiteur.
    const AUTO_RESUME_MS = 6000;
    let lastClick = 0;
    const userIdle = async () => {
      while (Date.now() - lastClick < AUTO_RESUME_MS) await wait(300);
    };

    const cycle = async () => {
      for (const key of Object.keys(scenes)) {
        await userIdle();
        await play(key);
      }
      await wait(2200);
      await userIdle();
      Object.keys(sats).forEach((key) => {
        if (!running.has(key)) resetStatus(key);
      });
      await wait(900);
    };

    function initClicks() {
      eco.classList.add("is-interactive");
      satEls.forEach((el) => {
        el.addEventListener("click", () => {
          lastClick = Date.now();
          gsap.fromTo(el, { scale: 0.93 }, { scale: 1, duration: 0.6, ease: "back.out(3)" });
          play(el.dataset.sat, 3.5);
        });
      });
    }

    // Mouvements d'ambiance : orbites qui tournent, satellites qui flottent.
    // Mis en pause hors écran.
    const ambient = [];
    function startAmbient() {
      const spin = (sel, turns, duration) =>
        ambient.push(gsap.to($(sel, eco), { rotation: 360 * turns, svgOrigin: "300 300", duration, ease: "none", repeat: -1 }));
      spin(".hp-eco-ring--outer", 1, 140);
      spin(".hp-eco-ring--inner", -1, 90);
      spin(".hp-eco-moons--orbit", 1, 46);
      spin(".hp-eco-moons--inner", -1, 30);
      satEls.forEach((el, i) => {
        ambient.push(gsap.to(el, { y: i % 2 ? 6 : -6, duration: 2.4 + i * 0.35, ease: "sine.inOut", yoyo: true, repeat: -1 }));
      });
      new IntersectionObserver(([entry]) => {
        ambient.forEach((t) => (entry.isIntersecting ? t.resume() : t.pause()));
      }).observe(eco);
    }

    leoAnims.play($("#hp-eco-leo-anim", eco), "idle.json").then((anim) => (leoAnim = anim));

    onceVisible(eco, () => {
      eco.classList.add("is-ready");
      // Chaque satellite part du centre de la scène.
      const fromCenter = (axis) => (i, el) =>
        ((50 - parseFloat(el.style[axis === "x" ? "left" : "top"])) / 100) * stage.offsetWidth;

      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from($$(".hp-eco-ring", eco), { scale: 0.3, opacity: 0, svgOrigin: "300 300", duration: 1.5, stagger: 0.12 })
        .from(core, { scale: 0, duration: 1.1, ease: "back.out(1.8)" }, 0.15)
        .from($$(".hp-eco-spokes path", eco), { opacity: 0, duration: 0.6, stagger: 0.06 }, 0.6)
        .from(satEls, {
          x: fromCenter("x"),
          y: fromCenter("y"),
          scale: 0.2,
          opacity: 0,
          duration: 1.1,
          stagger: 0.08,
          ease: "back.out(1.3)",
        }, 0.5)
        .from($$(".hp-eco-moons", eco), { opacity: 0, duration: 0.8 }, 1.2)
        .then(() => {
          startAmbient();
          initClicks();
          loopWhileVisible(eco, cycle);
        });
    }, 0.25);
  }

  // ---------- Stades : mini-visuels ----------
  // Les états visuels sont portés par des classes (.is-writing, .is-ready,
  // .is-importing, .is-alerting) : les transitions et délais sont en CSS.
  function initStades() {
    const launch = $("[data-sv-launch]");
    const network = $("[data-sv-network]");
    const fleet = $("[data-sv-fleet]");

    // Grand réseau : les tuiles arrivent une à une, les chiffres montent.
    if (fleet) {
      onceVisible(fleet, () => {
        fleet.classList.add("is-shown");
        $$("[data-sv-count]", fleet).forEach((el) => countUp(el, Number(el.dataset.svCount), 1100));
      });
    }

    if (launch) {
      const state = $("[data-sv-state]", launch);
      // Temps d'écriture des lignes, lu dans le CSS (--line-t, --line-gap).
      const doc = $(".hp-sv-doc", launch);
      const lines = $$(".hp-sv-line", launch).length;
      const cssSeconds = (name) => parseFloat(getComputedStyle(doc).getPropertyValue(name)) * 1000;
      const writeMs = () => (lines - 1) * cssSeconds("--line-gap") + cssSeconds("--line-t");

      if (reduced) {
        launch.classList.add("is-writing", "is-ready");
        state.textContent = "Conforme loi Doubin";
      } else {
        loopWhileVisible(launch, async () => {
          launch.classList.remove("is-writing", "is-ready");
          state.textContent = "Rédaction en cours…";
          await wait(800);
          // 1. Le texte s'écrit…
          launch.classList.add("is-writing");
          await wait(writeMs() + 450);
          // 2. …puis le tampon tombe.
          launch.classList.add("is-ready");
          state.textContent = "Conforme loi Doubin";
          await wait(3200);
        });
      }
    }

    if (network) {
      if (reduced) {
        network.classList.add("is-importing", "is-alerting");
      } else {
        loopWhileVisible(network, async () => {
          network.classList.remove("is-importing", "is-alerting");
          await wait(700);
          network.classList.add("is-importing");
          await wait(1900);
          network.classList.add("is-alerting");
          await wait(3800);
        });
      }
    }
  }

  // ---------- Plateforme : titres-verbes des étapes ----------
  // Chaque bloc (.hp-feature) porte un titre-verbe [data-step] en tête de sa
  // colonne texte. On observe le bloc entier plutôt que le titre : sans rootMargin (ignoré dans l'iframe),
  // c'est la part visible du bloc qui dit qu'on « arrive » vraiment dessus,
  // et pas seulement que le titre effleure le bas de l'écran.
  //   - 40 % du bloc visible → .is-reached (définitif, lance l'animation) ;
  //   - le bloc le plus visible → .is-current (un seul à la fois).
  function initStepTitles() {
    const steps = $$("[data-step]");
    if (!steps.length) return;
    const blocks = steps.map((step) => step.closest(".hp-feature"));
    const ratios = new Map();
    if (reduced) steps.forEach((step) => step.classList.add("is-reached"));

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          ratios.set(e.target, e.intersectionRatio);
          if (e.intersectionRatio >= 0.4) $("[data-step]", e.target).classList.add("is-reached");
        });
        let current = null;
        let best = 0;
        blocks.forEach((block) => {
          const r = ratios.get(block) || 0;
          if (r > best && $("[data-step]", block).classList.contains("is-reached")) {
            best = r;
            current = block;
          }
        });
        steps.forEach((step) => step.classList.toggle("is-current", step.closest(".hp-feature") === current));
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1] }
    );
    blocks.forEach((block) => io.observe(block));
  }

  // ---------- Mockup 0 : onboarding ----------
  // L'étape « Votre réseau » se remplit (secteur, type, curseur, localisation),
  // « Suivant » passe à l'étape d'après et l'espace personnalisé s'annonce.
  function mockOnboard(root, { hold = 2600 } = {}) {
    const win = $('[data-mock="onboard"]', root);
    if (!win) return null;
    const sector = $("[data-onb-sector]", win);
    const sectorV = $("[data-onb-sector-v]", win);
    const menuItems = $$(".hp-onb-menu-i", win);
    const pick = $("[data-onb-pick]", win);
    const type = $("[data-onb-type]", win);
    const loc = $("[data-onb-loc]", win);
    const range = $("[data-onb-range]", win);
    const count = $("[data-onb-count]", win);
    const next = $("[data-onb-next]", win);
    const [stepNow, stepNext] = $$("[data-onb-step]", win);
    const toast = $("[data-onb-toast]", root);
    const cursor = $("[data-onb-cursor]", win);
    const thumb = $(".hp-onb-range-thumb", win);
    const FRANCHISEES = 24;

    const press = async (el) => {
      el.classList.add("is-pressed");
      await wait(150);
      el.classList.remove("is-pressed");
    };

    const finalState = () => {
      sector.classList.add("is-on", "is-filled");
      sectorV.textContent = "Restauration & Hôtellerie";
      pick.classList.add("is-selected");
      type.classList.add("is-on");
      loc.classList.add("is-on");
      range.style.setProperty("--v", FRANCHISEES + "%");
      count.textContent = FRANCHISEES;
      stepNow.classList.replace("is-current", "is-done");
      stepNext.classList.add("is-current");
      toast.classList.add("is-shown");
    };

    // Curseur : pointe posée à (fx, fy) de la boîte de `el`, coordonnées
    // relatives à la fenêtre du mockup. Rend la main une fois le trajet fini.
    const moveTo = async (el, fx = 0.5, fy = 0.6, t = 600) => {
      const w = win.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      cursor.style.setProperty("--t", t + "ms");
      cursor.style.setProperty("--x", r.left - w.left + r.width * fx + "px");
      cursor.style.setProperty("--y", r.top - w.top + r.height * fy + "px");
      await wait(t);
    };
    const click = async (el) => {
      cursor.classList.add("is-down");
      await press(el);
      cursor.classList.remove("is-down");
    };
    // Glissé du curseur de plage : une seule valeur, mise à jour à chaque
    // image, pilote le pouce, le remplissage, le nombre et le pointeur, qui
    // restent ainsi parfaitement solidaires (pas deux transitions CSS qui
    // divergent).
    const dragRange = (to, duration) =>
      new Promise((resolve) => {
        const rr = range.getBoundingClientRect();
        const wr = win.getBoundingClientRect();
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        cursor.style.setProperty("--t", "0ms");
        const start = performance.now();
        const frame = (now) => {
          const p = Math.min(1, (now - start) / duration);
          const v = to * ease(p);
          range.style.setProperty("--v", v + "%");
          count.textContent = Math.round(v);
          cursor.style.setProperty("--x", rr.left - wr.left + (rr.width * v) / 100 + "px");
          if (p < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });

    const cycle = async () => {
      sector.classList.remove("is-on", "is-filled", "is-open");
      sectorV.textContent = "Sélectionnez un secteur";
      menuItems.forEach((item) => item.classList.remove("is-hover", "is-selected"));
      type.classList.remove("is-on");
      loc.classList.remove("is-on");
      range.classList.remove("is-grabbed");
      range.style.setProperty("--v", "0%");
      count.textContent = "0";
      stepNow.classList.remove("is-done");
      stepNow.classList.add("is-current");
      stepNext.classList.remove("is-current");
      toast.classList.remove("is-shown");
      cursor.classList.add("is-on");
      await wait(400);

      // Liste déroulante : ouverture, survol d'une option puis de la bonne, choix.
      await moveTo(sector, 0.72, 0.6, 700);
      await click(sector);
      sector.classList.add("is-open");
      await wait(250);
      await moveTo(menuItems[0], 0.3, 0.65, 350);
      menuItems[0].classList.add("is-hover");
      await wait(150);
      menuItems[0].classList.remove("is-hover");
      await moveTo(pick, 0.34, 0.6, 320);
      pick.classList.add("is-hover");
      await wait(350);
      await click(pick);
      pick.classList.replace("is-hover", "is-selected");
      await wait(180);
      sector.classList.remove("is-open");
      sector.classList.add("is-on", "is-filled");
      sectorV.textContent = "Restauration & Hôtellerie";
      await wait(300);

      await moveTo(type, 0.55, 0.62, 550);
      await click(type);
      type.classList.add("is-on");
      await wait(250);

      // Curseur : appui sur le pouce, glissé, relâché.
      await moveTo(thumb, 0.5, 0.5, 500);
      cursor.classList.add("is-down");
      range.classList.add("is-grabbed");
      await wait(160);
      await dragRange(FRANCHISEES, 900);
      await wait(80);
      cursor.classList.remove("is-down");
      range.classList.remove("is-grabbed");
      await wait(220);

      await moveTo(loc, 0.5, 0.62, 550);
      await click(loc);
      loc.classList.add("is-on");
      await wait(300);

      await moveTo(next, 0.5, 0.6, 600);
      await click(next);
      stepNow.classList.replace("is-current", "is-done");
      stepNext.classList.add("is-current");
      await wait(300);
      toast.classList.add("is-shown");
      await wait(500);
      // Le curseur s'écarte pour laisser lire le résultat.
      await moveTo(next, -1.6, 0.4, 800);
      await wait(hold);
    };

    return { win, cycle, finalState };
  }

  // ---------- Mockup 1 : modèle, champs dynamiques ----------
  // Chaque champ du panneau « Champs Dynamiques » est glissé dans le
  // préambule : le curseur attrape la ligne, l'étiquette du champ le suit,
  // un emplacement s'ouvre dans le texte et le chip s'y pose au lâcher.
  function mockGenerate(root, { hold = 3400 } = {}) {
    const win = $('[data-mock="generate"]', root);
    if (!win) return null;
    const items = $$("[data-gen-item]", win);
    const chips = $$("[data-gen-var]", win);
    const saved = $("[data-gen-saved]", win);
    const ghost = $("[data-gen-ghost]", win);
    const cursor = $("[data-gen-cursor]", win);

    // Point (fx, fy) de la boîte de `el`, relatif à la fenêtre
    const at = (el, fx, fy) => {
      const w = win.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: r.left - w.left + r.width * fx, y: r.top - w.top + r.height * fy };
    };
    const place = (node, p, t) => {
      node.style.setProperty("--t", t + "ms");
      node.style.setProperty("--x", p.x + "px");
      node.style.setProperty("--y", p.y + "px");
    };

    const finalState = () => {
      chips.forEach((c) => c.classList.remove("is-pending", "is-in", "is-target"));
      items.forEach((it) => it.classList.remove("is-hover"));
      ghost.classList.remove("is-on");
      cursor.classList.remove("is-on");
      setPill(saved, "teal", "Sauvegardé");
    };

    const cycle = async () => {
      chips.forEach((c) => {
        c.classList.add("is-pending");
        c.classList.remove("is-target", "is-in");
      });
      ghost.classList.remove("is-on", "is-lift");
      setPill(saved, "teal", "Sauvegardé");
      // Le curseur part du bas du panneau, sans trajet
      place(cursor, at(items[items.length - 1], 0.5, 2.2), 0);
      cursor.classList.add("is-on");
      await wait(800);

      for (let i = 0; i < chips.length; i++) {
        // 1. Le curseur va sur la ligne du champ
        place(cursor, at(items[i], 0.35, 0.55), 600);
        await wait(600);
        items[i].classList.add("is-hover");
        await wait(200);

        // 2. Il l'attrape : l'étiquette apparaît sous la pointe, un
        // emplacement s'ouvre dans le texte
        cursor.classList.add("is-down");
        ghost.textContent = chips[i].textContent;
        const grab = at(items[i], 0.35, 0.55);
        place(ghost, { x: grab.x - 6, y: grab.y - 5 }, 0);
        ghost.classList.add("is-lift");
        void ghost.offsetWidth;
        ghost.classList.add("is-on");
        chips[i].classList.remove("is-pending");
        chips[i].classList.add("is-target");
        await wait(150);

        // 3. Glissé jusqu'à l'emplacement
        const drop = at(chips[i], 0, 0);
        place(ghost, drop, 750);
        ghost.classList.remove("is-lift"); // se redresse en chemin
        place(cursor, { x: drop.x + 6, y: drop.y + 5 }, 750);
        await wait(780);

        // 4. Lâcher : le chip se pose
        cursor.classList.remove("is-down");
        items[i].classList.remove("is-hover");
        ghost.classList.remove("is-on");
        chips[i].classList.remove("is-target");
        void chips[i].offsetWidth; // rejoue le ressort d'insertion
        chips[i].classList.add("is-in");
        // Sauvegarde automatique groupée : « Enregistrement… » dès la
        // première insertion, un seul « Sauvegardé » après la dernière.
        if (i === 0) setPill(saved, "orange", "Enregistrement…");
        await wait(350);
      }
      await wait(200);
      setPill(saved, "teal", "Sauvegardé");
      // Le curseur s'écarte pour laisser lire le résultat
      place(cursor, at(items[items.length - 1], 0.5, 2.2), 800);
      await wait(hold);
    };

    return { win, cycle, finalState };
  }

  // ---------- Mockup 2 : éditeur, validation par l'avocat ----------
  function mockEditor(root, { hold = 3400 } = {}) {
    const win = $('[data-mock="editor"]', root);
    if (!win) return null;
    const btn = $("[data-ed-btn]", win);
    const saved = $("[data-ed-saved]", win);

    const finalState = () => {
      win.classList.add("is-flagged", "is-amended");
      btn.classList.add("is-sent");
      btn.textContent = "Validé par l'avocat ✓";
    };

    const cycle = async () => {
      // L'ajout de l'avocat (.is-amended) allonge le paragraphe 2.2 : la
      // fenêtre suit en douceur, à l'apparition comme au retrait.
      smoothHeight(win, () => win.classList.remove("is-flagged", "is-amended"));
      btn.classList.remove("is-sent", "is-pressed");
      btn.textContent = "Soumettre à l'avocat";
      setPill(saved, "teal", "Sauvegardé");
      // « Lyon 6e » est déjà écrit : l'avocat le relève, le surlignage
      // violet le balaie (css : .hp-field--lawyer), comme dans le hero.
      await wait(1200);
      win.classList.add("is-flagged");
      await wait(1600);
      btn.classList.add("is-pressed");
      await wait(160);
      btn.classList.remove("is-pressed");
      btn.classList.add("is-sent");
      btn.textContent = "Envoyé à l'avocat ✓";
      await wait(1300);
      smoothHeight(win, () => {
        win.classList.add("is-amended");
        btn.textContent = "Validé par l'avocat ✓";
      });
      await wait(hold);
    };

    return { win, cycle, finalState };
  }

  // ---------- Espace avocat (hors homepage) ----------
  // Accueil de l'espace avocat, gardé pour une future page dédiée : son HTML
  // est dans partials/avocat-accueil.html. Sans effet tant qu'aucune page ne
  // l'inclut.
  function mockLawyer(root, { hold = 3400 } = {}) {
    const win = $('[data-mock="lawyer"]', root);
    if (!win) return null;
    const status = $("[data-lw-status]", win);
    const pending = $("[data-lw-pending]", win);
    const done = $("[data-lw-done]", win);

    const finalState = () => {
      win.classList.add("is-validated");
      setPill(status, "green", "Validé");
      pending.textContent = "1";
      done.textContent = "4 / 5 traités";
      if (!reduced) pending.animate([{ transform: "scale(1.3)" }, { transform: "none" }], spring({ stiffness: 420, damping: 16 }));
    };

    const cycle = async () => {
      win.classList.remove("is-validated");
      setPill(status, "orange", "En attente");
      pending.textContent = "2";
      done.textContent = "3 / 5 traités";
      await wait(1400);
      setPill(status, "purple", "En relecture");
      await wait(1600);
      finalState();
      await wait(hold);
    };

    return { win, cycle, finalState };
  }

  // ---------- Mockup 3 : signature ----------
  // Signature manuscrite (sign-handwritten.json) recolorée à l'encre
  // (--color-black) et affinée : trait 18 → `width` (4,5 par défaut), point
  // final à l'échelle (7 pour 4,5) — unités du canevas 256 px. Utilisée par
  // la maquette Signer (trait plus gras, signature petite) et le player.
  const SIG_INK = [31 / 255, 18 / 255, 14 / 255, 1];
  function inkSignature(node, width = 4.5) {
    const dot = (7 / 4.5) * width;
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") {
        if ((n.ty === "st" || n.ty === "fl") && n.c) n.c.k = SIG_INK;
        if (n.ty === "st" && n.w?.k > 0) n.w.k = width;
        if (n.ty === "el") n.s.k = [dot, dot];
        Object.values(n).forEach(walk);
      }
    };
    walk(node);
    return node;
  }

  function mockSign(root, { hold = 3400 } = {}) {
    const win = $('[data-mock="sign"]', root);
    if (!win) return null;
    const title = $("[data-sg-title]", win);
    const status = $("[data-sg-status]", win);
    const from = $("[data-sg-from]", win);
    const fromNote = $("[data-sg-from-note]", win);
    const to = $("[data-sg-to]", win);
    const track = $(".hp-sign-track", win);
    const doc = $("[data-sg-doc]", win);
    const pen = $("[data-sg-lottie]", win);

    // Position de référence du document : début de la piste. La piste suit
    // l'axe déclaré en CSS (--sign-axis : x sur desktop, y sur mobile).
    const isHorizontal = () => getComputedStyle(track).getPropertyValue("--sign-axis").trim() !== "y";
    // Course du contrat : il part décalé dans la carte de départ (offset
    // négatif, --sign-overlap) et va aussi loin dans celle d'arrivée.
    const trackRoom = () =>
      isHorizontal()
        ? track.clientWidth - doc.offsetWidth - 2 * doc.offsetLeft
        : track.clientHeight - doc.offsetHeight - 2 * doc.offsetTop;

    // Partie qui agit (envoie, signe) : son fond se teinte légèrement.
    const acting = (party, on) => party.classList.toggle("is-acting", on);

    // Circuit du contrat, toujours droit (translation + échelle, jamais de
    // rotation) :
    // - aller : il émerge de derrière la carte de l'expéditeur (depuis son
    //   centre, réduit et transparent), glisse sur la piste et se pose sur
    //   la carte du destinataire, où il reste visible pour la signature ;
    // - retour : il revient et plonge derrière la carte de l'expéditeur, qui
    //   l'absorbe.
    // Un seul geste par trajet : offsets proportionnels aux distances, une
    // courbe pour tout le trajet, vitesse continue. La carte de l'expéditeur
    // passe au-dessus du contrat (css/mockups.css), d'où l'effet « derrière ».
    // La partie qui envoie est « en action » pendant le trajet.
    const TRIP_MS = 1500;
    const tf = ([x, y], scale = 1) => `translate(${x}px, ${y}px) scale(${scale})`;
    const legs = () => {
      const horizontal = isHorizontal();
      const room = trackRoom();
      // Centre du contrat sans transformation (début de piste)
      const t = track.getBoundingClientRect();
      const cx = t.left + doc.offsetLeft + doc.offsetWidth / 2;
      const cy = t.top + doc.offsetTop + doc.offsetHeight / 2;
      const f = from.getBoundingClientRect();
      return {
        inside: [f.left + f.width / 2 - cx, f.top + f.height / 2 - cy],
        start: [0, 0],
        end: horizontal ? [room, 0] : [0, room],
      };
    };
    const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
    const trip = async (source) => {
      const { inside, start, end } = legs();
      const out = source === from;
      const k = out ? dist(inside, start) / (dist(inside, start) + dist(start, end)) : dist(end, start) / (dist(end, start) + dist(start, inside));
      const keyframes = out
        ? [
            { transform: tf(inside, 0.6), opacity: 0, offset: 0 },
            { transform: tf(start), opacity: 1, offset: k },
            { transform: tf(end), opacity: 1, offset: 1 },
          ]
        : [
            { transform: tf(end), opacity: 1, offset: 0 },
            { transform: tf(start), opacity: 1, offset: k },
            { transform: tf(inside, 0.6), opacity: 0, offset: 1 },
          ];
      acting(source, true);
      win.classList.add("is-sending");
      // Au retour, le contrat passe par-dessus la carte de l'expéditeur
      // (css/mockups.css : .is-returning)
      win.classList.toggle("is-returning", !out);
      doc.getAnimations().forEach((anim) => anim.cancel());
      const anim = doc.animate(keyframes, { duration: TRIP_MS, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "forwards" });
      // Au retour, l'expéditeur se teinte dès que le contrat arrive sur sa
      // carte (vers la mi-trajet), pas seulement une fois absorbé.
      const receiving = out ? 0 : setTimeout(() => acting(from, true), TRIP_MS * 0.5);
      await anim.finished;
      clearTimeout(receiving);
      // Position figée à l'arrivée : posé chez le destinataire, ou absorbé
      doc.style.transform = out ? tf(end) : tf(inside, 0.6);
      doc.style.opacity = out ? "1" : "0";
      anim.cancel();
      win.classList.remove("is-sending");
      acting(source, false);
    };

    const reset = () => {
      doc.getAnimations().forEach((a) => a.cancel());
      // Rangé dans la carte de l'expéditeur, d'où il émergera
      doc.style.transform = "";
      doc.style.opacity = "0";
      win.classList.remove("is-signing", "is-signed", "is-archived", "is-returning");
      acting(from, false);
      acting(to, false);
      title.textContent = "Prêt à envoyer";
      setPill(status, "orange", "En attente");
      fromNote.textContent = "Franchiseur · a signé";
      fromNote.classList.remove("is-done");
    };

    const signed = () => {
      win.classList.remove("is-signing");
      win.classList.add("is-signed");
      setPill(status, "green", "Signé");
      title.textContent = "Contrat signé";
    };

    // L'expéditeur reçoit le contrat signé : sa carte se teinte à son tour,
    // jusqu'au cycle suivant.
    const archived = () => {
      win.classList.add("is-archived");
      acting(from, true);
      fromNote.textContent = "Contrat signé reçu";
      fromNote.classList.add("is-done");
    };

    // Sans animation (reduced-motion) : contrat signé, posé chez le
    // destinataire.
    const finalState = () => {
      signed();
      archived();
      doc.style.opacity = "1";
      doc.style.transform = tf(legs().end);
    };

    reset();
    const cycle = async () => {
      reset();
      await wait(900);

      // 1. Le contrat émerge de l'expéditeur et se pose chez le destinataire
      title.textContent = "Envoi à Crêperie Pivolane…";
      await trip(from);

      // 2. Signature manuscrite, écrite directement sur le contrat.
      // sign-handwritten.json (~2 s) écrit la signature puis la tient : joué
      // une fois, il reste sur sa dernière frame jusqu'au prochain cycle.
      title.textContent = "Signature en cours…";
      setPill(status, "blue", "Signature…");
      leoAnims.play(pen, "sign-handwritten.json", { loop: false, transform: (data) => inkSignature(data, 6.5) });
      win.classList.add("is-signing");
      acting(to, true);
      await wait(2300);
      signed();
      await wait(600);

      // 3. Il revient, signé (sceau), et l'expéditeur l'absorbe
      await trip(to);
      archived();
      await wait(hold);
    };

    return { win, cycle, finalState };
  }


  // ---------- Mockup 4 : kanban ----------
  function mockKanban(root) {
    const win = $('[data-mock="kanban"]', root);
    if (!win) return null;
    const board = $(".hp-kb", win);
    const cols = $$("[data-kb-col]", win);
    const cards = $$(".hp-kb-card", win);
    const card = $("[data-kb-mover]", win);
    const date = $("[data-kb-date]", win);
    const labels = ["Créé le 28/08", "Envoyé à l'avocat", "Envoyé à signer", "Signé à l'instant"];

    // Déplacements des cartes et de la hauteur du tableau : courbe classique
    // (ease-in-out), sans ressort ni rebond. Le ressort ne reste que sur le
    // « pop » des compteurs.
    const layout = { duration: 550, easing: "cubic-bezier(0.65, 0, 0.35, 1)" };
    const lift = layout;
    const pop = spring({ stiffness: 420, damping: 16 });

    const refreshCounts = () => {
      cols.forEach((col) => {
        const n = $(".hp-kb-n", col);
        const next = String($$(".hp-kb-card", col).length);
        if (n.textContent === next) return;
        n.textContent = next;
        if (!reduced) n.animate([{ transform: "scale(1.5)", color: "var(--color-teal)" }, { transform: "none" }], pop);
      });
    };

    // FLIP façon « layout » de Framer Motion : on mesure tout, on modifie le
    // DOM, puis chaque carte qui a bougé glisse de son ancienne place à la
    // nouvelle, et la hauteur du tableau suit.
    const relayout = (mutate, { mover = null } = {}) => {
      const before = new Map(cards.map((el) => [el, el.getBoundingClientRect()]));
      const fromHeight = board.getBoundingClientRect().height;
      mutate();
      if (reduced) return Promise.resolve();

      const toHeight = board.getBoundingClientRect().height;
      if (Math.abs(toHeight - fromHeight) > 0.5) {
        board.animate([{ height: fromHeight + "px" }, { height: toHeight + "px" }], layout);
      }

      const moves = cards.map((el) => {
        const a = before.get(el);
        const b = el.getBoundingClientRect();
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
        const from = { transform: `translate(${dx}px, ${dy}px)` };
        if (el !== mover) return el.animate([from, { transform: "none" }], layout).finished;
        // La carte déplacée : même trajet (courbe classique), plus une
        // inclinaison / mise à l'échelle qui s'ajoute par-dessus (composite)
        // et se relâche un peu après, comme une carte qu'on pose. L'ordre
        // compte : l'animation « add » doit être créée après celle qu'elle
        // complète, sinon cette dernière la remplace.
        const trip = el.animate([from, { transform: "none" }], lift);
        // Soulèvement progressif : part de l'état normal, culmine vers 40 %
        // du trajet, puis se repose (pas de saut au départ).
        el.animate(
          [
            { transform: "rotate(0) scale(1)" },
            { transform: "rotate(-3deg) scale(1.05)", offset: 0.4 },
            { transform: "rotate(0) scale(1)" },
          ],
          { ...lift, duration: lift.duration + 150, composite: "add" }
        );
        return trip.finished;
      });
      return Promise.all(moves.filter(Boolean));
    };

    const setDate = (text) => {
      date.textContent = text;
      if (!reduced) date.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], layout);
    };

    const moveTo = async (i) => {
      card.classList.add("is-lifted");
      await relayout(
        () => {
          cols[i].insertBefore(card, $(".hp-kb-card", cols[i]));
          refreshCounts();
        },
        { mover: card }
      );
      setDate(labels[i]);
      card.classList.remove("is-lifted");
    };

    const finalState = () => {};

    const cycle = async () => {
      await wait(1200);
      for (let i = 1; i < cols.length; i++) {
        await moveTo(i);
        await wait(1300);
      }
      await wait(1400);
      // Sortie puis retour en tête de la 1re colonne : la carte s'efface en
      // se rétractant, les voisines se replacent, elle réapparaît en ressort.
      const out = card.animate(
        [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.92)" }],
        { duration: 260, easing: "ease-in", fill: "forwards" }
      );
      await out.finished;
      await relayout(() => {
        cols[0].insertBefore(card, $(".hp-kb-card", cols[0]));
        date.textContent = labels[0];
        refreshCounts();
      });
      const back = card.animate([{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }], pop);
      out.cancel(); // pas d'animation « forwards » qui s'empile à chaque tour
      await back.finished;
    };

    return { win, cycle, finalState };
  }


  // ---------- Mockup : du modèle validé au contrat ----------
  // Le vrai parcours de legaleo-ai : sur Modèles, le modèle de franchise
  // validé est choisi ; le paramétrage s'ouvre (franchisé choisi dans la
  // liste, puis dates et modalités) et le contrat se génère ; l'éditeur
  // s'ouvre sur le contrat rempli, les commentaires arrivent.
  function mockCreate(root, { hold = 3400 } = {}) {
    const flow = $('[data-mock="create"]', root);
    if (!flow) return null;
    const row = $("[data-md-row]", flow);
    const form = $(".hp-fl-form", flow);
    const select = $("[data-fl-select]", flow);
    const selectV = $("[data-fl-select-v]", flow);
    const pick = $("[data-fl-pick]", flow);
    const duree = $("[data-fl-duree]", flow);
    const next = $("[data-fl-next]", flow);
    const stepWho = $('[data-fl-step="who"]', flow);
    const stepDates = $('[data-fl-step="dates"]', flow);
    const cursor = $("[data-fl-cursor]", flow);
    const PLACEHOLDER = selectV.textContent;

    const press = async (el) => {
      el.classList.add("is-pressed");
      await wait(160);
      el.classList.remove("is-pressed");
    };
    // Curseur : pointe posée à (fx, fy) de la boîte de `el`, coordonnées
    // relatives au parcours (même curseur que l'onboarding).
    const moveTo = async (el, fx = 0.5, fy = 0.6, t = 600) => {
      const f = flow.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      cursor.style.setProperty("--t", t + "ms");
      cursor.style.setProperty("--x", r.left - f.left + r.width * fx + "px");
      cursor.style.setProperty("--y", r.top - f.top + r.height * fy + "px");
      await wait(t);
    };
    const click = async (el) => {
      cursor.classList.add("is-down");
      await press(el);
      cursor.classList.remove("is-down");
    };
    const step = (who) => {
      stepWho.className = `hp-onb-step ${who ? "is-current" : "is-done"}`;
      stepDates.className = `hp-onb-step${who ? "" : " is-current"}`;
    };

    const finalState = () => {
      flow.classList.add("is-editor", "is-comments");
      cursor.classList.remove("is-on");
    };

    const cycle = async () => {
      flow.classList.remove("is-setup", "is-editor", "is-comments");
      row.classList.remove("is-hover");
      form.classList.remove("is-dates", "is-gen");
      select.classList.remove("is-open", "is-filled");
      selectV.textContent = PLACEHOLDER;
      pick.classList.remove("is-hover", "is-selected");
      duree.textContent = "";
      next.textContent = "Suivant";
      step(true);
      // Curseur : repart du coin bas droit, sans trajet
      cursor.style.setProperty("--t", "0ms");
      cursor.style.setProperty("--x", "88%");
      cursor.style.setProperty("--y", "92%");
      cursor.classList.add("is-on");
      await wait(700);

      // 1. Modèles : le modèle de franchise validé
      await moveTo(row, 0.42, 0.55, 750);
      row.classList.add("is-hover");
      await wait(300);
      await click(row);
      flow.classList.add("is-setup");
      await wait(900);

      // 2a. Co-contractant : choisi dans la liste
      await moveTo(select, 0.7, 0.6, 650);
      await click(select);
      select.classList.add("is-open");
      await wait(350);
      await moveTo(pick, 0.4, 0.6, 450);
      pick.classList.add("is-hover");
      await wait(250);
      cursor.classList.add("is-down");
      await wait(150);
      cursor.classList.remove("is-down");
      pick.classList.replace("is-hover", "is-selected");
      selectV.textContent = pick.textContent;
      select.classList.remove("is-open");
      select.classList.add("is-filled");
      await wait(400);
      await moveTo(next, 0.5, 0.6, 650);
      await click(next);

      // 2b. Dates et modalités, puis génération
      form.classList.add("is-dates");
      step(false);
      next.textContent = "Générer le contrat";
      await wait(300);
      await moveTo(duree, 0.3, 0.6, 600);
      await click(duree);
      duree.classList.add("is-typing");
      // Deux chiffres seulement : frappe lente, précédée d'une courte
      // hésitation, pour qu'on la voie
      await wait(350);
      await typeInto(duree, duree.dataset.v, 380);
      duree.classList.remove("is-typing");
      await wait(250);
      await moveTo(next, 0.5, 0.6, 600);
      await click(next);
      cursor.classList.remove("is-on");
      form.classList.add("is-gen");
      await wait(1700);

      // 3. Éditeur : contrat rempli, puis les commentaires
      flow.classList.replace("is-setup", "is-editor");
      await wait(1500);
      flow.classList.add("is-comments");
      await wait(hold);
    };

    return { win: flow, cycle, finalState };
  }

  // ---------- Mockup 5 : contrathèque, import de contrats existants ----------
  // « Importer des contrats » ouvre la modale ; trois fichiers glissés depuis
  // le bureau tombent dans la zone de dépôt ; « Importer » : le widget Leo
  // classe les contrats, chaque ligne apparaît « en cours » dans la table
  // (étapes de l'analyse, comme PENDING_STEP_LABELS de la Contrathèque), puis
  // se finalise ; l'alerte de renouvellement tombe.
  function mockLibrary(root, { hold = 3600 } = {}) {
    const win = $('[data-mock="library"]', root);
    if (!win) return null;
    const visual = win.parentElement;
    const importBtn = $("[data-lib-import]", win);
    const drop = $("[data-lib-drop]", win);
    const go = $("[data-lib-go]", win);
    const leo = $("[data-lib-leo]", win);
    const classified = $("[data-lib-classified]", win);
    const rows = $$("[data-lib-new]", win);
    const okCount = $("[data-lib-ok]", win);
    const renewCount = $("[data-lib-renew]", win);
    const drag = $("[data-lib-drag]", visual);
    const alert = $("[data-lib-alert]", visual);
    const STEPS = [
      ["Conversion du document…", 15],
      ["Recherche des données…", 45],
      ["Identification des champs dynamiques…", 75],
      ["Indexation du contrat…", 95],
    ];
    // Compteurs d'en-tête selon le nombre de lignes finalisées (Lyon 6 et
    // Nantes à renouveler, Lille actif ; Bordeaux, actif, déjà là)
    const OK = [1, 1, 1, 2];
    const RENEW = [0, 1, 2, 2];
    const counts = (done) => {
      okCount.textContent = OK[done] > 1 ? `${OK[done]} actifs` : `${OK[done]} actif`;
      renewCount.textContent = RENEW[done];
    };

    const press = async (el) => {
      el.classList.add("is-pressed");
      await wait(160);
      el.classList.remove("is-pressed");
    };
    // Position de la pile de fichiers, relative au visuel
    const place = (x, y, t = 1000) => {
      drag.style.setProperty("--x", x + "px");
      drag.style.setProperty("--y", y + "px");
      drag.style.transitionDuration = `${t}ms, 0.3s, 0.3s`;
    };

    const finalState = () => {
      rows.forEach((r) => r.classList.add("is-in", "is-done"));
      counts(rows.length);
      alert.classList.add("is-shown");
    };

    const cycle = async () => {
      win.classList.remove("is-modal");
      drop.classList.remove("is-over", "has-files");
      leo.classList.remove("is-shown");
      alert.classList.remove("is-shown");
      rows.forEach((r) => {
        r.classList.remove("is-in", "is-done");
        $(".hp-tr-bar i", r).style.setProperty("--p", "5%");
        $("[data-lib-step]", r).textContent = STEPS[0][0];
      });
      classified.textContent = "0";
      counts(0);
      drag.classList.remove("is-on", "is-dropped");
      await wait(900);

      // 1. Ouverture de la modale
      await press(importBtn);
      win.classList.add("is-modal");
      await wait(600);

      // 2. Les fichiers arrivent du bureau (bord droit) et survolent la zone
      // de dépôt. Mesures prises à l'instant : la page peut encore défiler.
      let v = visual.getBoundingClientRect();
      place(v.width - 20, v.height * 0.6, 0);
      void drag.offsetWidth;
      drag.classList.add("is-on");
      await wait(150);
      v = visual.getBoundingClientRect();
      const d = drop.getBoundingClientRect();
      place(d.left - v.left + d.width / 2 - 20, d.top - v.top + d.height / 2 - 26, 1100);
      await wait(800);
      drop.classList.add("is-over");
      await wait(500);

      // 3. Dépôt : les lignes de fichiers apparaissent
      drag.classList.add("is-dropped");
      drop.classList.remove("is-over");
      drop.classList.add("has-files");
      await wait(1000);

      // 4. Import : la modale se ferme, Leo classe les contrats
      await press(go);
      win.classList.remove("is-modal");
      drag.classList.remove("is-on", "is-dropped");
      await wait(300);
      leo.classList.add("is-shown");
      for (let i = 0; i < rows.length; i++) {
        await wait(600);
        classified.textContent = String(i + 1);
        rows[i].classList.add("is-in");
      }
      await wait(400);
      leo.classList.remove("is-shown");

      // 5. Analyse approfondie : les étapes défilent dans chaque ligne en
      // cours, décalées d'une ligne à l'autre, puis la ligne se finalise
      for (let step = 1; step < STEPS.length + rows.length; step++) {
        rows.forEach((r, i) => {
          const k = step - i;
          if (k < 1) return;
          if (k < STEPS.length) {
            $("[data-lib-step]", r).textContent = STEPS[k][0];
            $(".hp-tr-bar i", r).style.setProperty("--p", STEPS[k][1] + "%");
          } else if (!r.classList.contains("is-done")) {
            r.classList.add("is-done");
          }
        });
        counts(rows.filter((r) => r.classList.contains("is-done")).length);
        await wait(550);
      }
      await wait(700);
      alert.classList.add("is-shown");
      await wait(hold);
    };

    return { win, cycle, finalState };
  }

  // Chaque mockup est une fabrique : `mockX(root)` trouve sa fenêtre dans
  // `root` et renvoie { win, cycle, finalState } — `cycle` joue une fois
  // l'animation complète (remise à zéro comprise), `finalState` pose l'état
  // final sans animation. La section « La plateforme » les fait tourner en
  // boucle ; le player du hero les enchaîne (initHeroPlayer).
  const MOCKS = {
    onboard: mockOnboard,
    generate: mockGenerate,
    editor: mockEditor,
    lawyer: mockLawyer,
    create: mockCreate,
    sign: mockSign,
    kanban: mockKanban,
    library: mockLibrary,
  };

  // ---------- Hero : player, aperçu de la plateforme ----------
  // Une scène « motion design » par chapitre de « La plateforme » (même ordre),
  // centrée sur une seule fonctionnalité. Chaque scène est une chronologie :
  // [délai en ms, action] — un nombre pose la classe .is-sN sur la scène (le
  // mouvement est en CSS, css/player.css), une fonction joue une action
  // (taper un texte, déplacer une carte…). `reset` / `final` remettent à
  // zéro ou posent l'état final ce que les classes ne couvrent pas.
  // Hauteur d'une carte de scène qui grandit avec son contenu (texte tapé,
  // chip inséré), animée par la transition CSS (.hp-sc-card : height).
  // Hauteur du contenu lue par scrollHeight (la carte est en overflow:
  // hidden), sans repasser par height: auto ; la transition n'est relancée
  // que si la cible change vraiment (passage à la ligne) : appelée à chaque
  // caractère, elle repartirait sinon de zéro en continu et la carte
  // traînerait derrière le texte. Remise à zéro : resetHeight.
  function fitHeight(card) {
    const border = card.offsetHeight - card.clientHeight;
    const to = card.scrollHeight + border;
    if (card.fitTo === to) return;
    if (!card.style.height) {
      card.style.height = card.offsetHeight + "px";
      void card.offsetHeight; // point de départ de la transition
    }
    card.fitTo = to;
    card.style.height = to + "px";
  }
  function resetHeight(card) {
    card.style.height = "";
    card.fitTo = undefined;
  }

  // Position d'un élément dans un ancêtre positionné (ex. la caméra d'une
  // scène), en px du canevas : offsets, donc indépendants de la réduction
  // --fit et du zoom de la caméra.
  function posIn(node, ancestor) {
    let x = 0;
    let y = 0;
    for (let n = node; n && n !== ancestor; n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    return { x, y };
  }

  const PLAYER_SCENES = {
    onboard(el) {
      const cursor = $(".hp-sc-cursor", el);
      const cam = $(".hp-sc-cam", el);
      const type = $("[data-onb-type]", el);
      const click = async () => {
        cursor.classList.add("is-down");
        await wait(180);
        cursor.classList.remove("is-down");
      };
      const posInCam = (node) => posIn(node, cam);
      // « Type de réseau » : le pointeur va sur « Franchise » (position
      // inline, prioritaire sur les classes .is-sN le temps du geste) et
      // clique ; il est ensuite rendu aux classes (.is-s5 : il sort du cadre).
      const toType = async () => {
        const p = posInCam(type);
        cursor.style.translate = `${p.x + type.offsetWidth * 0.55}px ${p.y + type.offsetHeight * 0.6}px`;
        await wait(650);
      };
      const pickType = async () => {
        await click();
        type.classList.add("is-picked");
        await wait(300);
        cursor.style.translate = "";
      };
      // Secteur choisi (4) → type de réseau cliqué → profil du réseau (5)
      return {
        steps: [[50, 1], [500, 2], [750, click], [0, 3], [900, click], [0, 4], [250, toType], [0, pickType], [0, 5], [1300, 6]],
        hold: 1800,
        reset() {
          cursor.style.translate = "";
          type.classList.remove("is-picked");
        },
        final() {
          type.classList.add("is-picked");
        },
      };
    },
    editor(el) {
      const rows = $$(".hp-sc-gen-row", el);
      const chips = $$(".hp-sc-var", el);
      const para = $(".hp-sc-paper-p", el);
      const paper = $(".hp-sc-paper", el);
      const cam = $(".hp-sc-cam", el);
      const drag = $(".hp-sc-dragchip", el);
      const cursor = $(".hp-sc-gen-cursor", el);
      // Le paragraphe s'écrit comme au clavier. Il est découpé une fois en
      // segments : texte à taper, ou chip (champ dynamique). Arrivé à un
      // chip, le curseur attrape la ligne correspondante du panneau et la
      // glisse jusqu'au curseur de frappe ; le chip s'insère au lâcher, puis
      // la frappe reprend.
      const segments = Array.from(para.childNodes).map((node) =>
        node.nodeType === Node.TEXT_NODE ? node.textContent : chips.indexOf(node)
      );
      const caret = document.createElement("span");
      caret.className = "hp-sc-tcaret";
      // Jeton de frappe : une remise à zéro (changement de chapitre) arrête
      // la frappe en cours.
      let run = 0;

      const clear = () => {
        run++;
        para.replaceChildren();
        resetHeight(paper);
        chips.forEach((c) => c.classList.remove("is-in"));
        rows.forEach((r) => r.classList.remove("is-on", "is-press"));
        drag.classList.remove("is-on");
        cursor.classList.remove("is-on", "is-down");
        cursor.style.translate = "";
      };
      // Position (px, dans la caméra) d'un point de `node`
      const pt = (node, fx, fy) => {
        const p = posIn(node, cam);
        return `${p.x + node.offsetWidth * fx}px ${p.y + node.offsetHeight * fy}px`;
      };
      const write = async () => {
        const my = ++run;
        const alive = () => my === run;
        para.replaceChildren(caret);
        for (const seg of segments) {
          if (typeof seg === "string") {
            const text = document.createTextNode("");
            para.insertBefore(text, caret);
            for (const ch of seg) {
              if (!alive()) return;
              text.data += ch;
              fitHeight(paper);
              await wait(5.6 + Math.random() * 7.2); // ~2,5× plus vite que 14–32 ms
            }
          } else {
            // Glisser-déposer : le curseur va sur la ligne et l'attrape,
            // l'étiquette du champ le suit jusqu'au curseur de frappe, le
            // chip s'insère au lâcher
            const row = rows[seg];
            cursor.classList.add("is-on");
            cursor.style.translate = pt(row, 0.3, 0.6);
            await wait(650);
            if (!alive()) return;
            row.classList.add("is-on", "is-press");
            cursor.classList.add("is-down");
            drag.textContent = chips[seg].textContent;
            drag.style.transition = "none";
            drag.classList.add("is-lift");
            drag.style.translate = pt(row, 0.3, 0.6).replace(/(-?[\d.]+)px (-?[\d.]+)px/, (m, x, y) => `${x - 10}px ${y - 8}px`);
            void drag.offsetWidth;
            drag.style.transition = "";
            drag.classList.add("is-on");
            await wait(180);
            if (!alive()) return;
            row.classList.remove("is-press");
            drag.style.translate = pt(caret, 0, 0);
            drag.classList.remove("is-lift"); // se redresse en chemin
            cursor.style.translate = pt(caret, 0, 0).replace(/(-?[\d.]+)px (-?[\d.]+)px/, (m, x, y) => `${+x + 10}px ${+y + 8}px`);
            await wait(700);
            if (!alive()) return;
            cursor.classList.remove("is-down");
            drag.classList.remove("is-on");
            row.classList.remove("is-on");
            para.insertBefore(chips[seg], caret);
            chips[seg].classList.add("is-in");
            fitHeight(paper);
            await wait(250);
          }
        }
        if (alive()) {
          caret.remove();
          cursor.classList.remove("is-on");
        }
      };
      clear();

      return {
        steps: [[50, 1], [500, 2], [300, write], [600, 6]],
        hold: 1800,
        reset: clear,
        final() {
          run++;
          resetHeight(paper);
          para.replaceChildren(
            ...segments.map((seg) => (typeof seg === "string" ? document.createTextNode(seg) : chips[seg]))
          );
          chips.forEach((c) => c.classList.add("is-in"));
          drag.classList.remove("is-on");
          cursor.classList.remove("is-on", "is-down");
        },
      };
    },
    lawyer(el) {
      // L'ajout de l'avocat s'écrit comme au clavier (même rythme et même
      // curseur que la scène Générez), dans son surlignage vert.
      const ins = $(".hp-sc-ins", el);
      const clause = $(".hp-sc-clause", el);
      const cam = $(".hp-sc-cam", el);
      const mark = $(".hp-sc-mark", el);
      const comment = $(".hp-sc-comment", el);
      const text = ins.textContent;
      // Le commentaire jaillit du passage surligné : son point de départ
      // (--fx, --fy, css/player.css) est le centre du surlignage, relatif
      // au coin du commentaire. Recalculé à chaque remise à zéro (faite
      // sans transition).
      const anchorComment = () => {
        const m = posIn(mark, cam);
        const c = posIn(comment, cam);
        comment.style.setProperty("--fx", m.x + mark.offsetWidth / 2 - c.x + "px");
        comment.style.setProperty("--fy", m.y + mark.offsetHeight / 2 - c.y + "px");
      };
      const caret = document.createElement("span");
      caret.className = "hp-sc-tcaret";
      let run = 0;
      const write = async () => {
        const my = ++run;
        const node = document.createTextNode("");
        ins.replaceChildren(node, caret);
        for (const ch of text) {
          if (my !== run) return;
          node.data += ch;
          fitHeight(clause);
          await wait(5.6 + Math.random() * 7.2);
        }
        await wait(250);
        if (my === run) caret.remove();
      };
      const clear = () => {
        run++;
        ins.replaceChildren();
        resetHeight(clause);
        anchorComment();
      };
      clear();
      return {
        // Commentaire (3), puis 2,2 s pour le lire avant l'ajout (4)
        steps: [[50, 1], [600, 2], [900, 3], [2200, 4], [0, write], [500, 5]],
        hold: 2000,
        reset: clear,
        final() {
          run++;
          ins.textContent = text;
          resetHeight(clause);
        },
      };
    },
    sign(el) {
      // Un seul contrat : les signataires apparaissent (1), le contrat émane
      // du franchiseur et se pose au centre (2). Il passe au premier plan :
      // le franchiseur signe et passe à « Signé », puis le franchisé signe à
      // son tour ; le contrat se repose. Puis dédoublement — chaque
      // exemplaire se pose au-dessus de sa partie (3) — et accord (4).
      const doc = $("[data-sig-doc]", el);
      const parts = ["a", "b"].map((k) => ({
        slot: $(`[data-sig-slot="${k}"]`, doc),
        signer: $(`[data-sig-signer="${k}"]`, el),
      }));
      let run = 0;
      let copy = null;
      // Tracé de chaque signature (SVG Illustrator, un path par geste, dans
      // l'ordre d'écriture) : vitesse constante sur toute la signature, petit
      // lever de stylo entre deux traits. Durée et délai de chaque trait
      // posés une fois pour toutes ; .is-signing lance le tracé (CSS).
      const SIG_MS = 1300;
      const SIG_LIFT_MS = 70;
      $$("[data-sig-draw]", doc).forEach((svg) => {
        const paths = $$("path", svg);
        const lens = paths.map((path) => path.getTotalLength());
        const total = lens.reduce((sum, len) => sum + len, 0);
        const ink = SIG_MS - SIG_LIFT_MS * (paths.length - 1);
        let at = 0;
        paths.forEach((path, i) => {
          const dur = (lens[i] / total) * ink;
          path.style.setProperty("--len", lens[i]);
          path.style.transition = `stroke-dashoffset ${dur}ms cubic-bezier(0.45, 0.05, 0.55, 0.95) ${at}ms, opacity 0s ${at}ms`;
          at += dur + SIG_LIFT_MS;
        });
      });
      // Signature asynchrone : le franchiseur signe, puis, après une
      // attente, le franchisé signe à son tour.
      const SIG_GAP_MS = 0;
      const signAll = async () => {
        const my = run;
        doc.classList.add("is-focus");
        await wait(150);
        for (const [i, { slot, signer }] of parts.entries()) {
          if (i > 0) await wait(SIG_GAP_MS);
          if (my !== run) return;
          slot.classList.add("is-signing");
          await wait(SIG_MS + 60);
          if (my !== run) return;
          slot.classList.replace("is-signing", "is-signed");
          signer.classList.add("is-signed");
        }
        await wait(120);
        doc.classList.remove("is-focus");
        await wait(250);
      };
      // Exemplaire de la seconde partie : copie du contrat signé, qui naît
      // sous lui (.is-new) puis s'en détache en fondu (css/player.css).
      const duplicate = () => {
        copy = doc.cloneNode(true);
        copy.removeAttribute("data-sig-doc");
        copy.classList.add("hp-sc-doc--copy", "is-new");
        doc.after(copy);
        void copy.offsetWidth; // point de départ de la transition
        copy.classList.remove("is-new");
      };
      return {
        steps: [[50, 1], [400, 2], [600, signAll], [300, duplicate], [650, 3], [800, 4]],
        hold: 2000,
        reset() {
          run++;
          copy?.remove();
          copy = null;
          doc.classList.remove("is-focus");
          parts.forEach(({ slot, signer }) => {
            slot.classList.remove("is-signing", "is-signed");
            signer.classList.remove("is-signed");
          });
        },
        final() {
          run++;
          parts.forEach(({ slot, signer }) => {
            slot.classList.add("is-signed");
            signer.classList.add("is-signed");
          });
          if (!copy) duplicate();
        },
      };
    },
    kanban(el) {
      const cols = $$("[data-kb-col]", el);
      const cards = $$(".hp-sc-kb-card", el);
      // Contrats qui avancent, dans l'ordre : du plus avancé au moins avancé
      // (la colonne d'arrivée se libère avant d'être remplie)
      const movers = $$("[data-kb-move]", el).sort((a, b) => b.dataset.kbMove - a.dataset.kbMove);
      const LABELS = { 1: "Envoyé à l'avocat", 2: "Envoyé à signer", 3: "Signé à l'instant" };
      // Répartition et dates de départ, pour rejouer la scène
      const start = cols.map((col) => $$(".hp-sc-kb-card", col));
      const dates = new Map(cards.map((c) => [c, $(".hp-sc-kb-d", c).textContent]));
      // Déplacements : courbe classique (ease-in-out), sans ressort ni
      // rebond ; le ressort ne reste que sur le « pop » des compteurs.
      const layout = { duration: 550, easing: "cubic-bezier(0.65, 0, 0.35, 1)" };
      const lift = layout;
      const pop = spring({ stiffness: 420, damping: 16 });

      const counts = (animate) =>
        cols.forEach((col) => {
          const n = $(".hp-sc-kb-n", col);
          const next = String($$(".hp-sc-kb-card", col).length);
          if (n.textContent === next) return;
          n.textContent = next;
          if (animate) n.animate([{ transform: "scale(1.5)", color: "var(--color-teal)" }, { transform: "none" }], pop);
        });
      const place = (card) => {
        const col = cols[card.dataset.kbMove];
        $(".hp-sc-kb-h", col).after(card);
        $(".hp-sc-kb-d", card).textContent = LABELS[card.dataset.kbMove];
      };

      // FLIP : positions avant / après, puis chaque carte qui a bougé glisse
      // de l'ancienne à la nouvelle. Les rects sont en pixels écran : ramenés
      // à l'échelle de la scène (--fit, caméra). La carte déplacée reste
      // droite, avec un léger soulèvement par-dessus le trajet.
      const move = (card) => async () => {
        const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
        place(card);
        const scale = card.getBoundingClientRect().width / card.offsetWidth || 1;
        card.classList.add("is-moved");
        cards.forEach((c) => {
          const a = before.get(c);
          const b = c.getBoundingClientRect();
          const dx = (a.left - b.left) / scale;
          const dy = (a.top - b.top) / scale;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
          const from = { transform: `translate(${dx}px, ${dy}px)` };
          if (c !== card) return c.animate([from, { transform: "none" }], layout);
          c.animate([from, { transform: "none" }], lift);
          // Soulèvement progressif : part de l'état normal, culmine vers
          // 40 % du trajet, puis se repose (pas de saut au départ).
          c.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)", offset: 0.4 }, { transform: "scale(1)" }], {
            ...lift,
            duration: lift.duration + 150,
            composite: "add",
          });
        });
        counts(true);
        setTimeout(() => card.classList.remove("is-moved"), 1200);
      };

      return {
        steps: [[50, 1], [500, 2], [700, 3], [200, move(movers[0])], [1300, move(movers[1])], [1300, move(movers[2])]],
        hold: 2200,
        reset() {
          cards.forEach((c) => {
            c.getAnimations().forEach((anim) => anim.cancel());
            c.classList.remove("is-moved");
            $(".hp-sc-kb-d", c).textContent = dates.get(c);
          });
          cols.forEach((col, i) => start[i].forEach((c) => col.append(c)));
          counts(false);
        },
        final() {
          movers.forEach(place);
          counts(false);
        },
      };
    },
    create(el) {
      // Mouvement des cartes en CSS (.hp-sc--md) : ligne choisie (2),
      // document rempli (3), contrat prêt (4). Le curseur (JS) va sur la
      // ligne du modèle de franchise, clique, puis s'écarte.
      const cam = $(".hp-sc-cam", el);
      const row = $(".hp-sc-md-row--pick", el);
      const cursor = $(".hp-sc-md-cursor", el);
      const toRow = () => {
        const p = posIn(row, cam);
        cursor.classList.add("is-on");
        cursor.style.translate = `${p.x + row.offsetWidth * 0.42}px ${p.y + row.offsetHeight * 0.6}px`;
      };
      const click = async () => {
        cursor.classList.add("is-down");
        await wait(180);
        cursor.classList.remove("is-down");
      };
      const away = () => {
        cursor.style.translate = "";
        cursor.classList.remove("is-on");
      };
      return {
        steps: [[50, 1], [400, toRow], [750, 2], [350, click], [150, 3], [400, away], [1400, 4]],
        hold: 2400,
        reset: away,
        final: away,
      };
    },
    library() {
      // Tout le mouvement est en CSS (.hp-sc--lib) : glisser (2), déposer et
      // importer (3), finaliser + Leo (4), alerte (5).
      return {
        steps: [[50, 1], [500, 2], [1100, 3], [1900, 4], [1100, 5]],
        hold: 2400,
      };
    },
  };

  // Carton-titre (repris du chapitre de « La plateforme ») puis la scène, et
  // ainsi de suite en boucle. Les onglets sautent à un chapitre. Hors écran,
  // le player s'arrête à la prochaine étape et reprend une fois revu.
  // Reduced-motion : pas d'enchaînement, chaque scène dans son état final,
  // les onglets changent de chapitre.
  function initHeroPlayer() {
    const player = $("[data-player]");
    if (!player) return;
    const stage = $("[data-player-stage]", player);
    const viewport = $("[data-player-viewport]", player);
    const nav = $("[data-player-nav]", player);
    const corner = $("[data-player-corner]", player);
    // Changement de chapitre : le verbe en haut à gauche sort (0,45 s,
    // css/player.css) avant que le suivant n'entre.
    const CORNER_OUT_MS = 350;

    const features = $$("#plateforme .hp-feature");
    const chapters = $$("[data-scene]", viewport)
      .map((el, i) => {
        const feature = features[i];
        const make = PLAYER_SCENES[el.dataset.scene];
        if (!feature || !make) return null;
        const scene = { el, reset: null, final: null, ...make(el) };

        const n = $(".hp-step-n", feature).firstChild.textContent.trim();
        const verbEl = $(".hp-step-verb", feature);
        const verb = verbEl.textContent.trim();

        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "hp-player-tab";
        const tabN = document.createElement("span");
        tabN.className = "hp-player-tab-n";
        tabN.textContent = n;
        const bar = document.createElement("span");
        bar.className = "hp-player-tab-bar";
        // Onglet étroit : forme courte du verbe (data-short) si elle existe
        tab.append(tabN, verbEl.dataset.short || verb, bar);
        nav.appendChild(tab);

        // est : durée de la scène (estimée, puis mesurée) pour la barre de l'onglet
        const est = scene.steps.reduce((sum, [delay]) => sum + delay, scene.hold + 1500);
        return { scene, tab, n, verb, est };
      })
      .filter(Boolean);
    if (!chapters.length) return;
    player.classList.add("is-ready");

    // Canevas 880 × 440 réduit à la largeur disponible
    const fit = () => viewport.style.setProperty("--fit", Math.min(1, viewport.clientWidth / 880));
    fit();
    new ResizeObserver(fit).observe(viewport);

    // Remise à zéro instantanée (.is-resetting coupe les transitions) : sinon
    // les éléments repartent en transition depuis l'état final de la lecture
    // précédente pendant le fondu d'entrée, et la fin de la scène « flashe ».
    const resetScene = ({ el, reset }) => {
      el.classList.add("is-resetting");
      Array.from(el.classList)
        .filter((c) => /^is-s\d+$/.test(c))
        .forEach((c) => el.classList.remove(c));
      reset?.();
      void el.offsetWidth; // applique l'état initial avant de rétablir les transitions
      el.classList.remove("is-resetting");
    };
    const finalScene = ({ el, steps, final }) => {
      steps.forEach(([, action]) => typeof action === "number" && el.classList.add("is-s" + action));
      final?.();
    };
    const runScene = async ({ el, steps, hold }, alive) => {
      for (const [delay, action] of steps) {
        await wait(delay);
        if (!alive()) return;
        if (typeof action === "number") el.classList.add("is-s" + action);
        else await action();
      }
      await wait(hold);
    };

    // Verbe du chapitre en haut à gauche, dans un span : son cadre sert de
    // masque (css/player.css)
    const toCorner = (index) => {
      // Nouveau span : sa position de départ (translateY(100px)) doit être
      // calculée avant .is-corner, sinon il apparaît sans transition.
      player.classList.remove("is-corner");
      const word = document.createElement("span");
      word.textContent = chapters[index].verb;
      corner.replaceChildren(word);
      void corner.offsetWidth;
      player.classList.add("is-corner");
    };

    // Durée du fondu entre scènes (.hp-sc, css/player.css)
    const SCENE_FADE_MS = 450;
    const show = (index) => {
      chapters.forEach((c, i) => {
        const el = c.scene.el;
        // Scène qui sort : sa caméra continue pendant le fondu (.is-leaving)
        if (i !== index && el.classList.contains("is-active")) {
          el.classList.add("is-leaving");
          clearTimeout(el.leaveTimer);
          el.leaveTimer = setTimeout(() => el.classList.remove("is-leaving"), SCENE_FADE_MS);
        }
        if (i === index) el.classList.remove("is-leaving");
        el.classList.toggle("is-active", i === index);
        c.tab.classList.remove("is-active");
        // Chapitres déjà vus : barre pleine
        c.tab.classList.toggle("is-done", i < index);
        c.tab.setAttribute("aria-current", i === index ? "step" : "false");
      });
      const c = chapters[index];
      c.tab.style.setProperty("--dur", c.est + CORNER_OUT_MS + "ms");
      void c.tab.offsetWidth; // relance la barre même si l'onglet était déjà actif
      c.tab.classList.add("is-active");
    };

    if (reduced) {
      chapters.forEach((c) => finalScene(c.scene));
      const showStill = (i) => {
        show(i);
        toCorner(i);
      };
      showStill(0);
      chapters.forEach((c, i) => c.tab.addEventListener("click", () => showStill(i)));
      return;
    }

    // Le player n'avance que visible ; barre et caméra se figent sinon.
    let visible = false;
    let waiters = [];
    new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        player.classList.toggle("is-paused", !visible);
        if (visible) {
          waiters.forEach((resolve) => resolve());
          waiters = [];
        }
      },
      { threshold: 0.2 }
    ).observe(stage);
    const whenVisible = () => (visible ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve)));

    // Un jeton par lecture : cliquer un onglet en démarre une nouvelle, la
    // précédente s'arrête à sa prochaine étape.
    let token = 0;
    const playChapter = async (index, alive) => {
      const c = chapters[index];
      resetScene(c.scene);
      show(index);
      // Pas de carton-titre : la scène s'affiche tout de suite, le verbe du
      // chapitre précédent sort par le bas, puis le nouveau entre.
      player.classList.remove("is-corner");
      await wait(CORNER_OUT_MS);
      if (!alive()) return;
      toCorner(index);
      const start = performance.now();
      await runScene(c.scene, alive);
      if (alive()) c.est = Math.round(performance.now() - start);
    };
    const playFrom = async (index) => {
      const my = ++token;
      const alive = () => my === token;
      let i = index;
      while (alive()) {
        await whenVisible();
        if (!alive()) return;
        await playChapter(i, alive);
        i = (i + 1) % chapters.length;
      }
    };

    chapters.forEach((c, i) => c.tab.addEventListener("click", () => playFrom(i)));
    playFrom(0);
  }

  function initPlatformMocks() {
    $$("#plateforme .hp-feature-visual").forEach((visual) => {
      const key = $("[data-mock]", visual)?.dataset.mock;
      const mock = key && MOCKS[key]?.(visual);
      if (!mock) return;
      // data-mock-once : joué une fois à l'arrivée, puis figé sur l'état final
      if (reduced) mock.finalState();
      else if ("mockOnce" in mock.win.dataset) onceVisible(mock.win, mock.cycle);
      else loopWhileVisible(mock.win, mock.cycle);
    });
  }

  // ---------- 5–10 h ----------
  function initCounters() {
    $$("[data-countup]").forEach((el) => {
      onceVisible(el, () => countUp(el, Number(el.dataset.countup), 1300), 0.6);
    });
  }

  // ---------- Choix de l'avocat ----------
  // ---------- Leo : chat démo ----------
  const LEO_ANSWERS = [
    {
      q: "Comment structurer une clause de renouvellement ?",
      a: "Une clause de renouvellement fixe la durée initiale du contrat, le mode de renouvellement (exprès ou tacite), le délai de préavis pour notifier un non-renouvellement et les conditions éventuelles, comme le respect des normes du réseau. Je peux vous préparer une trame adaptée à votre réseau.",
    },
    {
      q: "Quelles mentions dans un DIP ?",
      a: "Le DIP réunit les mentions de l'article L.330-3 du Code de commerce : présentation du réseau, état du marché local, comptes, engagements réciproques… Je peux vous préparer la trame correspondante.",
    },
    {
      q: "Comment encadrer les obligations du franchisé ?",
      a: "On les structure autour de la transmission du savoir-faire, du respect des normes de la marque, de la formation, des redevances et de la confidentialité. Je signale aussi les points à équilibrer, comme la non-concurrence post-contractuelle.",
    },
  ];

  function initLeoChat() {
    const log = $("#hp-chat-log");
    const chips = $("#hp-chat-chips");
    if (!log || !chips) return;
    let busy = false;
    let touched = false;

    const scrollDown = () => {
      log.scrollTop = log.scrollHeight;
    };

    const addMsg = (who, html) => {
      const msg = document.createElement("div");
      msg.className = "hp-msg hp-msg--" + who;
      msg.innerHTML = html;
      log.appendChild(msg);
      scrollDown();
      return msg;
    };

    // Badge Leo de l'en-tête : réfléchit pendant la réponse, valide à la fin.
    const badge = $("#hp-chat-leo");

    const ask = async (i, chip) => {
      if (busy) return;
      busy = true;
      chips.classList.add("is-busy");
      leoAnims.play(badge, "generating.json");
      const { q, a } = LEO_ANSWERS[i];

      const you = addMsg("you", "");
      you.textContent = q;
      await wait(reduced ? 0 : 350);

      const leo = addMsg("leo", '<span class="hp-msg-who">Leo · Assistant IA</span><p><span class="hp-typing"><i></i><i></i><i></i></span></p>');
      const p = $("p", leo);
      await wait(reduced ? 0 : 950);

      if (reduced) {
        p.textContent = a;
      } else {
        p.textContent = "";
        const words = a.split(" ");
        for (let w = 0; w < words.length; w++) {
          p.textContent += (w ? " " : "") + words[w];
          if (w % 6 === 0) scrollDown();
          await wait(38);
        }
      }
      const val = document.createElement("span");
      val.className = "hp-msg-val";
      val.textContent = "Point qui engage votre réseau : à valider avec votre avocat dédié";
      leo.appendChild(val);
      scrollDown();
      leoAnims.play(badge, "check.json", {
        loop: false,
        onComplete: () => leoAnims.play(badge, "idle.json"),
      });

      if (chip) chip.classList.add("is-used");
      chips.classList.remove("is-busy");
      busy = false;
    };

    chips.addEventListener("click", (e) => {
      const chip = e.target.closest(".hp-chip");
      if (!chip) return;
      touched = true;
      ask(Number(chip.dataset.q), chip);
    });

    // Première question posée toute seule si le visiteur n'a pas cliqué.
    if (!reduced) {
      onceVisible(
        log,
        async () => {
          await wait(1800);
          if (touched) return;
          const chip = $('.hp-chip[data-q="1"]', chips);
          ask(1, chip);
        },
        0.6
      );
    }
  }

  initReveal();
  initLeoAnims();
  initMarquee();
  initStades();
  initStepTitles();
  initHeroEcosystem();
  initHeroPlayer();
  initPlatformMocks();
  initCounters();
  initLeoChat();
})();
