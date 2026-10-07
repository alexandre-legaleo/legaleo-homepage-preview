/**
 * Legaleo — Page contact : démo (Google Agenda) ou message
 * Page contact -> Google Agenda (rendez-vous + Meet + invitation) -> HubSpot (contact,
 * deal, note, rendez-vous) -> Encharge (tags + score HOT) -> Slack (#sales)
 *
 * Même logique que les scripts « Lead formulaire franchiseur » et « Candidature avocat »,
 * mais la page envoie directement ses données (pas de lecture des e-mails Webflow).
 *   - Franchiseur, au choix :
 *       « Réserver une démo » : créneau libre de l'agenda, 30 min, lundi-vendredi 9 h-18 h ;
 *       « Envoyer un message » : sans rendez-vous.
 *     -> circuit franchiseur : Mehdi, pipeline de vente, score HOT.
 *   - Avocat : message seulement (cabinet au lieu de l'enseigne, pas de points de vente)
 *     -> circuit avocat : Jean-Philippe, pipeline Partenaires, tag lawyer, pas de score.
 *   - Agent Leo (widget du site, mode « script ») : les deux mêmes choix que la page
 *     (démo ou message), même circuit, plus les réponses de qualification (note
 *     HubSpot, Slack), un score Encharge selon la priorité calculée par Leo (A : HOT,
 *     B : tiède, C : aucun) et, pour une démo, l'invitation Agenda avec le lien Meet
 *     (e-mail de confirmation en plus : CONFIG.LEO_CONFIRM_MAIL).
 *     Franchisés et clients (support) : contact, note, Slack, sans deal.
 *
 * ⚠️ NOUVEAU projet Apps Script (pas celui des franchiseurs : mêmes noms de fonctions).
 * ⚠️ Aucune clé dans ce fichier : elles sont dans les Propriétés du script (étape 4).
 *
 * ============================ INSTALLATION (une seule fois) ============================
 * 1. Se connecter à Google avec le compte dont l'agenda reçoit les démos (Mehdi),
 *    ouvrir https://script.google.com > « Nouveau projet ». Le renommer
 *    « Legaleo · Page contact ».
 * 2. Remplacer tout le contenu de Code.gs par ce fichier. Enregistrer.
 * 3. À gauche, « Services » (+) > « Google Calendar API » > Ajouter.
 *    (Nécessaire pour le lien Google Meet et la lecture des disponibilités.)
 * 4. À gauche, roue dentée « Paramètres du projet » > « Propriétés du script » >
 *    ajouter :
 *      HUBSPOT_TOKEN       jeton de l'app privée HubSpot (le même que le script franchiseur)
 *      ENCHARGE_TOKEN      clé API Encharge
 *      SLACK_WEBHOOK_URL   le NOUVEAU webhook #sales (l'ancien a circulé en clair)
 *      CALENDAR_ID         facultatif : un autre agenda que l'agenda principal du compte
 * 5. App privée HubSpot : en plus des contacts et des deals, cocher l'écriture des
 *    notes et des rendez-vous (« meetings »). Sinon, contact et deal sont créés mais
 *    pas la note ni le rendez-vous (erreur 403 dans les journaux d'exécution).
 * 6. En haut, choisir la fonction « testSetup » > Exécuter > accepter les autorisations.
 *    Le journal doit afficher « OK » et le nombre de créneaux libres.
 * 7. « Déployer » > « Nouveau déploiement » > type « Application Web » :
 *      Exécuter en tant que : Moi
 *      Qui a accès : Tout le monde
 *    > Déployer > copier l'URL (https://script.google.com/macros/s/…/exec).
 * 8. Mettre cette URL dans API_URL, en tête de js/contact.js (front-legaleo-homepage).
 *
 * Modifier le script plus tard : « Déployer » > « Gérer les déploiements » > crayon >
 * Version : « Nouvelle version » > Déployer. L'URL ne change pas.
 * ======================================================================================
 *
 * Sécurité : l'URL de la web app est publique (la page doit l'appeler). Le script
 * revérifie donc tout : champs, créneau encore libre, champ piège anti-robot, délai
 * de remplissage, nombre de demandes par e-mail. Il ne renvoie jamais le détail d'une
 * erreur ni le contenu de l'agenda, seulement des horaires libres.
 */

