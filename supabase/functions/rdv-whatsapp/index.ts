// CŌNE : fonction Supabase appelée par l'agent WhatsApp (Kapso) pour
// lire les créneaux libres et noter les rendez-vous de visite.
//
// Secrets (Supabase › Edge Functions › Secrets), JAMAIS dans ce repo :
//   CONE_AGENT_SECRET  : mot de passe partagé avec les outils de l'agent Kapso
//   (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement)
//
// Déploiement : supabase functions deploy rdv-whatsapp --no-verify-jwt
// Appel : POST JSON { "action": "creneaux" | "reserver" | "mes_rdv" | "annuler", ... }
//         avec l'en-tête  x-cone-secret: <CONE_AGENT_SECRET>

import { creneauxLibres, heureBruxelles, libelle, rdvActif, type Regles } from "./creneaux.ts";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("CONE_AGENT_SECRET") || "";

type Doc<T> = { id: string; data: T };

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: CLE, authorization: `Bearer ${CLE}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.status === 204 || init.method === "POST" ? null : r.json();
}

async function lire<T>(col: string): Promise<Doc<T>[]> {
  const rows = await sb(`docs?select=id,data&col=eq.${encodeURIComponent(col)}&deleted=eq.false&limit=5000`);
  return (rows as Doc<T>[]).filter((r) => r.data);
}

async function ecrire(col: string, id: string, data: unknown) {
  await sb("docs", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ col, id, data, deleted: false }]),
  });
}

async function regles(): Promise<Partial<Regles>> {
  const r = await lire<{ regles?: Partial<Regles> }>("reglages");
  return r.find((x) => x.id === "agent-rdv")?.data?.regles || {};
}

function egal(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const tel = (t: unknown) => String(t || "").replace(/[^\d+]/g, "");
const txt = (t: unknown, n = 300) => String(t ?? "").trim().slice(0, n);
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erreur: "POST uniquement" }, 405);
  if (!SECRET || !egal(req.headers.get("x-cone-secret") || "", SECRET)) return json({ erreur: "non autorisé" }, 401);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ erreur: "JSON invalide" }, 400); }

  try {
    const maintenant = new Date();
    const [chantiers, rdvs, r] = await Promise.all([lire<any>("chantiers"), lire<any>("rdv"), regles()]);
    const libres = () => creneauxLibres({
      maintenant, chantiers: chantiers.map((c) => c.data), rdvs: rdvs.map((x) => x.data), regles: r,
      du: txt(b.du, 10) || undefined, au: txt(b.au, 10) || undefined,
    });
    const aVenir = (t: string) => rdvs.filter((x) => tel(x.data.telephone) === t && rdvActif(x.data) &&
      `${x.data.date} ${x.data.heure}` >= heureBruxelles(maintenant));

    switch (b.action) {
      case "creneaux": {
        const c = libres().slice(0, Number(b.max) > 0 ? Math.min(Number(b.max), 30) : 12);
        return json({ creneaux: c.map((x) => ({ date: x.date, heure: x.heure, libelle: libelle(x) })) });
      }
      case "reserver": {
        const t = tel(b.telephone), date = txt(b.date, 10), heure = txt(b.heure, 5);
        if (!t || !date || !heure) return json({ ok: false, erreur: "telephone, date et heure obligatoires" }, 400);
        if (!txt(b.adresse)) return json({ ok: false, erreur: "adresse du jardin ou du chantier obligatoire" }, 400);
        const deja = aVenir(t);
        if (deja.length) return json({ ok: false, erreur: "ce client a déjà un rendez-vous à venir", rdv: deja.map((x) => ({ id: x.id, libelle: libelle(x.data) })) });
        if (!libres().some((x) => x.date === date && x.heure === heure)) {
          return json({ ok: false, erreur: "créneau plus disponible", creneaux: libres().slice(0, 6).map((x) => ({ date: x.date, heure: x.heure, libelle: libelle(x) })) });
        }
        const id = "wa" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const data = {
          date, heure, telephone: t, nom: txt(b.nom, 120), adresse: txt(b.adresse), travaux: txt(b.travaux, 1000),
          type: "visite devis", statut: "provisoire", source: "whatsapp", cree: maintenant.toISOString(),
        };
        await ecrire("rdv", id, data);
        return json({ ok: true, id, libelle: libelle(data), statut: "provisoire",
          message: "Rendez-vous noté, Alexandre le confirme rapidement." });
      }
      case "mes_rdv": {
        const t = tel(b.telephone);
        return json({ rdv: aVenir(t).map((x) => ({ id: x.id, libelle: libelle(x.data), statut: x.data.statut })) });
      }
      case "annuler": {
        const t = tel(b.telephone), id = txt(b.id, 40);
        const x = aVenir(t).find((y) => y.id === id);
        if (!x) return json({ ok: false, erreur: "rendez-vous introuvable pour ce numéro" }, 404);
        await ecrire("rdv", id, { ...x.data, statut: "annulé par le client", annuleLe: maintenant.toISOString() });
        return json({ ok: true, libelle: libelle(x.data) });
      }
      default:
        return json({ erreur: "action inconnue" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ erreur: "erreur interne" }, 500);
  }
});
