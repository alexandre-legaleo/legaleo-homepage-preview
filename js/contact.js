// Page contact : prise de contact en 2 étapes (contact.html).
//   0. Profil, en tête de formulaire : franchiseur ou avocat. Un avocat
//      donne son cabinet (pas de points de vente) et envoie seulement un
//      message, qui suit le circuit avocats partenaires (script).
//   1. Qualification : prénom, nom, email, enseigne, points de vente.
//      « Situation » est masquée (doublon) et déduite des points de vente.
//   2. Au choix, sous un récapitulatif modifiable :
//      - réserver une démo : jour puis horaire, parmi les créneaux libres de
//        l'agenda Google de Mehdi, et un message facultatif ;
//      - envoyer un message, sans rendez-vous.
//      Tout part vers le script Google Apps Script (apps-script/contact.gs),
//      qui crée le rendez-vous (lien Meet, invitation) et pousse le contact
//      vers HubSpot, Encharge et Slack.
// En plus :
//   - pré-sélection depuis l'URL (?reseau=lancement|developpement|structure),
//     ex. depuis les CTA de la homepage ; ?profil=avocat pour les avocats ;
//   - saisie gardée pendant la session (sessionStorage), effacée une fois la
//     demande envoyée ;
//   - démo réservée : « Ce qui se passe ensuite » passe l'étape 1 à « C'est
//     fait » et date l'étape 2 ;
//   - mobile / tablette : bouton « Réserver ma démo » collé en bas de
//     l'écran tant que la carte n'est pas visible.
(() => {
  // Adresse de la web app Apps Script (Déployer > Application Web, voir
  // apps-script/contact.gs). Vide : mode maquette, créneaux fictifs et
  // aucun envoi.
  const API_URL = "https://script.google.com/macros/s/AKfycbwH1XasqUgamR6kw4-OPh5Glo0ZpbjqMPtNrynXPmwIQQ8sQ-wmEkc2Srql0Wti4AmuTQ/exec";

  // Affichage des créneaux : toujours à l'heure de Paris (celle de l'agenda)
  const TZ = "Europe/Paris";
  const REQUEST_TIMEOUT = 20000;

  // Situation déduite des points de vente (tant que la question est masquée)
  const STAGE_BY_OUTLETS = {
    "1 à 5": "Je lance mon réseau",
    "6 à 30": "Je développe un réseau établi",
    "31 à 100": "Je structure un grand réseau",
    "100 et plus": "Je structure un grand réseau",
  };

  // ?reseau=… → situation, et points de vente quand ils sont sans ambiguïté
  const FROM_URL = {
    lancement: { stage: "Je lance mon réseau", outlets: "1 à 5" },
    developpement: { stage: "Je développe un réseau établi", outlets: "6 à 30" },
    structure: { stage: "Je structure un grand réseau" },
  };

  const STORAGE_KEY = "legaleo-contact";
  const MAIL = "hello@legaleo.ai";

  const book = document.querySelector("[data-book]");
  if (!book) return;
  const form = book.querySelector("[data-book-form]");
  const slot = book.querySelector("[data-book-slot]");
  const step = book.querySelector("[data-book-step]");
  const recap = book.querySelector("[data-book-recap]");
  const recapRow = book.querySelector("[data-book-recap-row]");
  const back = book.querySelector("[data-book-back]");
  const error = book.querySelector("[data-book-error]");
  const slotTitle = book.querySelector("[data-book-slot-h]");
  const stageField = book.querySelector("[data-book-stage]");
  const modes = book.querySelector("[data-modes]");
  const panes = { demo: book.querySelector('[data-pane="demo"]'), message: book.querySelector('[data-pane="message"]') };
  const daysEl = book.querySelector("[data-days]");
  const timesEl = book.querySelector("[data-times]");
  const demoSubmit = book.querySelector("[data-demo-submit]");
  const done = book.querySelector("[data-done]");
  const mockNote = book.querySelector("[data-mock]");
  const nextBooked = document.querySelector("[data-next-booked]");
  const nextDate = document.querySelector("[data-next-date]");
  const sticky = document.querySelector("[data-sticky]");
  const companyLabel = book.querySelector("[data-company-l]");
  const embedded = document.documentElement.classList.contains("is-embedded");
  const openedAt = Date.now();

  // ---------- Saisie : restauration (session, puis URL) et sauvegarde ----------
  const FIELDS = ["profile", "firstname", "lastname", "email", "company", "outlets", "stage"];
  const setValue = (name, value) => {
    if (!value) return;
    const inputs = form.querySelectorAll(`[name="${name}"]`);
    inputs.forEach((input) => {
      if (input.type === "radio") input.checked = input.value === value;
      else input.value = value;
    });
  };
  const readStored = () => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || {};
    } catch (err) {
      return {};
    }
  };
  const store = () => {
    const data = new FormData(form);
    const values = Object.fromEntries(FIELDS.map((f) => [f, data.get(f) || ""]));
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch (err) {}
  };
  const clearStored = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {}
  };

  const params = new URLSearchParams(location.search);
  const fromUrl = { ...FROM_URL[params.get("reseau")], ...(params.get("profil") === "avocat" && { profile: "avocat" }) };
  const stored = readStored();
  FIELDS.forEach((f) => setValue(f, stored[f] || fromUrl[f]));
  form.addEventListener("input", store);
  form.addEventListener("change", store);

  // ---------- Validation ----------
  // Champ ou groupe de pastilles non valide : surbrillance jusqu'à
  // correction. Les champs masqués (situation) ne comptent pas.
  const holderOf = (input) => input.closest(".ct-field, .ct-choices");
  const check = () => {
    let ok = true;
    form.querySelectorAll("input[required]").forEach((input) => {
      if (input.closest("[hidden]")) return;
      const valid = input.type === "radio" ? !!form.querySelector(`input[name="${input.name}"]:checked`) : input.checkValidity();
      holderOf(input).classList.toggle("is-invalid", !valid);
      if (!valid && ok) {
        ok = false;
        input.focus();
      }
    });
    error.hidden = ok;
    return ok;
  };
  form.addEventListener("input", (e) => {
    if (!error.hidden) {
      const holder = holderOf(e.target);
      if (holder?.classList.contains("is-invalid")) check();
    }
  });

  // Réponses du formulaire, situation déduite si la question est masquée
  const answers = () => {
    const data = new FormData(form);
    if (data.get("profile") === "avocat") {
      // Pas de points de vente pour un avocat (champ masqué, valeur ignorée)
      data.set("outlets", "");
      data.set("stage", "");
    } else if (stageField.hidden) data.set("stage", STAGE_BY_OUTLETS[data.get("outlets")] || "");
    const get = (f) => (data.get(f) || "").trim();
    return {
      profile: get("profile") || "franchiseur",
      firstname: get("firstname"),
      lastname: get("lastname"),
      email: get("email"),
      company: get("company"),
      outlets: get("outlets"),
      stage: get("stage"),
      website: get("website"), // champ piège (anti-robot)
    };
  };

  // ---------- Profil : franchiseur ou avocat ----------
  // [data-for] : éléments propres à un profil (titres, points de vente,
  // mentions). Les champs masqués ne sont pas exigés (check).
  const COMPANY = {
    franchiseur: { label: "Votre enseigne", placeholder: "Nom du réseau" },
    avocat: { label: "Nom du cabinet", placeholder: "Cabinet Martin Avocats" },
  };
  const MESSAGE_PLACEHOLDER = {
    franchiseur: "Votre question, votre projet de réseau…",
    avocat: "Votre cabinet, votre pratique du droit de la franchise, votre question…",
  };
  const isLawyer = () => answers().profile === "avocat";
  const applyProfile = () => {
    const profile = answers().profile;
    book.querySelectorAll("[data-for]").forEach((el) => (el.hidden = el.dataset.for !== profile));
    companyLabel.textContent = COMPANY[profile].label;
    form.elements.company.placeholder = COMPANY[profile].placeholder;
    panes.message.elements.message.placeholder = MESSAGE_PLACEHOLDER[profile];
    if (sticky) sticky.textContent = profile === "avocat" ? "Nous écrire" : "Réserver ma démo";
    form.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
    error.hidden = true;
  };
  book.querySelector("[data-profile]").addEventListener("change", applyProfile);
  applyProfile();

  // ---------- Dates, à l'heure de Paris ----------
  const fmt = (options) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, ...options });
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const dayKey = (date) => dayKeyFmt.format(date); // « 2026-10-06 »
  const timeLabel = (date) => fmt({ hour: "2-digit", minute: "2-digit" }).format(date).replace(/^0(?=\d)/, ""); // « 9:30 », « 14:00 »
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const longDay = (date) => fmt({ weekday: "long", day: "numeric", month: "long" }).format(date); // « mardi 7 octobre »
  // « Mardi 7 oct. · 10 h » / « … · 10 h 30 » (frise « Ce qui se passe ensuite »)
  const shortWhen = (date) => {
    const [h, m] = timeLabel(date).split(":");
    return `${capital(fmt({ weekday: "long", day: "numeric", month: "short" }).format(date))} · ${h} h${m === "00" ? "" : " " + m}`;
  };

  // ---------- Échanges avec le script (ou maquette) ----------
  // POST en text/plain : requête « simple », sans pré-vérification CORS,
  // que la web app Apps Script ne sait pas traiter.
  const request = async (method, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const res = await fetch(method === "GET" ? `${API_URL}?action=slots` : API_URL, {
        method,
        signal: controller.signal,
        ...(body && { headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, error: "network" };
    } finally {
      clearTimeout(timer);
    }
  };

  // Maquette : créneaux fictifs sur 10 jours ouvrés, de 9 h à 18 h à l'heure
  // de Paris (quel que soit le fuseau du navigateur, comme le script), dont
  // une partie déjà prise ; envois simulés.
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });
  const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" });
  const mockSlots = () => {
    const slots = [];
    const days = new Set();
    for (let i = 0; days.size < 10 && i < 30; i++) {
      const date = new Date(Date.now() + i * 86400e3);
      const key = dayKey(date);
      if (days.has(key) || ["Sat", "Sun"].includes(weekdayFmt.format(date))) continue;
      days.add(key);
      // Décalage de Paris ce jour-là, pris à midi : « GMT+02:00 » → « +02:00 »
      const offset = offsetFmt.format(new Date(`${key}T12:00:00Z`)).split("GMT")[1] || "Z";
      for (let min = 9 * 60; min < 18 * 60; min += 30) {
        const hhmm = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
        const start = new Date(`${key}T${hhmm}:00${offset}`);
        const taken = (Number(key.slice(-2)) * 7 + min / 30) % 5 < 2;
        if (!taken && start - Date.now() > 4 * 3600e3) slots.push(start.toISOString());
      }
    }
    return slots;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const api = {
    async slots() {
      if (!API_URL) {
        await wait(500);
        return { ok: true, slots: mockSlots() };
      }
      return request("GET");
    },
    async send(payload) {
      if (!API_URL) {
        await wait(900);
        return { ok: true };
      }
      return request("POST", payload);
    },
  };
  mockNote.hidden = !!API_URL;

  // ---------- Démo : jours, puis horaires ----------
  let byDay = new Map(); // « 2026-10-06 » → [Date…]
  let pickedDay = null;
  let pickedSlot = null; // chaîne ISO renvoyée par le script
  let slotsToken = 0;

  const skeleton = (n, cls) => `<span class="ct-skel ${cls}"></span>`.repeat(n);
  const setDemoButton = () => {
    demoSubmit.disabled = !pickedSlot;
    demoSubmit.textContent = pickedSlot ? `Confirmer : ${longDay(new Date(pickedSlot))} à ${timeLabel(new Date(pickedSlot))}` : "Choisissez un créneau";
  };

  const renderTimes = () => {
    timesEl.replaceChildren(
      ...(byDay.get(pickedDay) || []).map((date) => {
        const iso = date.toISOString();
        const button = Object.assign(document.createElement("button"), { type: "button", className: "ct-time", textContent: timeLabel(date) });
        button.dataset.iso = iso;
        button.setAttribute("aria-pressed", String(iso === pickedSlot));
        return button;
      })
    );
  };

  const renderDays = () => {
    daysEl.replaceChildren(
      ...[...byDay.keys()].map((key) => {
        const date = byDay.get(key)[0];
        const button = Object.assign(document.createElement("button"), { type: "button", className: "ct-day" });
        button.dataset.day = key;
        button.setAttribute("aria-pressed", String(key === pickedDay));
        button.setAttribute("aria-label", capital(longDay(date)));
        button.innerHTML = `<small>${fmt({ weekday: "short" }).format(date).replace(".", "")}</small><b>${fmt({ day: "numeric" }).format(date)}</b><small>${fmt({ month: "short" }).format(date)}</small>`;
        return button;
      })
    );
    renderTimes();
  };

  const loadSlots = async () => {
    const token = ++slotsToken;
    pickedSlot = null;
    setDemoButton();
    daysEl.innerHTML = skeleton(10, "ct-skel--day");
    timesEl.innerHTML = skeleton(8, "ct-skel--time");
    const res = await api.slots();
    if (token !== slotsToken) return;
    if (!res?.ok || !Array.isArray(res.slots)) {
      daysEl.replaceChildren();
      timesEl.innerHTML = `<p class="ct-times-empty">L'agenda ne répond pas pour le moment. <button type="button" class="ct-back" data-retry>Réessayer</button> ou <button type="button" class="ct-back" data-to-message>envoyez-nous un message</button>.</p>`;
      return;
    }
    // Créneaux regroupés par jour (de Paris), jours sans créneau omis
    byDay = new Map();
    res.slots.forEach((iso) => {
      const date = new Date(iso);
      const key = dayKey(date);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(date);
    });
    if (!byDay.size) {
      daysEl.replaceChildren();
      timesEl.innerHTML = `<p class="ct-times-empty">Plus aucun créneau libre ces prochains jours. <button type="button" class="ct-back" data-to-message>Envoyez-nous un message</button> : on vous propose un horaire.</p>`;
      return;
    }
    if (!byDay.has(pickedDay)) pickedDay = byDay.keys().next().value;
    renderDays();
  };

  daysEl.addEventListener("click", (e) => {
    const button = e.target.closest(".ct-day");
    if (!button) return;
    pickedDay = button.dataset.day;
    pickedSlot = null;
    daysEl.querySelectorAll(".ct-day").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    renderTimes();
    setDemoButton();
  });

  timesEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-retry]")) return loadSlots();
    if (e.target.closest("[data-to-message]")) return setMode("message", true);
    const button = e.target.closest(".ct-time");
    if (!button) return;
    pickedSlot = button.dataset.iso;
    timesEl.querySelectorAll(".ct-time").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    setDemoButton();
  });

  // ---------- Démo ou message ----------
  let mode = "demo";
  const setMode = (next, focus) => {
    mode = next;
    modes.querySelector(`input[value="${next}"]`).checked = true;
    panes.demo.hidden = next !== "demo";
    panes.message.hidden = next !== "message";
    // Message déjà saisi : suit d'un volet à l'autre
    const from = panes[next === "demo" ? "message" : "demo"].elements.message;
    const to = panes[next].elements.message;
    if (from.value && !to.value) to.value = from.value;
    if (focus) (next === "message" ? to : modes.querySelector("input:checked")).focus();
  };
  modes.addEventListener("change", (e) => setMode(e.target.value));

  // ---------- Envoi ----------
  const paneError = (pane, html) => {
    const el = pane.querySelector("[data-pane-error]");
    el.innerHTML = html || "";
    el.hidden = !html;
  };
  const FAILED = `La demande n'a pas pu être envoyée. Réessayez, ou écrivez-nous à <a href="mailto:${MAIL}">${MAIL}</a>.`;

  const finish = (title, text) => {
    book.classList.add("is-booked");
    modes.hidden = true;
    panes.demo.hidden = true;
    panes.message.hidden = true;
    recapRow.hidden = true;
    slotTitle.hidden = true;
    done.querySelector("[data-done-t]").textContent = title;
    done.querySelector("[data-done-p]").textContent = text;
    done.hidden = false;
    clearStored();
    updateSticky();
  };

  const submit = async (pane, payload, button) => {
    paneError(pane, "");
    const label = button.innerHTML;
    button.disabled = true;
    button.textContent = "Envoi en cours…";
    const res = await api.send({ ...answers(), ...payload, elapsed: Date.now() - openedAt });
    button.innerHTML = label;
    button.disabled = false;
    return res;
  };

  panes.demo.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!pickedSlot) return;
    const start = new Date(pickedSlot);
    const res = await submit(panes.demo, { action: "book", start: pickedSlot, message: panes.demo.elements.message.value.trim() }, demoSubmit);
    if (res?.ok) {
      const { firstname, email } = answers();
      step.textContent = "Démo réservée";
      finish(
        `${firstname ? firstname + ", votre" : "Votre"} démo est réservée`,
        `${capital(longDay(start))} à ${timeLabel(start)} (heure de Paris), 30 minutes en visio. L'invitation avec le lien Google Meet vient d'être envoyée à ${email}.`
      );
      if (nextBooked) {
        nextBooked.classList.add("is-done");
        nextBooked.querySelector("[data-next-tag]").textContent = "✓ C'est fait";
      }
      if (nextDate) nextDate.textContent = shortWhen(start);
      return;
    }
    if (res?.error === "taken") {
      paneError(panes.demo, "Ce créneau vient d'être pris. Choisissez-en un autre.");
      loadSlots();
      return;
    }
    setDemoButton();
    paneError(panes.demo, FAILED);
  });

  panes.message.addEventListener("submit", async (e) => {
    e.preventDefault();
    const field = panes.message.elements.message;
    const text = field.value.trim();
    field.closest(".ct-field").classList.toggle("is-invalid", !text);
    if (!text) {
      paneError(panes.message, "Écrivez votre message pour l'envoyer.");
      field.focus();
      return;
    }
    const res = await submit(panes.message, { action: "message", message: text }, panes.message.querySelector(".ct-submit"));
    if (res?.ok) {
      const { firstname, email } = answers();
      step.textContent = "Message envoyé";
      finish(`Merci${firstname ? " " + firstname : ""}, message bien reçu`, `${isLawyer() ? "L'équipe des avocats partenaires" : "L'équipe"} vous répond par email, à ${email}.`);
      return;
    }
    paneError(panes.message, FAILED);
  });
  panes.message.elements.message.addEventListener("input", (e) => {
    if (e.target.value.trim()) e.target.closest(".ct-field").classList.remove("is-invalid");
  });

  // ---------- Partie visible de la page ----------
  // Hors iframe : la fenêtre. Dans l'iframe Webflow : la page parente
  // envoie la partie de l'iframe à l'écran (js/embed.js, « legaleo:view »).
  let view = { top: 0, height: window.innerHeight };
  const readView = () => (embedded ? view : { top: window.scrollY, height: window.innerHeight });
  const pageTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  const scrollToBook = () => {
    const y = pageTop(book) - 16;
    if (embedded && window.legaleoEmbed) window.legaleoEmbed.scrollTo(y);
    else window.scrollTo({ top: y, behavior: "smooth" });
  };

  // ---------- Étapes ----------
  const show = (toSlot) => {
    form.hidden = toSlot;
    slot.hidden = !toSlot;
    book.classList.toggle("is-slot", toSlot);
    step.textContent = toSlot ? "Étape 2 sur 2" : "Étape 1 sur 2";
    // Haut de la carte remis à l'écran s'il est passé au-dessus
    if (pageTop(book) < readView().top) scrollToBook();
    updateSticky();
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!check()) return;
    const data = answers();
    const lawyer = data.profile === "avocat";
    recap.textContent = [`${data.firstname} ${data.lastname}`.trim(), data.company, !lawyer && data.outlets && `${data.outlets} points de vente`]
      .filter(Boolean)
      .join(" · ");
    // Avocat : message seulement, sans choix ni agenda
    modes.hidden = lawyer;
    slotTitle.innerHTML = lawyer ? "Votre message" : "Comment souhaitez-vous continuer&nbsp;?";
    if (lawyer) setMode("message");
    else {
      // Revenu d'avocat à franchiseur : on repart sur la démo
      if (modes.dataset.lawyer) setMode("demo");
      if (!byDay.size) loadSlots();
    }
    modes.dataset.lawyer = lawyer ? "1" : "";
    show(true);
  });

  back.addEventListener("click", () => {
    show(false);
    form.querySelector("input").focus();
  });

  // ---------- Bouton « Réserver ma démo » collé en bas de l'écran ----------
  // Mobile / tablette seulement (css/contact.css). Visible tant que la carte
  // n'est pas à l'écran, et jusqu'à l'envoi. Dans l'iframe, position: fixed
  // collerait au bas de l'iframe (bas de la page) : on le place en absolu,
  // en bas de la partie visible.
  const STICKY_GAP = 16;
  function updateSticky() {
    if (!sticky) return;
    const { top, height } = readView();
    const bookTop = pageTop(book);
    const bookBottom = bookTop + book.offsetHeight;
    const bookInView = bookTop < top + height - 80 && bookBottom > top + 80;
    sticky.classList.toggle("is-shown", !bookInView && !book.classList.contains("is-booked"));
    if (embedded) {
      const max = document.documentElement.scrollHeight - sticky.offsetHeight - STICKY_GAP;
      sticky.style.top = Math.min(max, top + height - sticky.offsetHeight - STICKY_GAP) + "px";
    }
  }
  if (sticky) {
    document.documentElement.classList.toggle("has-view", embedded);
    sticky.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // pas de second défilement par embed.js
      scrollToBook();
    });
    window.addEventListener("legaleo:view", (e) => {
      view = e.detail;
      updateSticky();
    });
    window.addEventListener("scroll", updateSticky, { passive: true });
    window.addEventListener("resize", updateSticky);
    updateSticky();
  }
})();
