import { Menu } from '@better-giving/operator/components/controls/Menu';

/*
 * the menu: a press named for what it holds, and its lines. the first specimen is the editor bar's
 * More at rest, holding a link line and two action lines; the second stands open, which is the one
 * state no press reaches on a page that has to stay readable — the list stands over what follows
 * it, so the open one is last.
 *
 * the keys are ark's: Enter, Space or the down arrow open it, the arrows walk it, Enter runs a line,
 * Escape closes it, and the focus goes back to the press either way. a link line is followed as a
 * link, so the Open line below opens a new tab.
 */
const LINES = [
	{ label: 'Open /donate', href: '/donate', newTab: true },
	{ label: 'Reset to default', onSelect: () => {} },
	{ label: 'Discard changes', onSelect: () => {} }
];

export default function ControlsMenuPreview() {
	return (
		<div className="adm-stack">
			<div className="adm-actions">
				<Menu label="More" items={LINES} />
				<Menu label="More" size="sm" variant="quiet" items={LINES} />
			</div>
			<div className="adm-actions">
				<Menu label="More" items={LINES} defaultOpen />
			</div>
		</div>
	);
}
