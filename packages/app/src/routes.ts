import type { RouteConfig } from '@react-router/dev/routes';
import { flatRoutes } from '@react-router/fs-routes';

// the addresses this app answers on, which are the files under ./routes/. `rootDirectory` defaults
// to `routes` under the app directory, and ../react-router.config.ts makes that `src`.
//
// what the sweep is told to pass over, which it would otherwise take as an address. **every file
// directly under ./routes/ is a route to `flatRoutes` whatever its extension** — only a *directory*
// has to hold a `route` or `index` module to become one, which is why nothing nested under
// ./routes/ needs naming here.
//
// a spec beside its subject is a test and not an address: `flatRoutes` reads a `.ts` as readily as
// a `.tsx`, and specs in this repo sit beside the module they are about (CONTRIBUTING.md → Tests).
export default flatRoutes({
	ignoredRouteFiles: ['**/*.spec.*']
}) satisfies RouteConfig;
