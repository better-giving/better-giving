import { Button } from '@better-giving/operator/components/controls/Button';
import { PageHeading } from '@better-giving/operator/components/shell/PageHeading';

/*
 * the page header on page-header-css, in its two shapes. Gifts has a sidebar entry: its h1 is
 * hidden and the header is one end-aligned row of two secondary actions and the primary; under
 * 40rem the secondaries leave and More holds them beside the primary, which fills the row.
 * Dashboard has a sidebar entry and nothing to act on, so it draws only its hidden h1 (nothing
 * shows). the two gifts are nested pages: the trail ends in the h1, with the status on its first
 * line and the line under the trail, and the long one shows that line holding when the name
 * wraps at 375.
 */
export default function ShellPageHeadingPreview() {
	return (
		<div className="adm-stack">
			<PageHeading
				title="Gifts"
				primary={
					<Button as="a" href="/admin/donations/new" variant="primary" mark="plus">
						Add donation
					</Button>
				}
				secondary={[
					{ label: 'Export', href: '/admin/donations/export', internal: true },
					{ label: 'Public messages', href: '/admin/donations/messages', internal: true }
				]}
			/>
			<PageHeading title="Dashboard" />
			<PageHeading
				title="Maya Reyes, $250.00"
				status={<span className="ds-badge ds-badge-success">Completed</span>}
				description="2026-11-14 · Card"
				crumbs={[
					{ href: '/admin/donations', label: 'Gifts' },
					{ href: '/admin/donations/1', label: 'Maya Reyes' }
				]}
				secondary={[{ label: 'Send receipt again', onSelect: () => {} }]}
			/>
			<PageHeading
				title="Margarethe Van Der Aalst-Whitmore, $1,250.00 for the winter coat drive"
				status={<span className="ds-badge ds-badge-warning">Pending</span>}
				description="2026-11-13 · DAF grant"
				crumbs={[
					{ href: '/admin/donations', label: 'Gifts' },
					{ href: '/admin/donations/2', label: 'Margarethe Van Der Aalst-Whitmore' }
				]}
			/>
		</div>
	);
}
