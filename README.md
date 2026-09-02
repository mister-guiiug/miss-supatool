# Miss Supatool

[![CI](https://github.com/mister-guiiug/miss-supatool/actions/workflows/ci.yml/badge.svg)](https://github.com/mister-guiiug/miss-supatool/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Copier les données d'un projet Supabase vers un autre** — les lignes de vos
tables et les fichiers de vos seaux de stockage — depuis une page web, sans
serveur intermédiaire et sans installer d'outil.

👉 <https://mister-guiiug.github.io/miss-supatool/>

---

## Ce que fait l'outil, et ce qu'il ne fait pas

**Il copie** :

- les **lignes** des tables du schéma exposé par l'API (`public` par défaut),
  dans l'ordre des clés étrangères ;
- les **fichiers** des seaux de stockage, en recréant au besoin les seaux
  absents avec leur réglage public/privé, leur limite de taille et leurs types
  MIME autorisés.

**Il ne copie pas** — et ne prétend pas le faire :

| Non copié                                                            | Pourquoi, et quoi faire à la place                                                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le **schéma** (tables, contraintes, index, RLS, fonctions, triggers) | Créer une table demande du SQL, et le SQL n'est pas joignable depuis un navigateur (voir plus bas). Appliquez vos migrations à la cible d'abord (`supabase db push`). |
| Les **comptes** (`auth.users`)                                       | Le schéma `auth` n'est pas exposé par l'API REST. Utilisez l'API d'administration Auth ou l'outil de migration officiel.                                              |
| Les **séquences**                                                    | Insérer des identifiants explicites n'avance pas la séquence de la cible : le prochain `INSERT` sans identifiant échouerait. Voir « Après la copie ».                 |
| Les **métadonnées d'objets** (propriétaire, en-têtes personnalisés)  | L'API Storage ne les rejoue pas. Le contenu et le type MIME sont préservés.                                                                                           |

L'écran **Contenu** compare les deux schémas et refuse de lancer une copie tant
qu'un écart bloquant subsiste (table absente, colonne manquante, colonne
obligatoire côté cible que la source ne fournit pas).

## Pourquoi ça marche sans serveur

Un outil de copie « tout navigateur » n'est possible que parce que les API **de
projet** de Supabase acceptent les requêtes venues d'une autre origine :

- **PostgREST** (`/rest/v1`) publie sa propre description OpenAPI, qui donne les
  tables, les colonnes, les clés primaires et les **clés étrangères** — de quoi
  ordonner les insertions sans jamais lire `information_schema` ;
- l'**API Storage** (`/storage/v1`) liste, télécharge et téléverse les objets.

En revanche, l'API de **management** (`api.supabase.com`) n'autorise le CORS que
depuis `supabase.com` : elle est donc inaccessible ici, et avec elle le SQL
arbitraire, `pg_dump` et la lecture du catalogue Postgres. C'est cette limite,
et non un choix de périmètre, qui explique le tableau ci-dessus.

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
   API). L'outil détecte le rôle de la clé et prévient si elle est publique.
2. **Contenu** — la comparaison des schémas, la sélection des tables et des
   seaux, l'ordre de copie calculé sur les clés étrangères.
3. **Copie** — simulation d'abord. Les réglages utiles : mise à jour ou
   insertion seule, taille des pages et des lots, colonnes à écarter, arrêt à la
   première erreur.
4. **Rapport** — le bilan par table et par seau, exportable en JSON.

### Après la copie

Si vos tables utilisent des identifiants `serial` / `identity`, remettez les
séquences au bon niveau côté cible, sans quoi la première insertion applicative
entrera en conflit :

```sql
select setval(
  pg_get_serial_sequence('public.ma_table', 'id'),
  coalesce((select max(id) from public.ma_table), 1)
);
```

Pensez aussi aux **triggers de la cible** : ils s'exécutent pendant la copie et
peuvent réécrire ce que vous venez d'insérer (`updated_at`, journaux d'audit).
Le champ « Colonnes à ne pas copier » sert exactement à ça — et il est
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
  visibles** dans la description OpenAPI : la vérification de schéma porte sur
  les colonnes, leur type et leur caractère obligatoire, pas au-delà.

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

| Dossier         | Rôle                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/`     | Cœur **pur** : lecture du schéma OpenAPI, ordre topologique, comparaison, plan, pagination, masquage des secrets, invariant de lecture seule. Aucun accès réseau, entièrement testé. |
| `src/api/`      | Le protocole : client HTTP (`fetch` injecté, reprises, délais), PostgREST, Storage.                                                                                                  |
| `src/engine/`   | L'exécution : copie d'une table, copie d'un seau, orchestration et événements.                                                                                                       |
| `src/features/` | Les écrans.                                                                                                                                                                          |
| `src/store/`    | L'état (Zustand) et l'agrégation de l'avancement.                                                                                                                                    |

Le `fetch` est injecté de bout en bout : les tests éprouvent la pagination, les
reprises, l'arrêt et l'invariant de lecture seule sans réseau ni serveur
factice.

Configuration partagée de la famille :
[`@mister-guiiug/dev-wpa-config`](https://github.com/mister-guiiug/dev-wpa-config).

## Licence

MIT.
