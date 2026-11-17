import { Button } from '@better-giving/operator/components/controls/Button';
import { PageHeading } from '@better-giving/operator/components/shell/PageHeading';

/*
 * the page header on page-header-css. Gifts carries two secondary actions and its primary: wide,
 * the secondaries are buttons; under 40rem they leave and More holds them beside the primary,
 * which fills the row. the gift's header has crumbs and a status that stays on the title's first
 * line, and the long title shows that line holding when the title wraps at 375. Dashboard is the
 * title and its line with nothing to act on.
 */
export default function ShellPageHeadingPreview() {
	return (
		<div className="adm-stack">
			<PageHeading
				title="Gifts"
				description="Every gift as it arrived, newest first."
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
			<PageHeading
				title="Maya Reyes, $250.00"
				status={<span className="ds-badge ds-badge-success">Completed</span>}
				description="2026-11-14 · Card"
				crumbs={[
					{ href: '/admin/donations', label: 'Gifts' },
					{ href: '/admin/donations/1', label: 'Maya Reyes' }
				]}
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
			<PageHeading title="Dashboard" description="Giving this month, and the year behind it." />
		</div>
	);
}
