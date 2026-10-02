import { Button } from '@better-giving/operator/components/controls/Button';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { Form, useLocation, useNavigation } from 'react-router';
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
	const { pathname, search } = useLocation();

	// a re-read that moved a line is said by the ledger, whose words change under it. one that moved
	// nothing changes no words anywhere, so it is said beside the press: the usual answer while a job
	// is still open on the console, and silence there reads as a press nobody heard. only this
	// form's GET is a press; any other navigation says nothing here.
	const pressed =
		navigation.state === 'loading' &&
		navigation.formMethod === 'GET' &&
		navigation.formAction === pathname;
	const setOutFrom = useRef<readonly SetupLine[] | null>(null);
	const [unchanged, setUnchanged] = useState(false);
	useEffect(() => {
		if (rereading) {
			if (pressed) setOutFrom.current ??= lines;
			else setOutFrom.current = null;
			setUnchanged(false);
			return;
		}
		const from = setOutFrom.current;
		if (from === null) return;
		setOutFrom.current = null;
		setUnchanged(sameLines(from, lines));
	}, [rereading, pressed, lines]);

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

			{/* a GET: this re-runs the read and writes nothing, which is the whole of what the press
			    is for. a deploy from the console restarts the worker, so what the operator needs on
			    coming back to this tab is exactly one re-read.

			    the read is of the address they asked for, which the gate is drawn over in place of its
			    screen (../../routes/_app.tsx). the action is named because the form is drawn from that
			    pathless layout, which resolves a missing one to `/`; and the search is carried as
			    fields because a GET form's own fields replace whatever search its action names. */}
			<Form method="get" action={pathname} className="adm-actions">
				{[...new URLSearchParams(search)].map(([name, value], at) => (
					<input key={`${at}:${name}`} type="hidden" name={name} value={value} />
				))}
				{/* held with `aria-disabled` rather than `disabled` while the read is in flight: a
				    disabled button gives up focus, which drops the operator on the page body at the
				    moment the answer arrives beside it. the press is closed in the handler instead. */}
				<Button
					type="submit"
					variant="primary"
					aria-disabled={rereading || undefined}
					aria-busy={rereading}
					onClick={(event: MouseEvent<HTMLButtonElement>) => {
						if (rereading) event.preventDefault();
					}}
				>
					Check again
				</Button>
				{/* mounted empty, so the words arriving are announced. */}
				<span role="status">
					{unchanged ? (
						<StatusWord register="momentary" neutral>
							Nothing has changed yet.
						</StatusWord>
					) : null}
				</span>
			</Form>
		</PanelRoute>
	);
}

/**
 * whether a re-read answered with the very lines it set out from.
 *
 * every key of a line is compared, so a field `SetupLine` grows later is counted without this
 * changing with it. strict equality on each value, which is exact for the strings and `null`s a
 * line holds today; a value that is not one would read as moved on every re-read, which says
 * nothing beside the press rather than a "nothing has changed" that is wrong.
 */
function sameLines(a: readonly SetupLine[], b: readonly SetupLine[]): boolean {
	return (
		a.length === b.length &&
		a.every((line, at) => {
			const other = b[at];
			if (other === undefined) return false;
			const mine: Readonly<Record<string, unknown>> = line;
			const theirs: Readonly<Record<string, unknown>> = other;
			const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
			return [...keys].every((key) => Object.is(mine[key], theirs[key]));
		})
	);
}