// ============================ RÉGLAGES ============================
const CONFIG = {
  TZ: 'Europe/Paris',
  WEEKDAYS: [1, 2, 3, 4, 5],      // 1 = lundi … 5 = vendredi
  OPEN: '09:00',                   // premier créneau
  CLOSE: '18:00',                  // fin du dernier créneau
  SLOT_MIN: 30,                    // durée d'une démo (min), et pas entre deux créneaux
  BUFFER_MIN: 15,                  // battement avant / après un événement de l'agenda
  NOTICE_HOURS: 4,                 // pas de créneau dans les 4 h qui viennent
  HORIZON_DAYS: 10,                // jours ouvrés proposés

  HUBSPOT_PORTAL_ID: '147898530',
  HUBSPOT_OWNER_ID: '88882115',    // Mehdi TALEB (franchiseurs)
  LAWYER_OWNER_ID: '33055086',     // Jean-Philippe CHENARD (avocats)
  // Étape des deals franchiseur dans le pipeline de vente, retrouvée par son nom
  // (début du libellé, sans tenir compte de l'emoji). DEAL_STAGE_ID, si renseigné,
  // passe avant le nom (id interne : Réglages HubSpot > Objets > Deals > Pipelines).
  DEAL_PIPELINE: 'default',
  DEAL_STAGE_LABEL: 'Prospecting',
  DEAL_STAGE_ID: '',
  // Deal avocat dans le pipeline Partenaires : ids internes, à renseigner une fois le
  // pipeline créé (comme dans le script avocat). Vides : pas de deal avocat.
  PARTENAIRES_PIPELINE: '',
  PARTENAIRES_STAGE: '',
  // Propriétés HubSpot personnalisées (nom interne), null tant qu'elles n'existent pas
  HUBSPOT_PROPS: { outlets: null, stage: null },   // ex. 'nombre_pdv', 'situation_du_reseau'

  ENCHARGE_SCORE: 70,              // bande HOT, comme le script franchiseur

  // Agent Leo
  LEO_ENCHARGE_SCORE: { A: 70, B: 45 },   // priorité calculée par Leo ; C : pas de score
  LEO_MIN_FILL_MS: 1200,           // formulaire de Leo plus court que celui de la page
  // E-mail de confirmation de démo en plus de l'invitation Agenda (qui contient déjà
  // le lien Meet). Désactivé tant que l'autorisation d'envoi d'e-mails n'est pas
  // accordée par le compte de Mehdi. Pour l'activer : passer à true, ajouter
  // https://www.googleapis.com/auth/script.send_mail dans appsscript.json (oauthScopes),
  // lancer testSetup depuis le compte de Mehdi, puis déployer une nouvelle version.
  LEO_CONFIRM_MAIL: false,
  MAIL_FROM_NAME: 'Mehdi de Legaleo',
  MAIL_REPLY_TO: 'hello@legaleo.ai',

  MIN_FILL_MS: 3000,               // envoyé plus vite : robot
  RATE_MAX: 5,                     // demandes max par e-mail (créneau déjà pris compris)…
  RATE_WINDOW_S: 6 * 3600          // … sur 6 h
};
const OUTLETS = ['1 à 5', '6 à 30', '31 à 100', '100 et plus'];
// ===================================================================

function secret(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}
function calendarId() {
  return secret('CALENDAR_ID') || 'primary';
}
function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ============================ POINTS D'ENTRÉE ============================
// GET ?action=slots -> { ok, slots: [ISO…] }
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action !== 'slots') return json({ ok: false, error: 'invalid' });
  try {
    return json({ ok: true, slots: freeSlots(false) });
  } catch (err) {
    console.error('slots : ' + err);
    return json({ ok: false, error: 'server' });
  }
}

// POST (text/plain, JSON) { action: 'book' | 'message', … } -> { ok } | { ok: false, error }
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'invalid' });
  }
  try {
    if (data.action === 'leo' || data.action === 'leo-book') return json(leoPost(data));
    var lead = readLead(data);
    if (!lead) return json({ ok: false, error: 'invalid' });
    if (lead.bot) return json({ ok: true });            // robot : on fait comme si, sans rien faire
    if (!underRate(lead.email)) return json({ ok: false, error: 'rate' });
    if (data.action === 'book' && !lead.lawyer) return json(book(lead, data.start));
    if (data.action === 'message') {
      if (!lead.message) return json({ ok: false, error: 'invalid' });
      dispatch(lead, { kind: 'message' });
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid' });
  } catch (err) {
    console.error('post : ' + err);
    return json({ ok: false, error: 'server' });
  }
}

// ============================ CONTRÔLES ============================
function readLead(d) {
  function text(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  }
  var lead = {
    lawyer: d.profile === 'avocat',
    firstname: text(d.firstname, 80),
    lastname: text(d.lastname, 80),
    email: text(d.email, 120).toLowerCase(),
    company: text(d.company, 120),
    outlets: text(d.outlets, 20),
    stage: text(d.stage, 60),
    message: String(d.message == null ? '' : d.message).trim().slice(0, 2000)
  };
  // Champ piège rempli, ou formulaire rempli trop vite
  if (text(d.website, 200) || !(Number(d.elapsed) >= CONFIG.MIN_FILL_MS)) return { bot: true };
  if (!lead.firstname || !lead.lastname || !lead.company) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return null;
  if (lead.lawyer) {
    lead.outlets = '';
    lead.stage = '';
  } else if (OUTLETS.indexOf(lead.outlets) === -1) return null;
  return lead;
}

function underRate(email) {
  var cache = CacheService.getScriptCache();
  var key = 'rate:' + email;
  var count = Number(cache.get(key) || 0);
  if (count >= CONFIG.RATE_MAX) return false;
  cache.put(key, String(count + 1), CONFIG.RATE_WINDOW_S);
  return true;
}

