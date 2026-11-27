// CŌNE : calcul des créneaux de visite proposés par l'agent WhatsApp.
// Logique pure (aucun accès réseau) : testable avec `node --experimental-strip-types`.

export type Regles = {
  heuresJourLibre: string[];     // créneaux d'un jour sans chantier
  heuresJourChantier: string[];  // créneaux d'un jour avec chantier (fin de journée)
  samedi: string[];              // créneaux du samedi ([] = fermé)
  delaiMinHeures: number;        // délai minimum avant une visite
  horizonJours: number;          // jusqu'où l'agent peut proposer
  maxVisitesParJour: number;
  ecartMinutes: number;          // écart minimum entre deux visites
  joursBloques: string[];        // "AAAA-MM-JJ" (congés, indisponibilités)
};

export const REGLES_DEFAUT: Regles = {
  heuresJourLibre: ["09:00", "11:00", "14:00", "16:00"],
  heuresJourChantier: ["17:30", "18:30"],
  samedi: [],
  delaiMinHeures: 48,
  horizonJours: 21,
  maxVisitesParJour: 2,
  ecartMinutes: 60,
  joursBloques: [],
};

export type Chantier = { date?: string; dateFin?: string; statut?: string };
export type Rdv = { date?: string; heure?: string; statut?: string };
export type Creneau = { date: string; heure: string; jourChantier: boolean };

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** "AAAA-MM-JJ HH:MM" à l'heure de Bruxelles pour un instant donné. */
export function heureBruxelles(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function ajouterJours(jour: string, n: number): string {
  const d = new Date(jour + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function jourSemaine(jour: string): number {
  return new Date(jour + "T12:00:00Z").getUTCDay();
}

function minutes(h: string): number {
  const [a, b] = h.split(":").map(Number);
  return a * 60 + b;
}

export function libelle(c: { date: string; heure: string }): string {
  const d = new Date(c.date + "T12:00:00Z");
  const h = c.heure.replace(":00", "h").replace(":", "h");
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} à ${h}`;
}

export function rdvActif(r: Rdv): boolean {
  return !!r.date && !!r.heure && !/annul|refus/i.test(r.statut || "");
}

/** Jours occupés par un chantier (de date à dateFin inclus). */
export function joursChantier(chantiers: Chantier[]): Set<string> {
  const s = new Set<string>();
  for (const c of chantiers) {
    if (!c.date || /annul/i.test(c.statut || "")) continue;
    const fin = c.dateFin && c.dateFin > c.date ? c.dateFin : c.date;
    for (let j = c.date, i = 0; j <= fin && i < 120; j = ajouterJours(j, 1), i++) s.add(j);
  }
  return s;
}

/** Créneaux libres entre du et au (inclus), triés. */
export function creneauxLibres(opts: {
  maintenant: Date; chantiers: Chantier[]; rdvs: Rdv[]; regles?: Partial<Regles>;
  du?: string; au?: string;
}): Creneau[] {
  const r: Regles = { ...REGLES_DEFAUT, ...(opts.regles || {}) };
  const min = heureBruxelles(new Date(opts.maintenant.getTime() + r.delaiMinHeures * 3600e3));
  const aujourdhui = heureBruxelles(opts.maintenant).slice(0, 10);
  const limite = ajouterJours(aujourdhui, r.horizonJours);
  const du = opts.du && opts.du > aujourdhui ? opts.du : aujourdhui;
  const au = opts.au && opts.au < limite ? opts.au : limite;
  const occupes = joursChantier(opts.chantiers);
  const actifs = opts.rdvs.filter(rdvActif);
  const out: Creneau[] = [];
  for (let j = du; j <= au; j = ajouterJours(j, 1)) {
    const js = jourSemaine(j);
    if (js === 0 || r.joursBloques.includes(j)) continue;
    const ceJour = actifs.filter((x) => x.date === j);
    if (ceJour.length >= r.maxVisitesParJour) continue;
    const chantier = occupes.has(j);
    const heures = js === 6 ? r.samedi : chantier ? r.heuresJourChantier : r.heuresJourLibre;
    for (const h of heures) {
      if (`${j} ${h}` < min) continue;
      if (ceJour.some((x) => Math.abs(minutes(x.heure!) - minutes(h)) < r.ecartMinutes)) continue;
      out.push({ date: j, heure: h, jourChantier: chantier });
    }
  }
  return out;
}
