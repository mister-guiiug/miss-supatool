/**
 * Rend l'icône maskable en PNG depuis `public/icon-maskable.svg`.
 *
 * POURQUOI UN SVG À PART, ET PAS `pwa-icons --maskable`. Le générateur du socle
 * fabrique un maskable en RÉDUISANT la source dans la zone de sécurité, sur un
 * fond uni. Quand la source est une tuile arrondie — c'est le cas ici — le
 * résultat est cette tuile posée sur un aplat, et le raccord se voit : Android
 * en fait un liseré tout autour de l'icône. Avec `--bg` on peut rapprocher les
 * deux couleurs, jamais supprimer le raccord.
 *
 * Un maskable se DESSINE à fond perdu. `icon-maskable.svg` reprend le même
 * dégradé et le même dessin que `favicon.svg`, sans les coins arrondis et avec
 * le sujet tenu dans le disque de sécurité. Le commentaire du SVG dit ce qui en
 * diffère, et pourquoi.
 *
 * LE MÊME `--bg` FRAPPE L'ICÔNE APPLE, ET ELLE NE PASSE PAS PAR ICI.
 * `pwa-icons` écrit `apple-touch-icon.png` PAR DÉFAUT, `--maskable` ou pas. iOS
 * n'accepte pas la transparence et aplatit les coins de la tuile arrondie sur
 * `--bg` — `12,18,34` tant qu'on ne le donne pas. Mesuré sur le fichier livré
 * jusqu'au 14/09/2026 : coin à `12,18,34` quand le bord rendait `11,26,20`. Deux
 * sombres, donc presque invisible ; faux quand même, et prêt à se voir le jour
 * où la tuile s'éclaircit.
 *
 * `npm run icons` porte donc `--bg 11,26,20`. ATTENTION : cette couleur est
 * ÉCRITE DEUX FOIS — ici dans `package.json`, et dans le `fill` du `<rect>` de
 * `favicon.svg` / `icon-maskable.svg`. Qui change l'une doit changer l'autre.
 *
 * On aurait pu l'éviter en rendant l'icône Apple depuis `icon-maskable.svg`,
 * qui n'a aucun coin à aplatir — c'est ce qui est fait sur `miss-lookhouse` et
 * `bac-sable`. Pas ici : ce maskable-ci RÉDUIT le dessin à 86 %, parce que les
 * deux cylindres débordaient du disque de 80 % d'Android. Le masque d'iOS, lui,
 * est un rectangle arrondi de rayon ~22,4 % : le point le plus avancé du dessin,
 * (55, 48) en repère 64, tombe en (154,7 ; 135,0) sur 180 — dans la bande
 * droite, pas dans l'arc de coin qui commence à (139,7 ; 139,7). iOS ne le rogne
 * pas. Rendre l'icône Apple depuis le maskable lui coûterait donc 14 % de
 * présence pour ne protéger de rien.
 *
 * Exécuter : npm run icons:maskable
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');

// `density` : sans elle, sharp pixellise le SVG à 72 ppp AVANT de
// redimensionner, et le dégradé en ressort bandé.
await sharp(join(racine, 'public', 'icon-maskable.svg'), { density: 384 })
  .resize(512, 512)
  .png()
  .toFile(join(racine, 'public', 'icon-maskable.png'));

console.log('public/icon-maskable.png écrit (512×512, à fond perdu).');