// ============================ CRÉNEAUX ============================
// Créneaux libres (ISO, UTC) sur les HORIZON_DAYS prochains jours ouvrés, selon les
// horaires de CONFIG et les disponibilités de l'agenda (événements « occupé »).
// Mis en cache 60 s ; fresh = true relit l'agenda (avant une réservation).
function freeSlots(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var hit = cache.get('slots');
    if (hit) return JSON.parse(hit);
  }
  var earliest = Date.now() + CONFIG.NOTICE_HOURS * 3600e3;
  var candidates = [];
  workDays().forEach(function (day) {
    // Décalage horaire de Paris ce jour-là (+01:00 / +02:00), pris à midi
    var offset = Utilities.formatDate(new Date(day + 'T12:00:00Z'), CONFIG.TZ, 'XXX');
    for (var min = toMin(CONFIG.OPEN); min + CONFIG.SLOT_MIN <= toMin(CONFIG.CLOSE); min += CONFIG.SLOT_MIN) {
      var start = new Date(day + 'T' + pad(Math.floor(min / 60)) + ':' + pad(min % 60) + ':00' + offset);
      if (start.getTime() >= earliest) candidates.push(start);
    }
  });
  if (!candidates.length) return [];

  var slotMs = CONFIG.SLOT_MIN * 60e3;
  var bufferMs = CONFIG.BUFFER_MIN * 60e3;
  var busy = busyRanges(candidates[0], new Date(candidates[candidates.length - 1].getTime() + slotMs));
  var slots = candidates
    .filter(function (start) {
      var from = start.getTime() - bufferMs;
      var to = start.getTime() + slotMs + bufferMs;
      return !busy.some(function (b) { return b[0] < to && b[1] > from; });
    })
    .map(function (start) { return start.toISOString(); });

  cache.put('slots', JSON.stringify(slots), 60);
  return slots;
}

// Jours ouvrés à venir (aujourd'hui compris), au format yyyy-MM-dd, heure de Paris
function workDays() {
  var days = [];
  for (var i = 0; days.length < CONFIG.HORIZON_DAYS && i < 40; i++) {
    var date = new Date(Date.now() + i * 86400e3);
    var key = Utilities.formatDate(date, CONFIG.TZ, 'yyyy-MM-dd');
    var weekday = Number(Utilities.formatDate(date, CONFIG.TZ, 'u'));   // 1 = lundi
    if (CONFIG.WEEKDAYS.indexOf(weekday) !== -1 && days.indexOf(key) === -1) days.push(key);
  }
  return days;
}

// Plages occupées de l'agenda : [[débutMs, finMs]…]
function busyRanges(from, to) {
  var res = Calendar.Freebusy.query({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    timeZone: CONFIG.TZ,
    items: [{ id: calendarId() }]
  });
  var cal = res.calendars[calendarId()] || res.calendars[Object.keys(res.calendars)[0]];
  if (cal.errors && cal.errors.length) throw new Error('Freebusy : ' + JSON.stringify(cal.errors));
  return (cal.busy || []).map(function (b) {
    return [new Date(b.start).getTime(), new Date(b.end).getTime()];
  });
}

// « lundi 5 octobre à 16:00 » (Utilities.formatDate écrit les jours et mois en anglais)
var JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function frDate(date) {
  var f = function (pattern) { return Utilities.formatDate(date, CONFIG.TZ, pattern); };
  return JOURS[Number(f('u')) - 1] + ' ' + Number(f('d')) + ' ' + MOIS[Number(f('M')) - 1] + ' à ' + f('HH:mm');
}

function toMin(hhmm) {
  var p = hhmm.split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}
function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

// ============================ RÉSERVATION ============================
// opts (Leo) : { description, dispatch(ctx) } remplacent la description de l'événement
// et la diffusion de la page contact.
function book(lead, startIso, opts) {
  var start = new Date(startIso);
  if (isNaN(start.getTime())) return { ok: false, error: 'invalid' };
  var end = new Date(start.getTime() + CONFIG.SLOT_MIN * 60e3);
  var event;

  // Verrou : deux visiteurs ne peuvent pas prendre le même créneau
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (freeSlots(true).indexOf(start.toISOString()) === -1) return { ok: false, error: 'taken' };
    event = Calendar.Events.insert({
      summary: meetingTitle(lead),
      description: (opts && opts.description) ||
        lead.firstname + ' ' + lead.lastname + ' · ' + lead.company + '\n' +
        'Points de vente : ' + lead.outlets + (lead.stage ? ' (' + lead.stage + ')' : '') + '\n' +
        (lead.message ? '\nMessage :\n' + lead.message + '\n' : '') +
        '\nRéservé depuis la page contact de legaleo.ai.',
      start: { dateTime: start.toISOString(), timeZone: CONFIG.TZ },
      end: { dateTime: end.toISOString(), timeZone: CONFIG.TZ },
      attendees: [{ email: lead.email, displayName: lead.firstname + ' ' + lead.lastname }],
      guestsCanModify: false,
      conferenceData: { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
    }, calendarId(), { conferenceDataVersion: 1, sendUpdates: 'all' });
    CacheService.getScriptCache().remove('slots');
  } finally {
    lock.releaseLock();
  }

  var ctx = { kind: 'demo', start: start, end: end, meet: event.hangoutLink || '' };
  if (opts && opts.dispatch) opts.dispatch(ctx);
  else dispatch(lead, ctx);
  return { ok: true, meet: ctx.meet, label: frDate(start) };
}

