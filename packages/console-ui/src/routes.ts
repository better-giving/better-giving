import type { RouteConfig } from '@react-router/dev/routes';
import { flatRoutes } from '@react-router/fs-routes';

// the addresses this console answers on, which are the files under ./routes/. `rootDirectory`
// defaults to `routes` under the app directory, and ../react-router.config.ts makes that `src`.
//
// a spec beside its screen is a test and not an address, which is why the sweep is told to pass
// over one: `flatRoutes` reads a `.ts` as readily as a `.tsx`, and every spec in this package sits
// beside the module it is about.
//
// **no layout wraps them, because the console is one page and a page carries its own shell.** which
// shell `/` draws is the whole of what it decides — a centred panel before there is a cloudflare
// account, a bar of facts after one — and a layout above it would have to draw a frame around the
// face that is deliberately drawn without one. the two processor screens,
// ./routes/payments_.stripe.tsx and ./routes/payments_.paypal.tsx, draw their own shell for the same
// reason. every other file under ./routes/ is an address that moved: a loader that redirects to `/`
// and no component at all.
export default (await flatRoutes({ ignoredRouteFiles: ['**/*.spec.*'] })) satisfies RouteConfig;
