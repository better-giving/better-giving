import type { RouteConfig } from '@react-router/dev/routes';
import { flatRoutes } from '@react-router/fs-routes';

// the addresses this console answers on, which are the files under ./routes/. `rootDirectory`
// defaults to `routes` under the app directory, and ../react-router.config.ts makes that `src`.
//
// a spec beside its screen is a test and not an address, which is why the sweep is told to pass
// over one: `flatRoutes` reads a `.ts` as readily as a `.tsx`, and every spec in this package sits
// beside the module it is about.
//
// **one layout wraps the pages of a ready deployment, and `/` stands outside it.** ./routes/_sections.tsx
// is pathless — the leading underscore — and draws the rail, the strip and the foot around every
// `_sections.*` page, one per set-up section. `/` (./routes/_index.tsx) draws the faces that stand
// before a deployment is ready on a shell of their own, because every fact the rail would carry is
// read over a deployment this console cannot yet read, and sends a ready deployment into the layout.
// every other file under ./routes/ is an address that moved: a loader that redirects to the page now
// holding what it held, and no component at all.
export default (await flatRoutes({ ignoredRouteFiles: ['**/*.spec.*'] })) satisfies RouteConfig;
