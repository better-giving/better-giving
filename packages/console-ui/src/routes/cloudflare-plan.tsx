import { redirect } from 'react-router';
import { ACCOUNT_PARAM } from '../lib/dialog-params';

// /cloudflare-plan — an address that moved, kept because it was one.
//
// it held the paid-plan switch, which now stands in the account panel over every section page
// (../lib/cloudflare-account.tsx), opened by a parameter on the address rather than by a page of its
// own. so it opens that panel over the organisation page, which every ready deployment draws. never
// over `/`, which sends a ready deployment on to a page of its own choosing and carries no search
// with it (./_index.tsx), so the panel would not open.
//
// **307 and not 301**, for ./payments.tsx's reason: nothing here promises this address for good.
//
// no component, which is what makes this an address and not a screen: the redirect is answered
// before anything renders.
export function clientLoader() {
	throw redirect(`/organisation?${ACCOUNT_PARAM}`, 307);
}