// Titre du rendez-vous (agenda et HubSpot) :
// « Discovery Call - Camille Martin Crêperie Pivolane x Mehdi Legaleo »
function meetingTitle(lead) {
  return 'Discovery Call - ' + lead.firstname + ' ' + lead.lastname + ' ' + lead.company + ' x Mehdi Legaleo';
}

// ============================ DIFFUSION ============================
// HubSpot, Encharge, Slack : chacun isolé, une panne n'empêche pas les suivants
// (le rendez-vous, lui, est déjà dans l'agenda).
function dispatch(lead, ctx) {
  if (lead.lawyer) return dispatchLawyer(lead);
  var contactId = safe('contact', function () { return upsertHubspotContact(lead); });
  var dealId = safe('deal', function () { return createHubspotDeal(lead, contactId, ctx); });
  if (lead.message) safe('note', function () { return createHubspotNote(lead, contactId, dealId, ctx); });
  if (ctx.kind === 'demo') safe('meeting', function () { return createHubspotMeeting(lead, contactId, dealId, ctx); });
  safe('encharge', function () { pushToEncharge(lead, ctx); });
  safe('slack', function () { postToSlack(lead, contactId, ctx); });
}

// Avocat : même circuit que le script « Candidature avocat »
function dispatchLawyer(lead) {
  var contactId = safe('contact', function () { return upsertHubspotContact(lead); });
  var dealId = safe('deal', function () { return createLawyerDeal(lead, contactId); });
  safe('note', function () { return createHubspotNote(lead, contactId, dealId, { kind: 'message' }); });
  safe('encharge', function () { pushToEncharge(lead, { kind: 'message' }); });
  safe('slack', function () { postToSlack(lead, contactId, { kind: 'message' }); });
}

function safe(step, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(step + ' : ' + err);
    return null;
  }
}

// ============================ HUBSPOT ============================
function hubspot(method, path, body) {
  var res = UrlFetchApp.fetch('https://api.hubapi.com' + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret('HUBSPOT_TOKEN') },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), text: res.getContentText() };
}

function assoc(id, typeId) {
  return { to: { id: id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }] };
}

function ownerOf(lead) {
  return lead.lawyer ? CONFIG.LAWYER_OWNER_ID : CONFIG.HUBSPOT_OWNER_ID;
}

function upsertHubspotContact(lead) {
  var props = {
    email: lead.email,
    firstname: lead.firstname,
    lastname: lead.lastname,
    company: lead.company,
    hubspot_owner_id: ownerOf(lead),
    hs_lead_status: 'NEW'
  };
  if (lead.lawyer) props.jobtitle = 'Avocat';
  if (CONFIG.HUBSPOT_PROPS.outlets && lead.outlets) props[CONFIG.HUBSPOT_PROPS.outlets] = lead.outlets;
  if (CONFIG.HUBSPOT_PROPS.stage && lead.stage) props[CONFIG.HUBSPOT_PROPS.stage] = lead.stage;

  var res = hubspot('post', '/crm/v3/objects/contacts', { properties: props });
  if (res.code === 201) return JSON.parse(res.text).id;

  // Contact déjà existant (409) -> on récupère l'id et on (ré)assigne
  if (res.code === 409) {
    var m = res.text.match(/Existing ID:\s*(\d+)/);
    if (m) {
      // Client ou franchisé passé par Leo (support) : contact existant laissé tel quel
      if (!lead.keepOwner) {
        hubspot('patch', '/crm/v3/objects/contacts/' + m[1], {
          properties: { hubspot_owner_id: ownerOf(lead), hs_lead_status: 'NEW' }
        });
      }
      return m[1];
    }
  }
  console.error('HubSpot contact ' + res.code + ' : ' + res.text);
  return null;
}

function createHubspotDeal(lead, contactId, ctx) {
  var payload = {
    properties: {
      // Nomenclature des deals : seul le nom du client varie, le reste est fixe
      // (crochets compris), ex. « [New Business] - [Pierre Martin] - [Service Type] - … »
      dealname: '[New Business] - [' + lead.firstname + ' ' + lead.lastname + '] - [Service Type] - [Contract Length] - [Website Form]',
      pipeline: CONFIG.DEAL_PIPELINE,
      dealstage: dealStage(),             // « Prospecting 🔎 »
      hubspot_owner_id: CONFIG.HUBSPOT_OWNER_ID
    }
  };
  if (contactId) payload.associations = [assoc(contactId, 3)];   // deal -> contact
  var res = hubspot('post', '/crm/v3/objects/deals', payload);
  if (res.code === 201) return JSON.parse(res.text).id;
  console.error('HubSpot deal ' + res.code + ' : ' + res.text);
  return null;
}

