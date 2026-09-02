# Miss Supatool

[![CI](https://github.com/mister-guiiug/miss-supatool/actions/workflows/ci.yml/badge.svg)](https://github.com/mister-guiiug/miss-supatool/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Migrer un projet Supabase vers un autre**, depuis une page web : créer le
projet cible, y recopier la structure de la base, puis y verser les lignes des
tables et les fichiers des seaux de stockage.

👉 <https://mister-guiiug.github.io/miss-supatool/>

---

## Ce que fait l'outil

| Étape         | Ce qu'elle fait                                                                                                                                        | Ce qu'il faut                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| **Projets**   | Brancher la source et la cible — ou **créer le projet cible** sur votre compte, attendre son démarrage et récupérer sa clé de service automatiquement. | Clés de service · relais + jeton  |
| **Contenu**   | Comparer les deux schémas, choisir les tables et les seaux, calculer l'ordre de copie sur les clés étrangères.                                         | Clés de service                   |
| **Structure** | Relever la structure de la source (tables, contraintes, index, vues, fonctions, déclencheurs, RLS, droits) et la **créer dans la cible**.              | Relais + jeton                    |
| **Copie**     | Verser les lignes et les fichiers, en simulation d'abord.                                                                                              | Clés de service                   |
| **Rapport**   | Le bilan, exportable — et la remise à niveau des séquences.                                                                                            | Relais + jeton pour les séquences |

La copie des **données** ne demande rien d'autre que les deux clés de service.
La création de projet et la copie de **structure** passent par l'API de
management, donc par un relais : voir [Pourquoi un relais](#pourquoi-un-relais).

### Ce qu'il ne copie pas

| Non copié                                                           | Pourquoi, et quoi faire à la place                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Les **comptes** (`auth.users`)                                      | Le schéma `auth` n'est pas exposé par l'API REST. Utilisez l'API d'administration Auth ou l'outil de migration officiel.        |
| Les objets **hors du schéma choisi** (`storage`, `auth`, `cron`…)   | Le relevé est borné au schéma sélectionné, `public` par défaut. Les politiques de `storage.objects` sont donc à rejouer à part. |
| Les **tables partitionnées**, les **domaines**, les **collations**  | Non relevés : leur recréation fidèle demande plus que ce que l'introspection utilisée ici rend.                                 |
| Les **secrets** (Vault), les **tâches cron**, les **rôles**         | Ce sont des réglages de compte ou d'extension, pas de la structure de schéma.                                                   |
| Les **métadonnées d'objets** (propriétaire, en-têtes personnalisés) | L'API Storage ne les rejoue pas. Le contenu et le type MIME sont préservés.                                                     |

## Comment la structure est copiée

Le relevé **demande à Postgres de se décrire lui-même** :
`pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_viewdef`,
`pg_get_functiondef`, `pg_get_triggerdef` rendent les définitions exactes,
telles que Postgres les réécrirait. Seule la liste des colonnes d'un
`CREATE TABLE` est recomposée — identité, colonnes calculées et valeurs par
défaut comprises.

Trois propriétés en découlent :

- **Le relevé ne peut rien modifier** : les requêtes partent avec
  `read_only: true`, refusé côté serveur à la moindre écriture. C'est le
  prolongement, en SQL, de l'invariant « la source n'est jamais écrite ».
- **Les instructions sont rejouables.** Une contrainte, une politique ou un type
  déjà présents sont ignorés, pas remplacés ; rien n'est supprimé. Relancer une
  copie de structure interrompue reprend là où elle s'était arrêtée.
- **Chaque instruction part séparément**, et une **seconde passe** rejoue les
  échecs — ce qui rattrape les dépendances qu'aucun ordre statique ne peut
  connaître (une vue qui en lit une autre). Ce qui échoue deux fois est rapporté
  comme une vraie erreur, avec son message.

## Pourquoi un relais

Les API **de projet** de Supabase acceptent les requêtes venues d'une autre
origine, et c'est ce qui rend la copie de données possible sans rien installer :

- **PostgREST** (`/rest/v1`) publie sa description OpenAPI — tables, colonnes,
  clés primaires et **clés étrangères**, de quoi ordonner les insertions ;
- l'**API Storage** (`/storage/v1`) liste, télécharge et téléverse les objets.

L'API de **management** (`api.supabase.com`), elle, n'accorde le CORS qu'à
`https://supabase.com` — vérifiable en une commande :

```bash
curl -si -X OPTIONS https://api.supabase.com/v1/organizations -H 'Origin: https://exemple.fr' -H 'Access-Control-Request-Method: GET' | grep -i allow-origin
```

Aucune ligne ne sort : le navigateur bloquera. Or créer un projet et exécuter du
DDL passent par elle. Il faut donc un intermédiaire — et il est fourni :

| Contexte                                   | Ce qu'il faut faire                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| **En local** (`npm run dev`)               | **Rien.** Le serveur Vite relaie déjà.                                                 |
| **Sur GitHub Pages** ou tout site statique | Déployer le Worker de [`proxy/`](./proxy/README.md), puis poser `VITE_SUPABASE_PROXY`. |

Le site publié a le sien depuis le 02/09/2026 : toutes les étapes y sont donc
actives. Sur un déploiement sans relais, la création de projet et la copie de
structure s'annoncent indisponibles, et la copie de données continue seule.

Le relais est sans état, cible verrouillée sur `api.supabase.com`, chemins et
origines sur liste blanche en **refus par défaut**, et ne connaît **aucune
méthode de suppression**. Le jeton ne fait que le traverser.

## Sécurité

- **Les clés ne sont jamais enregistrées.** Elles vivent en mémoire et
  disparaissent avec l'onglet. Seules les URL des projets, la sélection et les
  réglages sont conservés sur l'appareil.
- **La source n'est jamais écrite.** Ce n'est pas une intention mais un
  invariant du transport : le client HTTP de la source refuse toute requête qui
  n'est pas une lecture, avant l'envoi (`src/core/guard.ts`, éprouvé par les
  tests). La seule exception est le `POST` de listage du stockage, qui ne
  modifie rien.
- **Copier un projet sur lui-même est refusé.**
- **Une écriture réelle doit être armée** en recopiant la référence du projet
  cible. Le mode par défaut est la **simulation** : tout est lu et compté, rien
  n'est écrit.
- Les clés éventuellement présentes dans les messages d'erreur sont **masquées**
  dans le journal comme dans le rapport exporté.
- Une clé `service_role` contourne la RLS et ouvre toute la base. Utilisez-la
  depuis un appareil de confiance, et révoquez-la si un doute subsiste.

## Marche à suivre

1. **Projets** — l'URL et la clé `service_role` de chaque projet (Settings →
   API). L'outil détecte le rôle de la clé et prévient si elle est publique. Si
   la cible n'existe pas encore, « Créer un projet Supabase » la crée, attend
   son démarrage et remplit la connexion tout seul. **La création peut être
   facturée** selon votre plan, elle est confirmée avant, et l'outil ne sait
   pas supprimer un projet.
2. **Contenu** — la comparaison des schémas, la sélection des tables et des
   seaux, l'ordre de copie calculé sur les clés étrangères.
3. **Structure** — le relevé de la source, ce qui sera créé (par catégorie, SQL
   consultable et téléchargeable), puis l'application à la cible. Simulation
   d'abord.
4. **Copie** — simulation d'abord, là aussi. Les réglages utiles : mise à jour
   ou insertion seule, taille des pages et des lots, colonnes à écarter, arrêt à
   la première erreur.
5. **Rapport** — le bilan par table et par seau, exportable en JSON, et le
   bouton **« Remettre les séquences à niveau »**.

### Après la copie

Les identifiants `serial` / `identity` sont insérés explicitement : la séquence
de la cible reste à 1, et la première insertion de votre application entrerait
en conflit. Le bouton du **Rapport** exécute le `setval` qu'il faut, table par
table. Sans relais, il reste à faire à la main :

```sql
select setval(
  pg_get_serial_sequence('public.ma_table', 'id'),
  coalesce((select max(id) from public.ma_table), 1)
);
```

Pensez aussi aux **déclencheurs de la cible** : ils s'exécutent pendant la copie
et peuvent réécrire ce que vous venez d'insérer (`updated_at`, journaux
d'audit). Le champ « Colonnes à ne pas copier » sert exactement à ça — et il est
**obligatoire** pour les colonnes `GENERATED ALWAYS`, qui refusent toute valeur.

## Limites connues

- Les fichiers transitent **par le navigateur** : un objet très volumineux peut
  échouer faute de mémoire. La copie reste reprenable (les fichiers déjà
  présents sont laissés en place).
- Une table sans clé primaire est lue **par décalage** : sensible aux écritures
  concurrentes à la source, et non rejouable (une relance créerait des doublons).
- Un **cycle** de clés étrangères, ou une table qui se référence elle-même, ne
  peut pas être ordonné : l'outil le signale et certaines lignes peuvent être
  refusées. Une seconde passe les rattrape en général.
- Les valeurs par défaut, contraintes CHECK et colonnes générées **ne sont pas
  visibles** dans la description OpenAPI : la vérification faite à l'écran
  **Contenu** porte sur les colonnes, leur type et leur caractère obligatoire,
  pas au-delà. L'écran **Structure**, lui, voit tout cela — mais il lui faut le
  relais.
- La création de projet et la copie de structure ne fonctionnent qu'avec des
  projets **hébergés par Supabase** : un domaine personnalisé ou une instance
  auto-hébergée n'a pas de référence connue de l'API de management. La copie de
  données, elle, fonctionne avec.
- Le **mot de passe** de la base d'un projet créé ici n'est ni conservé ni
  réaffiché : notez-le au moment de la création.

## Développement

```bash
export NODE_AUTH_TOKEN="$(gh auth token)"   # accès à @mister-guiiug sur GitHub Packages
npm install
npm run dev
```

| Commande             | Effet                                    |
| -------------------- | ---------------------------------------- |
| `npm run dev`        | Serveur de développement (port 5234)     |
| `npm test`           | Tests unitaires (Vitest)                 |
| `npm run type-check` | `tsc -b`                                 |
| `npm run lint`       | ESLint                                   |
| `npm run format`     | Prettier                                 |
| `npm run build`      | Build PWA + contrôle du budget de bundle |

### Organisation

| Dossier         | Rôle                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`     | Cœur **pur** : lecture du schéma OpenAPI, ordre topologique, comparaison, plan, pagination, quoting SQL, génération du DDL, masquage des secrets, invariant de lecture seule. Aucun accès réseau, entièrement testé. |
| `src/api/`      | Le protocole : client HTTP (`fetch` injecté, reprises, délais), PostgREST, Storage, API de management.                                                                                                               |
| `src/engine/`   | L'exécution : copie d'une table, copie d'un seau, relevé et application de structure, orchestration et événements.                                                                                                   |
| `src/proxy/`    | Le cœur portable du relais (types Web standard, testé) — `proxy/` n'en est que l'enveloppe Cloudflare.                                                                                                               |
| `src/features/` | Les écrans.                                                                                                                                                                                                          |
| `src/store/`    | L'état (Zustand) et l'agrégation de l'avancement.                                                                                                                                                                    |

Le `fetch` est injecté de bout en bout : les tests éprouvent la pagination, les
reprises, l'arrêt et l'invariant de lecture seule sans réseau ni serveur
factice.

Configuration partagée de la famille :
[`@mister-guiiug/dev-wpa-config`](https://github.com/mister-guiiug/dev-wpa-config).

## Licence

MIT.
