# Relais vers l'API de management

Miss Supatool sait **créer le projet cible** et **y recopier la structure** de la
base. Les deux passent par l'API de management de Supabase
(`api.supabase.com`) — et celle-ci n'accorde le CORS qu'à `https://supabase.com` :

```console
$ curl -si -X OPTIONS https://api.supabase.com/v1/organizations \
    -H 'Origin: https://mister-guiiug.github.io' \
    -H 'Access-Control-Request-Method: GET' | grep -i allow-origin
# (aucune ligne : le navigateur bloquera)
```

Aucun réglage côté page n'y change quoi que ce soit. Il faut un intermédiaire,
et le voici.

## Deux façons de s'en passer… ou pas

| Contexte                                     | Ce qu'il faut faire                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| **En local** (`npm run dev`)                 | **Rien.** Le serveur Vite relaie déjà, sur `/__supabase-management`.          |
| **Sur GitHub Pages** (ou tout site statique) | Déployer ce Worker, puis renseigner son URL au build (`VITE_SUPABASE_PROXY`). |

Sans relais configuré, l'application reste pleinement utilisable pour la
**copie des données** : seules la création de projet et la copie de structure
sont indisponibles, et elles le disent.

## Ce que le relais accepte, et rien d'autre

- **Une seule cible**, écrite en dur : `https://api.supabase.com`. Ce n'est pas
  un proxy ouvert.
- **Une liste blanche de chemins**, méthode comprise : lire les organisations,
  lister et créer des projets, lire un projet et ses clés, exécuter une requête
  SQL. Aucune règle `DELETE` ni `PATCH` — le relais ne sait pas supprimer un
  projet, même si on le lui demande.
- **Une liste blanche d'origines**, en **refus par défaut** : `ALLOWED_ORIGINS`
  vide n'ouvre à personne. L'en-tête `Origin` est **obligatoire**, ce qui ferme
  l'usage du relais comme anonymiseur depuis un terminal.
- Le **jeton d'accès personnel ne fait que traverser** : ni lu, ni journalisé,
  ni conservé. Le relais est sans état.

Le cœur est dans [`../src/proxy/handler.ts`](../src/proxy/handler.ts) — types Web
standard uniquement, testé avec le reste de l'application
([`handler.test.ts`](../src/proxy/handler.test.ts)). Le porter sur Deno Deploy,
Netlify ou Vercel Edge revient à réécrire les cinq lignes de `worker.ts`.

## Instance en service

Le site publié utilise **`https://supatool-management-proxy.mister-guiiug.workers.dev`**
(déployé le 02/09/2026, `ALLOWED_ORIGINS = https://mister-guiiug.github.io`),
désigné par la variable de dépôt `SUPABASE_PROXY_URL`.

Les garde-fous y ont été éprouvés en production : requête sans `Origin` → 403 ·
origine inconnue → 403 · sans jeton → 401 · `DELETE` sur un projet → 403 · URL
absolue en `path` → 400 · préflet → 204 · appel légitime → la réponse de
Supabase, telle quelle.

## Déploiement (Cloudflare)

```bash
cd proxy
npx wrangler login
npx wrangler deploy
```

Avec un jeton d'API plutôt qu'une connexion interactive :
`CLOUDFLARE_API_TOKEN` (permission « Workers Scripts: Edit ») et
`CLOUDFLARE_ACCOUNT_ID` dans l'environnement.

Ajustez `ALLOWED_ORIGINS` dans [`wrangler.toml`](./wrangler.toml) **avant** de
déployer : seules les origines qui y figurent pourront s'en servir. Pour un
usage depuis le serveur de développement, ajoutez `http://localhost:5234`.

Puis déclarez l'URL obtenue à l'application, au moment du build :

```bash
VITE_SUPABASE_PROXY=https://supatool-management-proxy.<compte>.workers.dev npm run build
```

Sur GitHub Pages, la valeur se pose en **variable de dépôt**
`SUPABASE_PROXY_URL`, injectée par le workflow de déploiement.

> Le relais n'accorde aucun droit par lui-même : c'est **votre** jeton d'accès
> personnel, saisi dans l'application et jamais conservé, qui autorise chaque
> appel. Un relais déployé sans jeton ne peut rien faire.