// Id interne de l'étape DEAL_STAGE_LABEL, lu dans HubSpot et gardé 6 h en cache.
// Introuvable : repli sur « Qualification » (appointmentscheduled), pour ne pas
// perdre le deal, et erreur dans les journaux.
function dealStage() {
  if (CONFIG.DEAL_STAGE_ID) return CONFIG.DEAL_STAGE_ID;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('dealstage');
  if (hit) return hit;
  var res = hubspot('get', '/crm/v3/pipelines/deals/' + CONFIG.DEAL_PIPELINE);
  if (res.code === 200) {
    var want = CONFIG.DEAL_STAGE_LABEL.toLowerCase();
    var stage = (JSON.parse(res.text).stages || []).filter(function (st) {
      return st.label.toLowerCase().indexOf(want) === 0;
    })[0];
    if (stage) {
      cache.put('dealstage', stage.id, 6 * 3600);
      return stage.id;
    }
  }
  console.error('Étape « ' + CONFIG.DEAL_STAGE_LABEL + ' » introuvable (' + res.code + ') : deal créé en Qualification.');
  return 'appointmentscheduled';
}

function createLawyerDeal(lead, contactId) {
  if (!CONFIG.PARTENAIRES_PIPELINE || !CONFIG.PARTENAIRES_STAGE) {
    console.log('Deal avocat non créé : renseigner PARTENAIRES_PIPELINE + PARTENAIRES_STAGE (CONFIG).');
    return null;
  }
  var payload = {
    properties: {
      dealname: '[Partenaire avocat] ' + lead.firstname + ' ' + lead.lastname + ' — ' + lead.company,
      pipeline: CONFIG.PARTENAIRES_PIPELINE,
      dealstage: CONFIG.PARTENAIRES_STAGE,
      hubspot_owner_id: CONFIG.LAWYER_OWNER_ID
    }
  };
  if (contactId) payload.associations = [assoc(contactId, 3)];   // deal -> contact
  var res = hubspot('post', '/crm/v3/objects/deals', payload);
  if (res.code === 201) return JSON.parse(res.text).id;
  console.error('HubSpot deal avocat ' + res.code + ' : ' + res.text);
  return null;
}

function createHubspotNote(lead, contactId, dealId, ctx) {
  var associations = [];
  if (contactId) associations.push(assoc(contactId, 202));   // note -> contact
  if (dealId) associations.push(assoc(dealId, 214));         // note -> deal
  var title = ctx.kind === 'demo' ? 'Message joint à la réservation de démo'
    : lead.lawyer ? 'Message d\'un avocat depuis la page contact' : 'Message envoyé depuis la page contact';
  var res = hubspot('post', '/crm/v3/objects/notes', {
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_note_body: '<p><strong>' + title + '</strong></p><p>' + escapeHtml(lead.message).replace(/\n/g, '<br>') + '</p>',
      hubspot_owner_id: ownerOf(lead)
    },
    associations: associations
  });
  if (res.code !== 201) console.error('HubSpot note ' + res.code + ' : ' + res.text);
}

