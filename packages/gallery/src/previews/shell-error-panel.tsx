import { ErrorPanel } from '@better-giving/operator/components/shell/ErrorPanel';

/*
 * the two faces a failure has, and the absences either of them can arrive with.
 *
 * the pair is the point and neither half says it alone. a 404 on a working deployment has somewhere
 * to send anybody, and a 500 has no way out at all — deliberately, because the deployment that
 * would serve the next screen is the thing that failed and a link there would be a lie. drawn side
 * by side, the missing control reads as a decision; drawn alone, it reads as a forgotten prop.
 *
 * which face gets a way out is the caller's, because it is the caller that knows the address: this
 * package declares no router (CLAUDE.md — the graph is `app → operator ← console`), so `wayOutProps`
 * carries both the element and the destination and the last specimen is the only one here that
 * states either.
 *
 * `code` is a closed pair and both are drawn. they differ in one line of caption and in nothing
 * else, which is worth seeing: the panel is one composition and the number is the whole of what
 * separates the two screens a reader ever meets.
 *
 * the panel is packages/operator/src/components/shell/AppShell.jsx's `PanelRoute`, so signing in and
 * failing are the same centred panel rather than two that look alike — and `.adm-panelroute`
 * measures itself against the viewport (`min-block-size: 100dvh` in
 * packages/operator/src/styles/adm.css), which is why each specimen here is a screen tall. that is
 * the element rather than the specimen: a route outside the shell stands in the middle of the
 * window, and there is nothing in the system to bound it to a smaller box.
 *
 * `title` and `children` are each drawn unconditionally, so the empty specimen is a number over an
 * empty heading over an empty paragraph — what a screen ships when the copy is computed and comes
 * back blank.
 */
export default function ShellErrorPanelPreview() {
	return (
		<div className="adm-stack">
			<ErrorPanel
				code="404"
				title="No such page"
				wayOut="Back to donation forms"
				wayOutProps={{ as: 'a', href: '#' }}
			>
				The address you followed does not name anything on this deployment. It may have been an
				older link, or a donation form that has since been archived.
			</ErrorPanel>

			<ErrorPanel code="500" title="Something went wrong">
				This deployment could not answer. Donations already taken are safe and nothing was lost. Try
				again in a minute.
			</ErrorPanel>

			{/* `code` left off, which is the component's own '404', and every other slot empty. */}
			<ErrorPanel />

			<ErrorPanel
				code="500"
				title="This deployment could not reach its database, so nothing on these screens can be read right now"
				wayOut="Try again"
				wayOutProps={{ as: 'a', href: '#' }}
			>
				Every figure on the operator screens is counted from the ledger at the moment it is asked
				for, so a database that cannot be reached is a screen with nothing on it rather than a
				screen with stale numbers on it. Donations taken while this is happening are still charged
				by Stripe and are written down as soon as the database answers again.
			</ErrorPanel>
		</div>
	);
}
