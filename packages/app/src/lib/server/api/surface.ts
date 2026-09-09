// the public api's own vocabulary: what "under `/api/v1`" means.
//
// this file is one of several in a folder whose charter is what the public surface needs, rather
// than only what every route there shares. two of them are shared by every route — who may read an
// answer (./cors.ts) and who may ask for one (./rate-limit.ts) — and one is owed by fewer:
// ./turnstile.ts is the check a submission that initiates a payment carries, which the config
// endpoint has no token for and does not make.
//
// it is a folder rather than a file on each route because a decision made twice is a second place
// somebody can widen it, and that is as true of the check only one route makes as of the two both
// do — the next endpoint that takes a token has to reach the same answer as the first.

/**
 * the URL prefix of the public api.
 *
 * a route joins this surface by nesting under `src/routes/api.v1.ts`, which is the layout the
 * rate limit is mounted on (`$lib/server/api/meter.ts`); `src/routes.spec.ts` fails on a route
 * served under this prefix that sits anywhere else.
 */
export const API_BASE_PATH = '/api/v1';
