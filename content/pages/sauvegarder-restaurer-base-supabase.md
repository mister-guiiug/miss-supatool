---
title: Sauvegarder et restaurer une base Supabase : méthodes et pièges
description: Sauvegarder une base Supabase, même sur l'offre gratuite : sauvegardes du tableau de bord, export par la CLI, fichiers du stockage et restauration testée.
date: 2026-09-29
answer: Sur l'offre gratuite, Supabase ne fait aucune sauvegarde automatique et conseille d'exporter régulièrement la base avec la commande db dump de sa CLI. Les offres payantes gardent de 7 à 30 jours de sauvegardes quotidiennes. Dans tous les cas, les fichiers du stockage ne sont pas dans ces sauvegardes et se copient à part.
---

# Sauvegarder et restaurer une base Supabase

Une sauvegarde ne vaut que par la restauration qu'elle permet. Sur Supabase, ce qui est sauvegardé dépend de votre offre, et les fichiers du stockage ne sont dans aucune sauvegarde de la base. Voici ce qui existe, ce qu'il faut faire soi-même et comment vérifier que tout se restaure, d'après la documentation de Supabase relue le 29 septembre 2026.

## Ce que Supabase sauvegarde, selon l'offre

- **Offre gratuite** : aucune sauvegarde automatique. La documentation recommande d'exporter régulièrement ses données avec la commande `db dump` de la CLI, et de garder ces copies hors de Supabase.
- **Offre Pro** : une sauvegarde par jour, dont les sept dernières sont accessibles depuis le tableau de bord.
- **Offre Team** : les quatorze derniers jours. **Enterprise** : jusqu'à trente jours.
- **Restauration à un instant précis (PITR)** : une option payante des offres Pro, Team et Enterprise, qui demande au moins une instance de calcul Small. Elle remplace les sauvegardes quotidiennes et permet de revenir à la seconde près.

Deux précautions : supprimer un projet efface aussi ses sauvegardes, sans retour possible, et les sauvegardes quotidiennes ne gardent pas le mot de passe des rôles personnalisés.

## Ce qu'une sauvegarde de la base ne contient pas

La base ne garde que la description des fichiers du stockage, pas les fichiers eux-mêmes : une sauvegarde de la base ne les contient donc pas. Restaurer une vieille sauvegarde ne fait pas non plus revenir un fichier supprimé depuis.

Restent aussi à reprendre à la main, même quand Supabase restaure une sauvegarde dans un nouveau projet : les fonctions Edge, les réglages de l'authentification et les clés d'API, les réglages du temps réel, et les extensions de la base.

## Sauvegarder soi-même avec la CLI

La méthode décrite par Supabase demande la CLI de Supabase et Docker Desktop. Récupérez la chaîne de connexion de la base dans la fenêtre Connect du tableau de bord (le pooler de session par défaut), avec le mot de passe de la base, puis lancez trois exports :

- `supabase db dump --db-url "$URL" -f roles.sql --role-only` pour les rôles ;
- `supabase db dump --db-url "$URL" -f schema.sql` pour la structure ;
- `supabase db dump --db-url "$URL" -f data.sql --use-copy --data-only` pour les données.

La documentation ajoute à ce dernier export deux exclusions propres au stockage vectoriel (`-x "storage.buckets_vectors" -x "storage.vector_indexes"`) : reprenez la commande exacte de la page citée en fin d'article. Rangez ensuite les trois fichiers ailleurs que sur Supabase, et datez-les.

## Restaurer

**Depuis le tableau de bord (offres payantes).** Dans Database, puis Backups, choisissez la sauvegarde la plus proche avant l'incident. Le projet est inaccessible pendant la restauration, d'autant plus longtemps que la base est grosse : prévoyez l'interruption.

**Dans un nouveau projet.** La fonction « Restaurer dans un nouveau projet », encore en bêta, est réservée aux offres payantes dont les sauvegardes physiques sont activées. Elle copie la base, comptes utilisateurs compris, mais pas les fichiers du stockage ni leurs réglages. Un projet obtenu ainsi ne peut pas servir de source à son tour.

