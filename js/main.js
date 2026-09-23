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

  // ---------- Hero : dashboard ----------
  function initHeroDashboard() {
    const visual = $(".hp-hero-visual");
    if (!visual) return;
    const gen = $("#hp-hero-gen");
    const genTitle = $("#hp-hero-gen-title");
    const bar = $("#hp-hero-gen-bar");
    const step = $("#hp-hero-step");
    const toast = $("#hp-hero-toast");

    onceVisible(visual, () => {
      $$("[data-count]", visual).forEach((el) => countUp(el, Number(el.dataset.count)));
    });

    const done = () => {
      bar.style.setProperty("--p", "100%");
      gen.classList.add("is-done");
      genTitle.textContent = "DIP prêt à relire";
      step.classList.add("is-done");
    };

    if (reduced) {
      done();
      toast.classList.add("is-shown");
      return;
    }

    loopWhileVisible(visual, async () => {
      gen.classList.remove("is-done");
      genTitle.textContent = "Génération en cours…";
      step.classList.remove("is-done");
      bar.style.setProperty("--p", "0%");
      await wait(700);
      for (const p of [18, 34, 52, 67, 81, 93]) {
        bar.style.setProperty("--p", p + "%");
        await wait(420);
      }
      done();
      await wait(1000);
      toast.classList.add("is-shown");
      await wait(3000);
      toast.classList.remove("is-shown");
      await wait(900);
    });
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

    const finalState = () => {
      win.classList.add("is-validated");
      setPill(status, "green", "Validé");
      pending.textContent = "1";
    };
    if (reduced) return finalState();

    loopWhileVisible(win, async () => {
      win.classList.remove("is-validated");
      setPill(status, "orange", "En attente");
      pending.textContent = "2";
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
    const status = $("[data-sg-status]", win);
    const count = $("[data-sg-count]", win);
    const bar = $("[data-sg-bar]", win);
    const title = $("[data-sg-title]", win);

    const finalState = () => {
      setPill(status, "green", "Signé");
      count.textContent = "2";
      bar.style.setProperty("--p", "100%");
      title.textContent = "Contrat signé";
      win.classList.add("is-signed");
    };
    if (reduced) return finalState();

    loopWhileVisible(win, async () => {
      win.classList.remove("is-signed");
      setPill(status, "orange", "En attente");
      count.textContent = "1";
      bar.style.setProperty("--p", "50%");
      title.textContent = "En cours de signature";
      await wait(1600);
      setPill(status, "teal", "Signature…");
      await wait(1300);
      finalState();
      await wait(3600);
    });
  }

  // ---------- Mockup 4 : kanban ----------
  function initKanban() {
    const win = $('[data-mock="kanban"]');
    if (!win) return;
    const cols = $$("[data-kb-col]", win);
    const card = $("[data-kb-mover]", win);
    const date = $("[data-kb-date]", win);
    const labels = ["Créé le 28/08", "Envoyé à l'avocat", "Envoyé à signer", "Signé à l'instant"];

    const refreshCounts = () => {
      cols.forEach((col) => {
        $(".hp-kb-n", col).textContent = $$(".hp-kb-card", col).length;
      });
    };

    // FLIP : on déplace la carte dans le DOM, puis on l'anime depuis son
    // ancienne position vers la nouvelle.
    const moveTo = async (i, animate = true) => {
      const first = card.getBoundingClientRect();
      const col = cols[i];
      col.insertBefore(card, $(".hp-kb-card", col));
      date.textContent = labels[i];
      refreshCounts();
      if (!animate) return;
      const last = card.getBoundingClientRect();
      card.classList.add("is-lifted");
      const anim = card.animate(
        [
          { transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) rotate(-2deg)` },
          { transform: "translate(0, 0) rotate(0)" },
        ],
        { duration: 750, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
      await anim.finished;
      card.classList.remove("is-lifted");
    };

    if (reduced) return;

    loopWhileVisible(win, async () => {
      await wait(1200);
      for (let i = 1; i < cols.length; i++) {
        await moveTo(i);
        await wait(1500);
      }
      await wait(1400);
      await card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }).finished;
      await moveTo(0, false);
      await card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: "forwards" }).finished;
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
  function initLawyerChoice() {
    const opts = $$(".hp-opt");
    const select = (opt) => {
      opts.forEach((o) => {
        const on = o === opt;
        o.classList.toggle("is-selected", on);
        o.setAttribute("aria-checked", String(on));
        o.tabIndex = on ? 0 : -1;
      });
    };
    opts.forEach((opt, i) => {
      opt.tabIndex = opt.classList.contains("is-selected") ? 0 : -1;
      opt.addEventListener("click", () => select(opt));
      opt.addEventListener("keydown", (e) => {
        const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        const next = opts[(i + dir + opts.length) % opts.length];
        select(next);
        next.focus();
      });
    });
  }

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

    const ask = async (i, chip) => {
      if (busy) return;
      busy = true;
      chips.classList.add("is-busy");
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
  initMarquee();
  initHeroDashboard();
  initStepTitles();
  initEditor();
  initLawyer();
  initSign();
  initKanban();
  initLibrary();
  initCounters();
  initLawyerChoice();
  initLeoChat();
})();
