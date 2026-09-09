import { PRE_UPGRADE_RESERVATION } from './reservation';

/**
 * the embed snippet, in the shape README.md and DEPLOY.md document — checked against them in
 * scripts/embed-snippet.spec.ts, an app-side spec, because nothing under packages/form/** reads
 * outside its own tree.
 *
 * three surfaces agree on one string and there is no variant: what is pasted into an org's own
 * HTML is a permanent contract, the same standing `v1` and the element's attribute surface hold,
 * so a second spelling of it would be the first place the three drift. it lives in the package
 * rather than in `src/lib/forms/`, where it first sat: two admin screens hand it out — the forms
 * list and the screen that edits one — and neither owns it more than the other, which is a real
 * argument for a shared function and always was. what was wrong was the directory: `src/lib/forms/`
 * is the directory whose defining property is that nothing in it is permanent (CLAUDE.md, "the
 * map"), and this is. both screens still reach it the same way, through
 * `@better-giving/form/embed/snippet`.
 *
 * the host is passed in and is always the request's own origin, never a configured base URL: no
 * hostname is committed to this repo, and a fork inheriting a hardcoded one would inherit a
 * pointer at a domain it does not own.
 *
 * which means a rehearsal deployment hands out a snippet pointing at itself, and that is accepted
 * rather than pending. `pnpm run deploy:test` puts a second deployment up on its own database
 * (DEPLOY.md, "A rehearsal deployment"), and its own dashboard builds this string from its own
 * origin — so a snippet copied off it and pasted on the org's real website loads the rehearsal
 * runtime under a real donor. a typed card declines there loudly, and the wallet path does not:
 * Stripe substitutes a test token for the real card in Apple Pay by design, so the donor
 * authenticates, the payment element reports success, the success state renders and the receipt
 * sends, on a gift where no money moved.
 *
 * no guard is built here and none is to be added. nothing in this project reads test-versus-live —
 * no marker, no stage flag, no branch on which deployment this is — and a rehearsal deployment is
 * permitted live keys, so its keys would not identify it either. what answers this is the operator
 * knowing, and DEPLOY.md is where they are told.
 *
 * the style block is not decoration and is not optional: it is what holds the element's box while
 * the runtime is still on its way, and without it every visitor to the page takes a reflow of the
 * card's whole height. `./reservation.ts` is where it is written and why.
 */
export function formSnippet(origin: string, formId: string): string {
	return `${runtimeSnippet(origin)}\n${elementSnippet(formId)}`;
}

/**
 * the two halves the block is made of, for a screen that hands an integrator the two placements
 * separately: this one goes once per page, `elementSnippet` goes wherever the form appears.
 *
 * they are the pasted block and not a second spelling of it — `formSnippet` is these two joined by
 * a newline and nothing else, which is what "the two halves are the block when joined" in
 * ./snippet.spec.ts holds. a screen rebuilding either string outside this module is where the three
 * surfaces that agree on it would start to disagree.
 *
 * the script and the reservation are one half because they are one instruction: the box is held for
 * an element the runtime has not defined yet, so a page taking the script without the rule takes
 * the reflow the rule exists to stop.
 */
export function runtimeSnippet(origin: string): string {
	return `<script src="${origin}/embed.js" async></script>\n${PRE_UPGRADE_RESERVATION}`;
}

/**
 * the element itself, which goes where the form is to appear — and is the only half a page already
 * carrying the runtime needs a second time.
 */
export function elementSnippet(formId: string): string {
	return `<bg-donate-form form="${formId}"></bg-donate-form>`;
}