function createHubspotMeeting(lead, contactId, dealId, ctx) {
  var associations = [];
  if (contactId) associations.push(assoc(contactId, 200));   // meeting -> contact
  if (dealId) associations.push(assoc(dealId, 212));         // meeting -> deal
  var res = hubspot('post', '/crm/v3/objects/meetings', {
    properties: {
      hs_timestamp: ctx.start.toISOString(),
      hs_meeting_title: meetingTitle(lead),
      hs_meeting_body: lead.leo
        ? 'Réservée avec Leo (chat du site).' + (lead.outlets ? ' Points de vente : ' + lead.outlets + '.' : '')
        : 'Réservée depuis la page contact. Points de vente : ' + lead.outlets + '.',
      hs_meeting_location: ctx.meet,
      hs_meeting_start_time: ctx.start.toISOString(),
      hs_meeting_end_time: ctx.end.toISOString(),
      hs_meeting_outcome: 'SCHEDULED',
      hubspot_owner_id: CONFIG.HUBSPOT_OWNER_ID
    },
    associations: associations
  });
  if (res.code !== 201) console.error('HubSpot meeting ' + res.code + ' : ' + res.text);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================ ENCHARGE (tags + score HOT) ============================
// Mêmes tags que le script franchiseur, sauf la provenance :
//   demo-reservee / message-site au lieu de formulaire-contact.
// Avocat : comme le script avocat, tag lawyer (l'exclut des campagnes franchiseur et du
// scoring) + avocat-contact (provenance), et AUCUN leadScore.
function pushToEncharge(lead, ctx) {
  var headers = { 'X-Encharge-Token': secret('ENCHARGE_TOKEN') };
  var person = { email: lead.email, firstName: lead.firstname, lastName: lead.lastname };
  if (!lead.lawyer) person.leadScore = CONFIG.ENCHARGE_SCORE;
  UrlFetchApp.fetch('https://api.encharge.io/v1/people', {
    method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(person),
    muteHttpExceptions: true
  });
  var tags = lead.lawyer
    ? ['lawyer', 'avocat-contact']
    : ['lead-franchiseur', ctx.kind === 'demo' ? 'demo-reservee' : 'message-site', 'score-hot', 'hot-alerted'];
  tags.forEach(function (t) {
    var res = UrlFetchApp.fetch('https://api.encharge.io/v1/tags', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({ tag: t, email: lead.email }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) console.error('Encharge tag "' + t + '" ' + res.getResponseCode() + ' : ' + res.getContentText());
  });
}

// ============================ SLACK (#sales) ============================
function postToSlack(lead, contactId, ctx) {
  var link = contactId ? 'https://app.hubspot.com/contacts/' + CONFIG.HUBSPOT_PORTAL_ID + '/record/0-1/' + contactId : '';
  var head = lead.lawyer
    ? ':scales: *Message d\'un avocat* (page contact) — Me ' + lead.firstname + ' ' + lead.lastname
    : ctx.kind === 'demo'
      ? ':calendar: *Démo réservée* le ' + frDate(ctx.start) + ' — ' + lead.company
      : ':email: *Message depuis la page contact* — ' + lead.company;
  var text =
    head + '\n' +
    '• *' + lead.firstname + ' ' + lead.lastname + '* · ' + lead.email + '\n' +
    (lead.lawyer ? '• Cabinet : ' + lead.company + '\n'
      : '• Points de vente : ' + lead.outlets + (lead.stage ? ' (' + lead.stage + ')' : '') + '\n') +
    (ctx.meet ? '• Visio : ' + ctx.meet + '\n' : '') +
    (lead.message ? '• Message : ' + lead.message.slice(0, 500) + '\n' : '') +
    (link ? '• <' + link + '|Ouvrir la fiche HubSpot> — assigné à ' + (lead.lawyer ? 'Jean-Philippe' : 'Mehdi') + ' ✅' : '• ⚠️ Fiche HubSpot non créée, à vérifier (journaux d\'exécution)');
  UrlFetchApp.fetch(secret('SLACK_WEBHOOK_URL'), {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ text: text }), muteHttpExceptions: true
  });
}

// ============================ AGENT LEO (widget du site) ============================
// Le widget envoie { action: 'leo' | 'leo-book', type, next, coordonnées, réponses… }.
//   leo      : message ; ou démo dont le créneau n'est pas encore choisi (contact +
//              note + Slack, le deal vient avec la réservation)
//   leo-book : réservation d'un créneau (agenda, deal, rendez-vous, confirmation)
var LEO_TYPES = ['franchiseur', 'avocat', 'franchise', 'client'];
var LEO_NEXT = ['demo', 'message'];
var LEO_OUTLETS = { '1-5': '1 à 5', '6-30': '6 à 30', '31-100': '31 à 100', '100+': '100 et plus' };

function leoPost(data) {
  var lead = readLeoLead(data);
  if (!lead) return { ok: false, error: 'invalid' };
  if (lead.bot) return { ok: true };            // robot : on fait comme si, sans rien faire
  if (!underRate(lead.email)) return { ok: false, error: 'rate' };
  if (data.action === 'leo-book') {
    lead.next = 'demo';
    return book(lead, data.start, {
      description: leoEventDescription(lead),
      dispatch: function (ctx) { dispatchLeo(lead, ctx); }
    });
  }
  dispatchLeo(lead, { kind: lead.next === 'demo' ? 'pending' : lead.next });
  return { ok: true };
}

function readLeoLead(d) {
  function text(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  }
  function block(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
  }
  if (text(d.website, 200) || !(Number(d.elapsed) >= CONFIG.LEO_MIN_FILL_MS)) return { bot: true };
  var type = LEO_TYPES.indexOf(d.type) !== -1 ? d.type : 'contact';
  var lead = {
    leo: true,
    type: type,
    lawyer: type === 'avocat',
    prospect: type === 'franchiseur',
    // Client, franchisé ou visiteur non identifié : pas de deal, contact existant inchangé
    keepOwner: type !== 'franchiseur' && type !== 'avocat',
    next: LEO_NEXT.indexOf(d.next) !== -1 ? d.next : 'message',
    demande: text(d.demande, 30),
    firstname: text(d.firstname, 80),
    lastname: text(d.lastname, 80),
    email: text(d.email, 120).toLowerCase(),
    company: text(d.company, 120),
    interest: text(d.interest, 120),
    outlets: LEO_OUTLETS[d.taille] || '',
    stage: '',
    priority: ['A', 'B', 'C'].indexOf(d.priority) !== -1 ? d.priority : '',
    score: Number(d.score) || 0,
    answers: (Array.isArray(d.answers) ? d.answers : []).slice(0, 8).map(function (a) {
      return [text(a && a[0], 40), text(a && a[1], 80)];
    }).filter(function (a) { return a[0] && a[1]; }),
    summary: block(d.summary, 3000),
    message: block(d.message, 2000)
  };
  if (!lead.firstname || !lead.lastname) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return null;
  if (!lead.company && !lead.lawyer) return null;
  if (!lead.company) lead.company = 'Cabinet non précisé';
  return lead;
}

