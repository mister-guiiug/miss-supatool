/**
 * L'enveloppe Cloudflare Worker autour du cœur portable.
 *
 * Tout ce qui décide vit dans `src/proxy/handler.ts`, qui n'utilise que des
 * types Web standard et qui est testé avec le reste de l'application. Ce
 * fichier-ci ne fait que le brancher : le porter sur Deno Deploy, Netlify ou
 * Vercel Edge se réduit à réécrire ces quelques lignes.
 */

import { handleProxy, type ProxyEnv } from '../src/proxy/handler.ts';

export default {
  fetch(request: Request, env: ProxyEnv): Promise<Response> {
    return handleProxy(request, env);
  },
};
