# Agent WhatsApp de rendez-vous CŌNE

Le client écrit sur WhatsApp → **Kapso** (API officielle WhatsApp de Meta) → **agent IA**
(nœud « agent » d'un workflow Kapso, consignes dans `consignes-agent.md`) → outils web vers
la fonction Supabase **`rdv-whatsapp`** (`../supabase/functions/rdv-whatsapp/`) qui lit les
chantiers de l'app et écrit les rendez-vous dans la collection `rdv` (statut « provisoire »).
Alexandre valide ensuite dans l'app.

## Règles des créneaux (modifiables)
Par défaut (`creneaux.ts`, `REGLES_DEFAUT`) : jour sans chantier 9h, 11h, 14h, 16h ;
jour de chantier 17h30, 18h30 ; samedi fermé ; jamais le dimanche ; 48 h à l'avance ;
3 semaines maximum ; 2 visites par jour ; 1 h d'écart. On peut les changer sans toucher
au code avec un document `reglages / agent-rdv` : `{ "regles": { "samedi": ["09:00","11:00"] } }`.

## Outils à déclarer dans le nœud agent (webhook tools)
Tous en `POST` vers `https://<projet>.supabase.co/functions/v1/rdv-whatsapp`,
en-tête `x-cone-secret` = la valeur du secret `CONE_AGENT_SECRET` (saisie dans Kapso,
jamais dans ce repo).

| Outil | Corps JSON |
|---|---|
| `creneaux` | `{"action":"creneaux","du":"AAAA-MM-JJ?","au":"AAAA-MM-JJ?"}` |
| `reserver` | `{"action":"reserver","date","heure","nom","adresse","travaux","telephone"}` |
| `mes_rdv` | `{"action":"mes_rdv","telephone"}` |
| `annuler` | `{"action":"annuler","telephone","id"}` |

## Modèles de messages à faire approuver par Meta (catégorie « utilitaire »)
- `cone_rdv_confirme` : « Bonjour {{1}}, votre visite CŌNE est confirmée le {{2}} à l'adresse {{3}}. À bientôt ! Alexandre 🌿 »
- `cone_rdv_rappel` : « Bonjour {{1}}, petit rappel : visite CŌNE demain {{2}}. Répondez à ce message si vous devez changer l'heure. »
- `cone_rdv_deplace` : « Bonjour {{1}}, Alexandre doit déplacer votre visite. Nouveau créneau proposé : {{2}}. Répondez OK ou proposez un autre moment. »

## Mise en route
1. Supabase › SQL : rien à créer (la table `docs` existe déjà).
2. Supabase › Edge Functions › Secrets : ajouter `CONE_AGENT_SECRET` (longue valeur aléatoire).
3. Déployer : `supabase functions deploy rdv-whatsapp --no-verify-jwt`.
4. Kapso : workflow « déclencheur message entrant » → nœud agent (consignes + 4 outils + handoff_to_human).
5. Tester **uniquement** depuis le téléphone d'Alexandre avant d'annoncer le numéro.
