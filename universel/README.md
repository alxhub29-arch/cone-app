# PaysaPro : l'app de chantier universelle pour paysagistes

Version générique (marque blanche) de l'app CŌNE. Chaque paysagiste la met à son nom au premier lancement :
nom de l'entreprise, petite phrase, logo, 3 couleurs (ou un des 6 thèmes), pays et TVA, tarif horaire,
frais mis d'office, prestations et prix, types de travail et étapes, machines, décharges, ouvriers.

Aucune donnée de CŌNE ni de ses clients n'est dans ce code. L'app CŌNE perso (artifact claude.ai) n'est pas touchée.

## Fonctions
Clients, chantiers (régie ou devis), devis, décomptes à l'heure, sous-traitance (option), contrats d'entretien,
photos avant/pendant/après, bénéfice par chantier, messages clients (SMS, WhatsApp, e-mail), Google Maps, exports CSV.

## Données
Tout reste sur l'appareil (IndexedDB, sinon localStorage). Sauvegarde et restauration par fichier JSON dans Réglages.

## Équipe
Le patron envoie un chantier à un ouvrier par WhatsApp (lien `#m=…`, sans aucun prix).
L'ouvrier renvoie son rapport de la même façon (lien `#r=…`). Si le lien s'ouvre ailleurs que dans l'app,
on colle le message dans l'app (« Coller un message »).

## Fichiers
- `universel/app.html` : source de l'app (aussi publiable telle quelle comme artifact).
- `universel/build.py` : génère `docs/pro/index.html` (version GitHub Pages, installable sur l'écran d'accueil).
- `docs/pro/` : page web, manifest et icônes.
