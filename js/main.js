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
      const t = Math.min(1, (now - start) / duration);
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
    // qu'une partie du fichier. Renvoie l'instance lottie (ou null).
    function play(container, file, { loop = true, segment = null, onComplete } = {}) {
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

  // ---------- Stades : mini-visuels + lueur au pointeur ----------
  // Les états visuels sont portés par des classes (.is-writing, .is-timing, .is-ready,
  // .is-importing, .is-alerting) : les transitions et délais sont en CSS.
  function initStades() {
    // La lueur rattrape le pointeur par interpolation (lerp) à chaque frame
    // au lieu de s'y coller : mouvement plus doux, qui traîne légèrement.
    const LERP = 0.1;
    $$(".hp-stade").forEach((card) => {
      const target = { x: 0, y: 0 };
      const pos = { x: 0, y: 0 };
      let frame = 0;
      let placed = false;

      const tick = () => {
        pos.x += (target.x - pos.x) * LERP;
        pos.y += (target.y - pos.y) * LERP;
        card.style.setProperty("--mx", pos.x + "px");
        card.style.setProperty("--my", pos.y + "px");
        const settled = Math.abs(target.x - pos.x) < 0.5 && Math.abs(target.y - pos.y) < 0.5;
        frame = settled ? 0 : requestAnimationFrame(tick);
      };

      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        target.x = e.clientX - r.left;
        target.y = e.clientY - r.top;
        // Première entrée : la lueur part du pointeur, pas du coin (0, 0).
        if (!placed || reduced) {
          placed = true;
          pos.x = target.x;
          pos.y = target.y;
        }
        if (!frame) frame = requestAnimationFrame(tick);
      });
    });

    const launch = $("[data-sv-launch]");
    const network = $("[data-sv-network]");

    if (launch) {
      const hours = $("[data-sv-hours]", launch);
      const state = $("[data-sv-state]", launch);
      // Temps d'écriture des lignes, lu dans le CSS (--line-t, --line-gap).
      const doc = $(".hp-sv-doc", launch);
      const lines = $$(".hp-sv-line", launch).length;
      const cssSeconds = (name) => parseFloat(getComputedStyle(doc).getPropertyValue(name)) * 1000;
      const writeMs = () => (lines - 1) * cssSeconds("--line-gap") + cssSeconds("--line-t");

      if (reduced) {
        launch.classList.add("is-writing", "is-timing", "is-ready");
        state.textContent = "Conforme loi Doubin";
      } else {
        loopWhileVisible(launch, async () => {
          launch.classList.remove("is-writing", "is-timing", "is-ready");
          hours.textContent = "0";
          state.textContent = "Rédaction en cours…";
          await wait(800);
          // 1. Le texte s'écrit…
          launch.classList.add("is-writing");
          await wait(writeMs() + 150);
          // 2. …puis le compteur file jusqu'à 48 h…
          launch.classList.add("is-timing");
          countUp(hours, 48, 1400);
          await wait(1550);
          // 3. …et le tampon tombe.
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

  // ---------- Mockup 1 : éditeur ----------
  function initEditor() {
    const win = $('[data-mock="editor"]');
    if (!win) return;
    const field = $('[data-ed-field="ville"]', win);
    const btn = $("[data-ed-btn]", win);
    const saved = $("[data-ed-saved]", win);

    const finalState = () => {
      win.classList.add("is-flagged", "is-amended");
      btn.classList.add("is-sent");
      btn.textContent = "Validé par l'avocat ✓";
    };
    if (reduced) return finalState();

    loopWhileVisible(win, async () => {
      win.classList.remove("is-flagged", "is-amended");
      btn.classList.remove("is-sent", "is-pressed");
      btn.textContent = "Soumettre à l'avocat";
      setPill(saved, "orange", "Enregistrement…");
      field.classList.add("is-typing");
      field.textContent = "";
      await wait(500);
      await typeInto(field, "Lyon 6e", 90);
      field.classList.remove("is-typing");
      setPill(saved, "teal", "Sauvegardé");
      await wait(700);
      win.classList.add("is-flagged");
      await wait(1600);
      btn.classList.add("is-pressed");
      await wait(160);
      btn.classList.remove("is-pressed");
      btn.classList.add("is-sent");
      btn.textContent = "Envoyé à l'avocat ✓";
      await wait(1300);
      win.classList.add("is-amended");
      btn.textContent = "Validé par l'avocat ✓";
      await wait(3400);
    });
  }

  // ---------- Mockup 2 : espace avocat ----------
  function initLawyer() {
    const win = $('[data-mock="lawyer"]');
    if (!win) return;
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
    if (reduced) return finalState();

    loopWhileVisible(win, async () => {
      win.classList.remove("is-validated");
      setPill(status, "orange", "En attente");
      pending.textContent = "2";
      done.textContent = "3 / 5 traités";
      await wait(1400);
      setPill(status, "purple", "En relecture");
      await wait(1600);
      finalState();
      await wait(3400);
    });
  }

  // ---------- Mockup 3 : signature ----------
  function initSign() {
    const win = $('[data-mock="sign"]');
    if (!win) return;
    const title = $("[data-sg-title]", win);
    const count = $("[data-sg-count]", win);
    const status = $("[data-sg-status]", win);
    const from = $("[data-sg-from]", win);
    const fromNote = $("[data-sg-from-note]", win);
    const to = $("[data-sg-to]", win);
    const track = $(".hp-sign-track", win);
    const doc = $("[data-sg-doc]", win);
    const pen = $("[data-sg-lottie]", win);

    const pop = spring({ stiffness: 420, damping: 16 });

    // Position de référence du document : début de la piste. La piste suit
    // l'axe déclaré en CSS (--sign-axis : x sur desktop, y sur mobile).
    const isHorizontal = () => getComputedStyle(track).getPropertyValue("--sign-axis").trim() !== "y";
    const trackRoom = () => (isHorizontal() ? track.clientWidth - doc.offsetWidth : track.clientHeight - doc.offsetHeight);

    // La carte d'arrivée s'allume brièvement et rebondit.
    const hit = (target) => {
      target.classList.add("is-hit");
      target.animate([{ transform: "scale(1.04)" }, { transform: "none" }], pop);
      setTimeout(() => target.classList.remove("is-hit"), 700);
    };

    // Trajet d'une carte à l'autre, en un seul geste : le document jaillit
    // de la carte de départ (il y grandit et apparaît), suit la piste, puis
    // plonge dans la carte d'arrivée qui l'absorbe (il rétrécit et
    // s'efface). Les offsets des keyframes sont proportionnels aux
    // distances et une seule courbe couvre tout le trajet : vitesse
    // continue, aucun arrêt aux bouts de la piste. Au repos, le document est
    // donc « dans » l'expéditeur (invisible, voir reset).
    const TRIP_MS = 2100; // durée d'un trajet carte → carte
    const trip = async (source, target) => {
      const horizontal = isHorizontal();
      const room = trackRoom();
      // Repère : le document sans transformation, en début de piste.
      const d = doc.getBoundingClientRect();
      const cx = d.left + d.width / 2;
      const cy = d.top + d.height / 2;
      const centerOf = (el) => {
        const r = el.getBoundingClientRect();
        return [r.left + r.width / 2 - cx, r.top + r.height / 2 - cy];
      };
      const trackStart = [0, 0];
      const trackEnd = horizontal ? [room, 0] : [0, room];
      const forward = source === from;
      const points = forward
        ? [centerOf(source), trackStart, trackEnd, centerOf(target)]
        : [centerOf(source), trackEnd, trackStart, centerOf(target)];

      const lengths = points.slice(1).map((pt, i) => Math.hypot(pt[0] - points[i][0], pt[1] - points[i][1]));
      const total = lengths.reduce((sum, l) => sum + l, 0);
      const offsets = [0];
      lengths.forEach((l, i) => offsets.push(offsets[i] + l / total));
      offsets[3] = 1;

      const tilt = (forward ? 1 : -1) * (horizontal ? 7 : -7);
      const at = ([x, y], rotate, scale, opacity, offset) => ({
        offset,
        opacity,
        transform: `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${scale})`,
      });
      const mid = [(points[1][0] + points[2][0]) / 2, (points[1][1] + points[2][1]) / 2];
      const keyframes = [
        at(points[0], 0, 0.1, 0, 0),
        at(points[1], tilt / 2, 0.95, 1, offsets[1]),
        at(mid, tilt, 1.1, 1, (offsets[1] + offsets[2]) / 2),
        at(points[2], tilt / 2, 0.95, 1, offsets[2]),
        at(points[3], 0, 0.1, 0, 1),
      ];

      hit(source); // la carte de départ « relâche » le document
      win.classList.add("is-sending");
      await doc.animate(keyframes, { duration: TRIP_MS, easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)" }).finished;
      win.classList.remove("is-sending");
      hit(target);
    };

    const reset = () => {
      doc.getAnimations().forEach((a) => a.cancel());
      doc.style.opacity = "0"; // rangé dans la carte de l'expéditeur
      win.classList.remove("is-signing", "is-signed", "is-archived");
      title.textContent = "Prêt à envoyer";
      count.textContent = "1";
      setPill(status, "orange", "En attente");
      fromNote.textContent = "Franchiseur · a signé";
      fromNote.classList.remove("is-done");
    };

    const signed = () => {
      win.classList.remove("is-signing");
      win.classList.add("is-signed");
      setPill(status, "green", "Signé");
      count.textContent = "2";
      title.textContent = "Contrat signé";
    };

    const archived = () => {
      win.classList.add("is-archived");
      fromNote.textContent = "Contrat signé reçu";
      fromNote.classList.add("is-done");
    };

    if (reduced) {
      signed();
      archived();
      return;
    }

    reset();
    loopWhileVisible(win, async () => {
      reset();
      await wait(900);

      // 1. Le document part de l'expéditeur et le destinataire l'absorbe
      title.textContent = "Envoi à Crêperie Pivolane…";
      await trip(from, to);

      // 2. Signature manuscrite (Lottie dans le badge posé sur l'avatar).
      // sign-handwritten.json (~2 s) écrit la signature puis la tient : joué
      // une fois, il reste sur sa dernière frame jusqu'à la fin de l'étape.
      title.textContent = "Signature en cours…";
      setPill(status, "teal", "Signature…");
      leoAnims.play(pen, "sign-handwritten.json", { loop: false });
      win.classList.add("is-signing");
      await wait(2300);
      signed();
      await wait(500);

      // 3. Il ressort signé (sceau) et l'expéditeur l'absorbe à son tour
      await trip(to, from);
      archived();
      await wait(3400);
    });
  }


  // ---------- Mockup 4 : kanban ----------
  function initKanban() {
    const win = $('[data-mock="kanban"]');
    if (!win) return;
    const board = $(".hp-kb", win);
    const cols = $$("[data-kb-col]", win);
    const cards = $$(".hp-kb-card", win);
    const card = $("[data-kb-mover]", win);
    const date = $("[data-kb-date]", win);
    const labels = ["Créé le 28/08", "Envoyé à l'avocat", "Envoyé à signer", "Signé à l'instant"];

    // Ressorts : « layout » pour tout ce qui se replace (cartes voisines,
    // hauteur du tableau), un peu plus vif et rebondi pour la carte déplacée.
    const layout = spring({ stiffness: 260, damping: 26 });
    const lift = spring({ stiffness: 220, damping: 19 });
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
        // La carte déplacée : trajet sur un ressort plus vif, plus une
        // inclinaison / mise à l'échelle qui s'ajoute par-dessus (composite)
        // et se relâche un peu après, comme une carte qu'on pose. L'ordre
        // compte : l'animation « add » doit être créée après celle qu'elle
        // complète, sinon cette dernière la remplace.
        const trip = el.animate([from, { transform: "none" }], lift);
        el.animate(
          [{ transform: "rotate(-3deg) scale(1.05)" }, { transform: "rotate(0) scale(1)" }],
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

    if (reduced) return;

    loopWhileVisible(win, async () => {
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
    });
  }


  // ---------- Mockup 5 : contrathèque ----------
  function initLibrary() {
    const win = $('[data-mock="library"]');
    if (!win) return;
    const query = $("[data-lib-query]", win);
    const search = $(".hp-lib-search", win);
    const rows = $$("[data-lib-row]", win);
    const views = $$("[data-lib-view]", win);
    const alert = $("[data-lib-alert]", win.parentElement);

    const setView = (name) => views.forEach((v) => v.classList.toggle("is-active", v.dataset.libView === name));
    const reset = () => {
      query.textContent = "";
      setView("all");
      rows.forEach((r) => r.classList.remove("is-filtered", "is-hit"));
      alert.classList.remove("is-shown");
    };
    const finalState = () => {
      setView("renew");
      rows.forEach((r) => r.classList.toggle("is-filtered", r.dataset.libRow !== "renew"));
      alert.classList.add("is-shown");
    };
    if (reduced) return finalState();

    loopWhileVisible(win, async () => {
      reset();
      await wait(900);
      search.classList.add("is-typing");
      await typeInto(query, "Lyon", 110);
      rows.forEach((r) => {
        const hit = r.textContent.includes("Lyon");
        r.classList.toggle("is-hit", hit);
        r.classList.toggle("is-filtered", !hit);
      });
      await wait(1600);
      search.classList.remove("is-typing");
      query.textContent = "";
      rows.forEach((r) => r.classList.remove("is-hit"));
      finalState();
      alert.classList.remove("is-shown");
      await wait(900);
      alert.classList.add("is-shown");
      await wait(3600);
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
  initHeroEcosystem();
  initStades();
  initStepTitles();
  initEditor();
  initLawyer();
  initSign();
  initKanban();
  initLibrary();
  initCounters();
  initLeoChat();
})();
