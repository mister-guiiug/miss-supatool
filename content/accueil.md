## Pour qui

Les développeurs qui doivent copier un projet Supabase vers un autre, pour changer d'organisation, repartir d'un projet propre ou dupliquer une base de test.

## Comment ça marche

Cinq étapes : Projets, Contenu, Structure, Copie, Rapport. Vous branchez la source et la cible avec leur URL et leur clé `service_role`, ou vous créez la cible depuis l'outil. Il compare les schémas, recopie la structure, puis les lignes et les fichiers, en simulation par défaut. La source n'est jamais écrite.

## Vos données

Aucun compte n'est à créer. Les clés et le jeton d'accès personnel restent en mémoire le temps de l'onglet, sans jamais être enregistrés ; seules les URL des projets, la sélection et les réglages sont gardés sur l'appareil. Les lignes et les fichiers passent d'un projet à l'autre par votre navigateur. La création de projet, la copie de structure et la remise à niveau des séquences passent par le relais de l'application, qui n'en garde rien. Sentry (région européenne) signale les erreurs dès l'ouverture, sans demande de consentement ; PostHog (nuage européen) ne mesure l'audience qu'après votre accord.

## Prix

Gratuit et open source, sous licence MIT. Créer un projet peut être facturé par Supabase, selon votre offre.
