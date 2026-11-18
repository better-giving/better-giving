import { ActionMenu } from '@better-giving/operator/components/controls/ActionMenu';
import { Mark } from '@better-giving/operator/components/status/Mark';

/*
 * a press and its panel on menu-css. the first is a row's More, two runs parted by a separator and
 * a destructive row last; the second is the account's, under a header, held open, since a panel
 * is the one state no press reaches on a page that has to stay readable. the keys are ark's.
 */
export default function ControlsActionMenuPreview() {
	return (
		<div className="adm-stack">
			<ActionMenu
				placement="below-end"
				trigger={
					<button
						type="button"
						className="ds-icon-bare ds-icon-bare-sm"
						aria-label="More actions for Winter appeal"
					>
						<Mark name="ellipsis" />
					</button>
				}
				runs={[
					[
						{ label: 'Edit', mark: 'pencil', href: '/admin/forms/1', internal: true },
						{ label: 'Duplicate', mark: 'copy', onSelect: () => {} }
					],
					[{ label: 'Delete form', mark: 'trash-2', destructive: true, onSelect: () => {} }]
				]}
			/>
			<ActionMenu
				placement="below-end"
				open
				header={{ title: 'Amara Lindqvist', meta: 'amara@greenfieldfoodbank.org' }}
				trigger={
					<button type="button" className="ds-btn ds-btn-secondary">
						Account
					</button>
				}
				runs={[
					[
						{ label: 'Edit donation page', mark: 'globe', href: '/admin/donation-page' },
						{ label: 'Open donation page', mark: 'eye', href: '/donate' }
					],
					[{ label: 'Sign out', mark: 'log-out', onSelect: () => {} }]
				]}
			/>
		</div>
	);
}