function dispatchLeo(lead, ctx) {
  var pending = ctx.kind === 'pending';
  var contactId = safe('contact', function () { return upsertHubspotContact(lead); });
  var dealId = null;
  if (!pending && lead.prospect) dealId = safe('deal', function () { return createHubspotDeal(lead, contactId, ctx); });
  if (!pending && lead.lawyer) dealId = safe('deal', function () { return createLawyerDeal(lead, contactId); });
  safe('note', function () { return createLeoNote(lead, contactId, dealId, ctx); });
  if (ctx.kind === 'demo') safe('meeting', function () { return createHubspotMeeting(lead, contactId, dealId, ctx); });
  if (!pending && (lead.prospect || lead.lawyer)) safe('encharge', function () { pushLeoToEncharge(lead, ctx); });
  safe('slack', function () { postLeoToSlack(lead, contactId, ctx); });
  if (ctx.kind === 'demo' && CONFIG.LEO_CONFIRM_MAIL) safe('mail', function () { sendLeoMail(lead, ctx); });
}

function leoEventDescription(lead) {
  return lead.firstname + ' ' + lead.lastname + ' · ' + lead.company + '\n' +
    (lead.answers.length ? '\n' + lead.answers.map(function (a) { return a[0] + ' : ' + a[1]; }).join('\n') + '\n' : '') +
    (lead.message ? '\nQuestion :\n' + lead.message + '\n' : '') +
    '\nRéservé avec Leo, l\'agent IA de legaleo.ai.';
}

var LEO_KIND_TITLE = {
  pending: 'Leo : démo demandée, créneau en cours de choix',
  demo: 'Leo : démo réservée',
  message: 'Leo : message'
};

function createLeoNote(lead, contactId, dealId, ctx) {
  var associations = [];
  if (contactId) associations.push(assoc(contactId, 202));   // note -> contact
  if (dealId) associations.push(assoc(dealId, 214));         // note -> deal
  var lines = [];
  if (lead.priority) lines.push('Priorité Leo : ' + lead.priority + ' (score ' + lead.score + '/100)');
  var body = '<p><strong>' + LEO_KIND_TITLE[ctx.kind] + '</strong></p>' +
    (lines.length ? '<p>' + lines.map(escapeHtml).join('<br>') + '</p>' : '') +
    '<p>' + escapeHtml(lead.summary || '').replace(/\n/g, '<br>') + '</p>';
  var res = hubspot('post', '/crm/v3/objects/notes', {
    properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body, hubspot_owner_id: ownerOf(lead) },
    associations: associations
  });
  if (res.code !== 201) console.error('HubSpot note Leo ' + res.code + ' : ' + res.text);
}

// Tags Encharge : provenance leo-chat + suite demandée ; score selon la priorité de Leo
// (A : HOT, comme la page contact ; B : tiède ; C : aucun). Avocat : comme la page.
function pushLeoToEncharge(lead, ctx) {
  var headers = { 'X-Encharge-Token': secret('ENCHARGE_TOKEN') };
  var person = { email: lead.email, firstName: lead.firstname, lastName: lead.lastname };
  var score = lead.prospect ? CONFIG.LEO_ENCHARGE_SCORE[lead.priority] : null;
  if (score) person.leadScore = score;
  UrlFetchApp.fetch('https://api.encharge.io/v1/people', {
    method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(person), muteHttpExceptions: true
  });
  var kindTag = ctx.kind === 'demo' ? 'demo-reservee' : 'message-site';
  var tags = lead.lawyer
    ? ['lawyer', 'avocat-leo']
    : ['lead-franchiseur', 'leo-chat', kindTag]
      .concat(lead.priority === 'A' ? ['score-hot', 'hot-alerted'] : lead.priority === 'B' ? ['score-warm'] : []);
  tags.forEach(function (t) {
    var res = UrlFetchApp.fetch('https://api.encharge.io/v1/tags', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({ tag: t, email: lead.email }), muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) console.error('Encharge tag "' + t + '" ' + res.getResponseCode() + ' : ' + res.getContentText());
  });
}

