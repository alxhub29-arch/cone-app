# CŌNE

Application de chantier de CŌNES Colors (paysagiste et homme à tout faire, Belgique), autonome : elle s'ouvre directement sur https://alxhub29-arch.github.io/cone-app/ et s'installe en plein écran sur l'iPhone (Safari › Partager › « Sur l'écran d'accueil »).

- **Données** : gardées sur l'appareil (IndexedDB, marche sans réseau) et synchronisées entre appareils et ouvriers via Supabase quand `outils/supabase.json` est renseigné. Aucune donnée client n'est dans ce dépôt.
- **Accès** : le premier compte créé est le patron ; les ouvriers créent leur accès et le patron les accepte (Réglages › Équipe). Les ouvriers ne voient que leurs missions, sans prix.
- **IA** (scanner de plantes, lecture des tickets) : facultative, avec une clé Claude saisie dans Réglages, gardée sur l'appareil.

## Construire

`docs/index.html` est généré à partir de la source de l'app :

```
python3 outils/build.py <cone-app.html> docs
```

`outils/supabase-installation.sql` crée la base (tables, règles d'accès, stockage des photos) : à coller une fois dans Supabase › SQL Editor.

Hébergement : GitHub Pages, branche `main`, dossier `/docs`.