**À partir des fichiers SQL.** Créez le projet, activez-y les extensions et les webhooks de base de données que l'ancien utilisait, puis rejouez les trois fichiers d'un seul coup avec `psql` : `psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql --dbname "$URL"`. Réactivez ensuite les publications du temps réel, et redonnez un mot de passe aux rôles personnalisés.

**Un projet gratuit en pause depuis plus d'un an** ne se restaure plus depuis le tableau de bord. Avant sa suppression, la vue d'ensemble du projet (Project Overview) permet de télécharger la sauvegarde de la base et les fichiers du stockage, à restaurer dans un nouveau projet.

## Tester la restauration

Une sauvegarde jamais restaurée reste une hypothèse. Restaurez-la de temps en temps dans un projet de secours, comptez les lignes des principales tables des deux côtés et branchez votre application sur la copie. Vous découvrirez à temps un rôle oublié, une extension manquante ou un seau vide.

## Comment Miss Supatool vous aide

[Miss Supatool](https://mister-guiiug.github.io/miss-supatool/) copie un projet Supabase vers un autre, depuis le navigateur. Ce n'est pas un outil d'archivage : il ne produit pas de fichier de sauvegarde, il remplit un second projet. C'est justement utile pour tenir un projet de secours à jour, ou pour vérifier qu'une copie complète se reconstruit.

- **La structure** : tables, contraintes, index, vues, fonctions, déclencheurs, politiques RLS et droits, relevés en lecture seule sur la source, avec un SQL téléchargeable.
- **Les données** : table par table, dans l'ordre des clés étrangères, en simulation par défaut.
- **Les fichiers**, seau par seau, par l'API de stockage : la partie que les sauvegardes de la base n'emportent pas.
- **Un rapport** par table et par seau, exportable en JSON, et la remise à niveau des séquences.

L'outil n'écrit jamais dans la source, et les clés restent en mémoire le temps de l'onglet. Il ne copie ni les comptes utilisateurs, ni ce qui vit hors du schéma choisi. Le détail de la méthode est dans [Migrer un projet Supabase vers un autre](migrer-un-projet-supabase.html).

Miss Supatool est une application indépendante, ni affiliée à Supabase ni approuvée par Supabase.

## Questions fréquentes

### Le plan gratuit de Supabase fait-il des sauvegardes ?

Non. Les sauvegardes quotidiennes commencent avec l'offre Pro, qui en garde sept jours. Sur l'offre gratuite, Supabase recommande d'exporter régulièrement la base avec la commande `db dump` de sa CLI.

### Les fichiers du stockage sont-ils dans les sauvegardes ?

Non. La base ne contient que leur description. Il faut les copier à part, par exemple avec la CLI ou, d'un projet à l'autre, avec Miss Supatool.

### Peut-on restaurer une sauvegarde dans un autre projet ?

Oui. Sur une offre payante avec sauvegardes physiques, la fonction « Restaurer dans un nouveau projet » le fait depuis le tableau de bord. Sinon, les fichiers SQL exportés par la CLI se rejouent avec `psql` dans le projet de votre choix.

### Miss Supatool remplace-t-elle une sauvegarde ?

Non. Elle copie un projet vers un autre projet, mais ne produit aucun fichier d'archive. Gardez des exports datés hors de Supabase, et servez-vous de l'outil pour tenir une copie de secours ou tester une reconstruction.

## Sources

- [Sauvegardes de la base](https://supabase.com/docs/guides/platform/backups) : durées par offre, PITR, fichiers du stockage exclus.
- [Sauvegarde et restauration avec la CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) : commandes `db dump` et `psql`.
- [Restaurer dans un nouveau projet](https://supabase.com/docs/guides/platform/clone-project) : conditions, contenu copié, réglages à reprendre.
- [Projet en pause depuis plus d'un an](https://supabase.com/docs/guides/troubleshooting/restore-project-after-90-days-pause) : téléchargement de la sauvegarde et des fichiers.
- [Tarifs de Supabase](https://supabase.com/pricing) : sauvegardes non incluses dans l'offre gratuite.
