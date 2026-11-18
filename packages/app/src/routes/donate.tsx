import { redirect } from 'react-router';
import type { Route } from './+types/donate';

// the donation page's old address. the page is drawn at `/` (./_index.tsx), and every link already
// shared, printed or saved at `/donate` keeps working: a permanent redirect that carries the query
// string, so a donor returning from authorizing a gift (`RESUME_FORM_PARAM` in
// packages/form/src/embed/resume.ts) still arrives with the stamp the page reads.
//
// a bare path, as every server redirect in this app is: nothing configures a base path today, so a
// fork that ever did would change every server redirect in this app at once rather than one call
// site at a time. the redirect is the whole of the route and charges nothing: the page it sends to
// is metered when the browser follows it.
export function loader({ request }: Route.LoaderArgs) {
	return redirect(`/${new URL(request.url).search}`, 308);
}
