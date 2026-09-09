import type { LinkDescriptor } from 'react-router';
import href from '../../app.css?url';

// the operator stylesheet, and how a screen wears it.
//
// **the document carries no sheet.** src/root.tsx renders every screen this app serves, the donor's
// page at `/{form_id}` included, and that page draws the donation form's own card from the four
// sheets in packages/form/src/styles/ — which are unlayered, while every declaration reaching
// /admin sits in one of the five layers src/app.css declares. a document holding both would let one
// side outrank the other on every property only one of them sets, in both directions, so the two
// systems never share a document and neither needs a boundary drawn around it.
//
// what that costs is one line per screen served outside src/routes/_app.tsx: the layout dresses
// everything beneath it, and the four screens beside it dress themselves. a screen that forgets
// renders undressed and nothing else breaks, so src/routes.spec.ts is what reports it.
//
// `?url` rather than a side-effect import: the sheet is a stylesheet the framework puts in the head
// through `<Links />`, and what vite emits for that name is the processed asset with app.css's
// `@import`s already resolved into it.

/** the one descriptor, for a route to export as its whole `links`. */
export function operatorLinks(): LinkDescriptor[] {
	return [{ rel: 'stylesheet', href }];
}
