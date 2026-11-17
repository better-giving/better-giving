import { Button } from '@better-giving/operator/components/controls/Button';
import { PageState } from '@better-giving/operator/components/shell/PageState';

/*
 * the four page states on page-state-css, each standing alone here where the shell would centre it
 * in its `<main>`: Gifts with none yet (no action, since the header above it already has Add
 * donation), the 404 with its one way on, the 500 with none, and loading. the 500's command is set
 * in `.adm-code`: page-state-css has no inline-code style, which is a registry gap.
 */
export default function ShellPageStatePreview() {
	return (
		<div className="adm-stack">
			<PageState
				variant="empty"
				title="No gifts yet"
				body="Gifts show up here as soon as a donor gives, or when you add one by hand."
			/>
			<PageState
				variant="not-found"
				title="No such page"
				body="It may have been deleted, or the address may be wrong."
				action={
					<Button as="a" href="/admin" variant="primary">
						Go to dashboard
					</Button>
				}
			/>
			<PageState
				variant="error"
				title="This deployment could not answer"
				body={
					<>
						Nothing more is known here. The app’s log has the cause:{' '}
						<code className="adm-code">docker compose logs app</code>.
					</>
				}
			/>
			<PageState variant="loading" label="Loading gifts…" />
		</div>
	);
}
