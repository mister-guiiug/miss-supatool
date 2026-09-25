---
title: Migrer un projet Supabase vers un autre : structure et données
description: Copier un projet Supabase vers un autre : quoi déplacer, dans quel ordre, les pièges des séquences et de la RLS, et un outil qui le fait dans le navigateur.
---

# Migrer un projet Supabase vers un autre

Changer d'organisation, repartir d'un projet propre après un prototype, dupliquer une base pour des tests : un jour, il faut copier un projet Supabase vers un autre. Voici ce qu'il faut déplacer, dans quel ordre, et les pièges qui font échouer une migration.

## Ce qu'il faut déplacer

Un projet Supabase, c'est plusieurs couches, qui ne se copient pas de la même façon :

- **la structure** : tables, contraintes, index, vues, fonctions, déclencheurs, politiques RLS (sécurité au niveau des lignes) et droits ;
- **les données** : les lignes de vos tables ;
- **les fichiers** : le contenu des seaux (buckets) du stockage ;
- **les comptes** : les utilisateurs de l'authentification, rangés dans le schéma `auth` ;
- **le reste** : fonctions Edge, secrets, tâches planifiées, réglages de connexion (fournisseurs, adresses de retour autorisées), à reprendre à part.

## Deux méthodes

**En ligne de commande.** On exporte la base (avec `pg_dump` ou la commande `supabase db dump` de la CLI), puis on la restaure dans le nouveau projet avec `psql`. C'est la voie la plus complète pour la base, mais elle demande d'installer des outils et d'avoir la chaîne de connexion des deux bases. Les fichiers du stockage restent à copier à part.

**Par les API, depuis le navigateur.** Chaque projet expose une API REST (PostgREST) qui publie la description de ses tables et de ses clés, et une API de stockage qui liste, télécharge et envoie les fichiers. De quoi copier données et fichiers sans rien installer. Pour créer la structure, il faut en plus l'API de gestion de Supabase.

## Les étapes d'une migration sans mauvaise surprise

1. **Préparez la cible.** Créez le projet, ou choisissez-en un vide.
2. **Recréez la structure avant les données.** Une ligne ne s'insère pas dans une table qui n'existe pas.
3. **Copiez les tables dans l'ordre des clés étrangères.** Si `membres.club_id` pointe vers `clubs.id`, copiez `clubs` d'abord, sinon chaque membre sera refusé.
4. **Copiez les fichiers**, seau par seau.
5. **Remettez les séquences à niveau.** C'est l'oubli le plus fréquent. Vous copiez 1 250 commandes avec leurs identifiants de 1 à 1 250 ; la séquence de la cible, elle, est restée à 1. La première commande créée par votre application demandera l'identifiant 1 et sera refusée. Un `setval` corrige cela : `select setval(pg_get_serial_sequence('public.commandes', 'id'), (select max(id) from public.commandes));`
6. **Vérifiez** : comptez les lignes des deux côtés, puis changez l'URL et les clés dans votre application et testez-la.

Deux pièges de plus pendant la copie : les déclencheurs de la cible s'exécutent et peuvent réécrire ce que vous insérez (une colonne `updated_at`, un journal d'audit), et une colonne `GENERATED ALWAYS` refuse toute valeur. Il faut alors écarter ces colonnes de la copie.

## Comment Miss Supatool vous aide

Miss Supatool est une application web qui mène cette migration en cinq étapes : Projets, Contenu, Structure, Copie, Rapport.

- **Brancher les deux projets**, avec l'URL et la clé `service_role` de chacun. L'outil repère une clé publique et vous prévient. Si la cible n'existe pas, il peut la créer, attendre son démarrage et récupérer sa clé. La création peut être facturée selon votre plan : elle est confirmée avant, et l'outil ne sait pas supprimer un projet.
- **Comparer les deux schémas** et calculer l'ordre de copie à partir des clés étrangères.
- **Recopier la structure** : le relevé de la source se fait en lecture seule, le SQL est consultable et téléchargeable, et les instructions peuvent être rejouées sans rien écraser.
- **Copier lignes et fichiers**, en simulation par défaut. Une écriture réelle ne part qu'après avoir recopié la référence du projet cible. Vous choisissez l'insertion seule ou la mise à jour, les colonnes à ne pas copier, et l'arrêt à la première erreur.
- **Protéger la source** : l'outil refuse toute requête d'écriture vers elle avant l'envoi, et refuse de copier un projet sur lui-même.
- **Finir proprement** : un rapport par table et par seau, exportable en JSON, et un bouton qui remet les séquences à niveau.

Les clés ne sont jamais enregistrées : elles restent en mémoire le temps de l'onglet. La création de projet, la copie de structure et les séquences passent par un relais, avec votre jeton d'accès personnel Supabase.

## Ce que l'outil ne copie pas

- les comptes utilisateurs (`auth.users`) : passez par l'API d'administration de l'authentification ou l'outil de migration officiel ;
- ce qui vit hors du schéma choisi (`public` par défaut), dont les politiques du stockage ;
- les tables partitionnées, les domaines et les collations ;
- les secrets du coffre (Vault), les tâches cron et les rôles ;
- les métadonnées des fichiers (propriétaire, en-têtes personnalisés). Le contenu et le type MIME sont conservés.

Les fichiers transitent par votre navigateur : un objet très volumineux peut échouer. La création de projet et la copie de structure ne marchent qu'avec des projets hébergés par Supabase.

Miss Supatool est une application indépendante, ni affiliée à Supabase ni approuvée par Supabase. Supabase est une marque de son propriétaire.

## Questions fréquentes

### Peut-on migrer un projet Supabase sans ligne de commande ?

Oui, pour la structure, les données et les fichiers : les API de Supabase suffisent. C'est le parti pris de Miss Supatool. Les comptes utilisateurs et les réglages du projet restent à reprendre à part.

### Les politiques RLS sont-elles recopiées ?

Oui, avec la structure, pour le schéma choisi. Les politiques du stockage, qui vivent dans un autre schéma, sont à rejouer séparément.

### Pourquoi faut-il la clé service_role ?

Elle contourne la RLS : c'est ce qui permet de lire toutes les lignes de la source et d'écrire dans la cible. Elle ouvre donc toute la base. Utilisez-la depuis un appareil de confiance et régénérez-la au moindre doute.

### La migration peut-elle abîmer le projet source ?

Miss Supatool ne l'écrit jamais : son client refuse toute requête d'écriture vers la source avant de l'envoyer. Et par défaut, chaque étape commence par une simulation qui lit tout et n'écrit rien.
