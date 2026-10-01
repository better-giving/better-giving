/**
 * where an answer that withholds its cause sends its reader. client-safe, because the root error
 * boundary draws it in the browser and the dashboard gate (`$lib/server/auth/gate.ts`) answers
 * with it on the server.
 */
export const LOGS_SAY_WHY =
	'This deployment’s logs say why: the Cloudflare dashboard has them, and `pnpm run logs` reads them from a checkout.';
