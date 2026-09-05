import { registerSW } from 'virtual:pwa-register';
import { UpdatePromptBanner } from '@mister-guiiug/dev-pwa-config/react/update-prompt-banner';

/**
 * Bandeau de mise à jour du socle, remonté au-dessus de la barre de navigation
 * basse (≈ 3,7 rem) pour ne pas la recouvrir.
 *
 * En `registerType: 'prompt'`, rien ne se recharge tout seul : une copie en
 * cours ne peut pas être interrompue par un déploiement.
 */
export function UpdatePrompt() {
  return (
    <UpdatePromptBanner
      registerSW={registerSW}
      snoozeHours={4}
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-40"
    />
  );
}