function postLeoToSlack(lead, contactId, ctx) {
  var link = contactId ? 'https://app.hubspot.com/contacts/' + CONFIG.HUBSPOT_PORTAL_ID + '/record/0-1/' + contactId : '';
  var icon = { pending: ':hourglass_flowing_sand:', demo: ':calendar:', message: ':speech_balloon:' }[ctx.kind];
  var who = { franchiseur: '', avocat: ' · avocat', franchise: ' · franchisé', client: ' · client (support)', contact: '' }[lead.type] || '';
  var head = icon + ' *' + LEO_KIND_TITLE[ctx.kind] + '*' + (ctx.kind === 'demo' ? ' le ' + frDate(ctx.start) : '') + ' — ' + lead.company + who;
  var text =
    head + '\n' +
    '• *' + lead.firstname + ' ' + lead.lastname + '* · ' + lead.email + '\n' +
    (lead.priority ? '• Priorité *' + lead.priority + '* (score ' + lead.score + '/100)\n' : '') +
    lead.answers.map(function (a) { return '• ' + a[0] + ' : ' + a[1] + '\n'; }).join('') +
    (lead.interest ? '• Attente : ' + lead.interest + '\n' : '') +
    (ctx.meet ? '• Visio : ' + ctx.meet + '\n' : '') +
    (lead.message ? '• Message : ' + lead.message.slice(0, 500) + '\n' : '') +
    (link ? '• <' + link + '|Ouvrir la fiche HubSpot> — assigné à ' + (lead.lawyer ? 'Jean-Philippe' : 'Mehdi') + ' ✅' : '• ⚠️ Fiche HubSpot non créée, à vérifier (journaux d\'exécution)');
  UrlFetchApp.fetch(secret('SLACK_WEBHOOK_URL'), {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ text: text }), muteHttpExceptions: true
  });
}

// ---- E-mail de confirmation de démo (compte du script : Mehdi), réponse vers
// hello@legaleo.ai : le lien Meet et les réponses du prospect, en plus de l'invitation.
function sendLeoMail(lead, ctx) {
  var answers = lead.answers.length
    ? '<p style="margin:24px 0 8px;font-weight:700">Ce que vous nous avez dit</p><ul style="margin:0;padding-left:20px">' +
      lead.answers.map(function (a) { return '<li>' + escapeHtml(a[0]) + ' : ' + escapeHtml(a[1]) + '</li>'; }).join('') + '</ul>'
    : '';
  var meet = ctx.meet
    ? '<p style="margin:24px 0"><a href="' + escapeHtml(ctx.meet) + '" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#087f83;color:#fff;font-weight:700;text-decoration:none">Rejoindre la visio</a></p>' +
      '<p style="color:#6f6757;font-size:14px">Lien de la visio : <a href="' + escapeHtml(ctx.meet) + '">' + escapeHtml(ctx.meet) + '</a>. L\'invitation est aussi dans votre agenda.</p>'
    : '<p>L\'invitation, avec le lien de la visio, est dans votre agenda.</p>';
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f120e;max-width:560px">' +
    '<p>Bonjour ' + escapeHtml(lead.firstname) + ',</p>' +
    '<p>Votre démo est confirmée <strong>' + escapeHtml(frDate(ctx.start)) + '</strong> (heure de Paris) : 30 minutes en visio avec Mehdi, co-fondateur de Legaleo, ' +
      (lead.lawyer ? 'sur votre pratique et vos clients franchiseurs' : 'sur le cas de votre réseau') + '.</p>' +
    meet +
    '<p>Rien à préparer. Si vous avez un DIP ou un contrat existant, gardez-le sous la main : on vous montre comment il se reprend dans la plateforme.</p>' +
    answers +
    '<p style="margin-top:28px">À très vite,<br>Mehdi Taleb<br><span style="color:#6f6757">Co-fondateur, Legaleo</span></p></div>';
  MailApp.sendEmail({
    to: lead.email,
    subject: 'Votre démo Legaleo, ' + frDate(ctx.start),
    htmlBody: html,
    name: CONFIG.MAIL_FROM_NAME,
    replyTo: CONFIG.MAIL_REPLY_TO
  });
}

// ============================ TEST D'INSTALLATION ============================
// À lancer une fois depuis l'éditeur (étape 6) : autorisations + vérifications.
// Ne crée rien, n'envoie rien.
function testSetup() {
  ['HUBSPOT_TOKEN', 'ENCHARGE_TOKEN', 'SLACK_WEBHOOK_URL'].forEach(function (name) {
    console.log(name + ' : ' + (secret(name) ? 'renseignée' : '⚠️ MANQUANTE'));
  });
  console.log('Étape des deals : ' + dealStage() + ' (« ' + CONFIG.DEAL_STAGE_LABEL + ' »)');
  if (CONFIG.LEO_CONFIRM_MAIL) try {
    console.log('E-mails (Leo) : ' + MailApp.getRemainingDailyQuota() + ' envois restants aujourd\'hui');
  } catch (err) {
    console.error('⚠️ E-mails (Leo) bloqués : ' + err.message +
      ' -> ajouter https://www.googleapis.com/auth/script.send_mail dans appsscript.json (oauthScopes), puis relancer testSetup.');
  }
  var slots = freeSlots(true);
  console.log('OK · ' + slots.length + ' créneaux libres, premier : ' +
    (slots[0] ? frDate(new Date(slots[0])) : 'aucun'));
}
