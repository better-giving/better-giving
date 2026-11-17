import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { PanelRoute } from '@better-giving/operator/components/shell/PanelRoute';

/*
 * the composition a route outside the shell is: sign-in, drawn as the centred panel it was written
 * for, and each specimen a screen tall because `.adm-panelroute` is.
 *
 * its two strips are drawn both ways, and neither is this route's own — the head is `.adm-head` and
 * the foot `.adm-footstrip`. absent, the route is one row and the panel is centred in the window;
 * with a strip at each edge the panel is centred in what they leave. the second specimen carries
 * both, because the strips are tracked together and a route showing one says nothing about the rows
 * the other takes.
 *
 * `bare` is a state rather than a strip: the route stands its one control on the page's own ground
 * with no panel around it, drawn after the panel it drops so the pair says what the box was doing.
 */
export default function ShellPanelRoutePreview() {
	return (
		<div>
			<PanelRoute>
				<h1>Sign in</h1>
				<Field id="shell-panel-route-password" type="password" label="Staff password" />
				<Button variant="primary">Sign in</Button>
			</PanelRoute>

			{/* the run at the foot's trailing end is one node rather than three, because a strip's
			    step falls between its two ends — three links handed in loose are three ends spread
			    across the line. */}
			<PanelRoute
				bar={
					<>
						<span>someone@example.org</span>
						<Button variant="soft" size="sm" mark="log-out" aria-label="Sign out" />
					</>
				}
				foot={
					<>
						<span>better-giving v0.4.1</span>
						<div>
							<a href="https://example.org/one">Somewhere</a>{' '}
							<a href="https://example.org/two">Somewhere else</a>{' '}
							<a href="https://example.org/three">A third place</a>
						</div>
					</>
				}
			>
				<h1>Sign in</h1>
				<Field id="shell-panel-route-barred-password" type="password" label="Staff password" />
				<Button variant="primary">Sign in</Button>
			</PanelRoute>

			<PanelRoute bare>
				<Button variant="primary">Continue to the dashboard</Button>
			</PanelRoute>
		</div>
	);
}
