import { Button } from '@better-giving/operator/components/controls/Button';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import { Form, useNavigation } from 'react-router';
import type { SetupLine } from '$lib/server/config/readiness';

/* the whole of what this deployment serves behind the login while any of the five is unfinished.
   it stands in place of the dashboard rather than beside it, which is what lets every screen under
   ../../routes/_app.tsx assume all five are done ($lib/server/config/readiness.ts).

   it takes the gate shape the login already takes: no rail, no identity band, a panel in the
   middle of the page and one press. a rail here would offer five destinations this deployment is
   not serving, and the organisation's name is one of the five things that may be missing.

   **it names a command, which no console screen may do.** the two audiences are not the same: this
   is read in a browser by whoever set the deployment up, the console is the thing they are being
   sent to, and there is nothing on this page that could open it for them.

   **no line carries a control and none ever may.** every one of the five is repaired on the console
   beside the value it is about — a press here would be that console built a second time, over a
   deployment that by definition is not finished. the press below re-reads and nothing else. */
export function SetupGate({ lines }: { lines: readonly SetupLine[] }) {
	const navigation = useNavigation();
	const rereading = navigation.state !== 'idle';

	return (
		<PanelRoute>
			<h1>Finish setting up this deployment</h1>
			<p className="adm-prose">
				Your dashboard isn&rsquo;t served until every line below is done. Open the console (
				<InlineCode>better-giving start</InlineCode>) on the machine you set this deployment up
				from, and each one has the control that finishes it.
			</p>

			{/* polite rather than assertive: the list is what the reader came for and it changes only
			    when they press. */}
			<div role="status">
				<StatusLedger>
					{lines.map((line) => (
						<StatusLine
							key={line.id}
							labelAs="h2"
							label={line.label}
							// the same two tones the console's own ledger reads these five under
							// (packages/console-ui/src/lib/home-sections.ts), because it is the same five jobs.
							tone={line.state === 'ready' ? 'done' : 'attention'}
							word={line.word}
							note={line.note}
						/>
					))}
				</StatusLedger>
			</div>

			{/* a GET and no action: this re-runs the read and writes nothing, which is the whole of
			    what the press is for. a deploy from the console restarts the worker, so what the
			    operator needs on coming back to this tab is exactly one re-read. */}
			<Form method="get" className="adm-actions">
				<Button type="submit" variant="primary" disabled={rereading} aria-busy={rereading}>
					Check again
				</Button>
			</Form>
		</PanelRoute>
	);
}
