const fs = require("fs/promises")
const path = require("path")
const dotenv = require("dotenv");

dotenv.config();

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const COMPANIES = process.env.COMPANIES
  .replaceAll(" ", "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 300000); // 5 min
const MAX_RESULTS_PER_COMPANY = Number(process.env.MAX_RESULTS_PER_COMPANY || 10);
const STATE_FILE_PATH = process.env.STATE_FILE_PATH || "bodacc_seen_multi.json";

function buildBodaccUrl(company) {
  const c = encodeURIComponent(company);
  const q = encodeURIComponent(`#search(commercant,"${company}")`);
  return `https://www.bodacc.fr/api/records/1.0/search/?disjunctive.typeavis=true&disjunctive.familleavis=true&disjunctive.publicationavis=true&disjunctive.region_min=true&disjunctive.nom_dep_min=true&disjunctive.numerodepartement=true&sort=dateparution&commercant_search=${c}&rows=${MAX_RESULTS_PER_COMPANY}&dataset=annonces-commerciales&q=${q}&timezone=Europe%2FBerlin&lang=fr`;
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const seen = {};
    for (const k of Object.keys(parsed.seen || {})) {
      seen[k] = new Set(parsed.seen[k]);
    }
    return { updatedAt: parsed.updatedAt || null, seen };
  } catch {
    return { updatedAt: null, seen: {} };
  }
}

async function saveState(state) {
  const out = {
    updatedAt: new Date().toISOString(),
    seen: Object.fromEntries(
      Object.entries(state.seen).map(([k, set]) => [k, Array.from(set)])
    ),
  };
  await fs.writeFile(STATE_FILE_PATH, JSON.stringify(out, null, 2), "utf-8");
}

function parseJSONMaybe(str) {
  if (!str) return undefined;
  try { return JSON.parse(str); } catch { return undefined; }
}

function buildDiscordEmbed(rec) {
  const f = rec.fields || {};
  const lp = parseJSONMaybe(f.listepersonnes);
  const personne = lp?.personne;
  const denom = f.commercant || personne?.denomination || personne?.nom || "—";
  const titre = `${denom} — ${f.familleavis_lib || "Annonce"}`;
  const url = f.url_complete || "https://www.bodacc.fr/";
  const ville = f.ville || personne?.adresseSiegeSocial?.ville || "—";
  const cp = f.cp || personne?.adresseSiegeSocial?.codePostal || "—";
  const tribunal = f.tribunal || "—";
  const dateparution = f.dateparution || "—";
  const registre = f.registre || personne?.numeroImmatriculation?.numeroIdentification || "—";
  const typeavis = f.publicationavis_facette || f.typeavis_lib || f.typeavis || "—";

  let desc = "";
  const mg = parseJSONMaybe(f.modificationsgenerales);
  if (mg?.descriptif) desc += `**Modif. :** ${mg.descriptif}\n`;

  const dep = parseJSONMaybe(f.depot);
  if (dep?.typeDepot) {
    desc += `**Dépôt :** ${dep.typeDepot}${dep?.dateCloture ? ` (${dep.dateCloture})` : ""}\n`;
    if (dep?.descriptif) desc += `${dep.descriptif}\n`;
  }

  return {
    title: titre,
    url,
    description: desc || undefined,
    timestamp: new Date().toISOString(),
    fields: [
      { name: "Type / Publication", value: `${typeavis}`, inline: true },
      { name: "Date parution", value: `${dateparution}`, inline: true },
      { name: "Ville / CP", value: `${ville} ${cp}`, inline: true },
      { name: "Tribunal", value: `${tribunal}`, inline: true },
      { name: "Registre / RCS", value: `${registre}`, inline: true },
      { name: "Département", value: `${f.departement_nom_officiel || "—"} (${f.numerodepartement || "—"})`, inline: true },
    ],
    footer: { text: `BODACC • dataset: ${rec.datasetid}` }
  };
}

async function postToDiscord(embeds) {
  // Discord autorise 10 embeds / message
  for (let i = 0; i < embeds.length; i += 10) {
    const chunk = embeds.slice(i, i + 10);
    const payload = {
      username: "BODACC Watcher", // custom sender name
      avatar_url: "https://static.data.gouv.fr/images/2015-07-01/d24a62fce1194aa18e662d696c2faa7b/nbouton_bodacc-500.png", // Bodacc logo
      embeds: chunk
    };

    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Discord webhook error: ${res.status} ${res.statusText} – ${t}`);
    }
  }
}

async function fetchBodacc(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Bodacc fetch error: ${res.status} ${res.statusText} – ${t}`);
  }
  return res.json();
}

function sortRecords(records) {
  return records.slice().sort((a, b) => {
    const da = a.fields?.dateparution || "";
    const db = b.fields?.dateparution || "";
    if (da < db) return 1;
    if (da > db) return -1;
    const na = a.fields?.numeroannonce || 0;
    const nb = b.fields?.numeroannonce || 0;
    return nb - na;
  });
}

async function processCompany(state, company) {
  const url = buildBodaccUrl(company);
  const data = await fetchBodacc(url);
  const records = Array.isArray(data.records) ? sortRecords(data.records) : [];

  if (!state.seen[company]) state.seen[company] = new Set();
  const seenSet = state.seen[company];

  const newOnes = records.filter(r => r.recordid && !seenSet.has(r.recordid));
  if (newOnes.length === 0) {
    console.log(`[${company}] Aucun nouveau résultat.`);
    return;
  }

  const embeds = newOnes.map(buildDiscordEmbed);
  await postToDiscord(embeds);

  newOnes.forEach(r => seenSet.add(r.recordid));
  console.log(`[${company}] ${newOnes.length} nouveau(x) envoi(s) vers Discord.`);
}

async function tick() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("Variable d'environnement manquante: DISCORD_WEBHOOK_URL");
    process.exit(1);
  }
  if (COMPANIES.length === 0) {
    console.error("Aucune entreprise dans COMPANIES.");
    process.exit(1);
  }

  const state = await loadState();

  for (const company of COMPANIES) {
    try {
      await processCompany(state, company);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`[${company}]`, e);
    }
  }

  await saveState(state);
}

async function main() {
  console.log(`Watcher BODACC multi-entreprises démarré. Entreprises: ${COMPANIES.join(", ")}`);
  try {
    await tick();
  } catch (e) {
    console.error(e);
  }
  setInterval(async () => {
    try {
      await tick();
    } catch (e) {
      console.error(e);
    }
  }, POLL_INTERVAL_MS);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});