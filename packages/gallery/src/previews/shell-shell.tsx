import zapierImage from '@better-giving/operator/brand/zapier.png';
import { PageHeading } from '@better-giving/operator/components/shell/PageHeading';
import { Shell, type ShellProps } from '@better-giving/operator/components/shell/Shell';

/*
 * the operator shell on app-shell-css: the sidebar with the deployer's destinations in their five
 * groups, Settings a parent over its three sections, the account at the foot, and the top bar.
 *
 * the first specimen stands on a Settings section, so the parent is open with its section marked;
 * the second on Gifts, so Settings is shut and Gifts is the page. both run with a navigation
 * in flight, which draws the route-progress line across the top bar. the rail is the toggle in each
 * bar, and a press keeps the choice in this browser, so it holds across both and a reload; on the
 * rail, Settings opens its flyout on hover or keyboard focus and every other row its tooltip. below
 * 48rem the sidebar leaves and the menu button opens the same rows in the drawer.
 *
 * neither specimen has a logo, so the head names the organisation in words and the rail's head is
 * empty: the gallery has no organisation's image to draw.
 */
const settings = [
	{ href: '/admin/settings/organisation', label: 'Organisation details', mark: 'building-2' },
	{ href: '/admin/settings/notifications', label: 'Notifications', mark: 'bell' },
	{ href: '/admin/settings/mail', label: 'Mail', mark: 'mail' }
] as const;

const groups: ShellProps['groups'] = [
	{ destinations: [{ href: '/admin', label: 'Dashboard', mark: 'layout-dashboard' }] },
	{
		destinations: [
			{ href: '/admin/campaigns', label: 'Campaigns', mark: 'megaphone' },
			{ href: '/admin/supporter-pages', label: 'Supporter pages', mark: 'user-plus' },
			{ href: '/admin/forms', label: 'Donation forms', mark: 'form' },
			{ href: '/admin/programs', label: 'Programs', mark: 'folder-heart' },
			{ href: '/admin/donors', label: 'Donors', mark: 'users' },
			{ href: '/admin/donations', label: 'Gifts', mark: 'hand-heart' },
			{ href: '/admin/recurring', label: 'Recurring gifts', mark: 'repeat' }
		]
	},
	{
		destinations: [
			{ href: '/admin/members', label: 'Members', mark: 'shield-check' },
			{ href: '/admin/settings', label: 'Settings', mark: 'settings', children: settings },
			{ href: '/admin/payments', label: 'Payments', mark: 'credit-card' }
		]
	},
	{
		heading: 'Integrations',
		destinations: [
			{ href: '/admin/integrations/zapier', label: 'Zapier', mark: { src: zapierImage } },
			{ href: '/admin/integrations/api', label: 'API', mark: 'key-round' },
			{ href: '/admin/integrations/webhooks', label: 'Webhooks', mark: 'webhook' },
			{ href: '/admin/integrations/connector', label: 'AI', mark: 'sparkles' }
		]
	},
	{ destinations: [{ href: '/admin/books', label: 'Books', mark: 'book-open' }] }
];

const common = {
	orgName: 'Greenfield Food Bank',
	home: { href: '/admin', label: 'Dashboard' },
	groups,
	staff: { name: 'Amara Lindqvist', email: 'amara@greenfieldfoodbank.org' },
	donationPage: '/donate',
	editDonationPage: '/admin/donation-page',
	onSignOut: () => {},
	navigating: true
} satisfies Partial<ShellProps>;

export default function ShellShellPreview() {
	return (
		<div className="adm-stack">
			<Shell
				{...common}
				current={{ label: 'Settings', kind: 'section', child: '/admin/settings/notifications' }}
			>
				<PageHeading
					title="Notifications"
					description="Where this site reaches you about gifts and anything that goes wrong."
					crumbs={[
						{ href: '/admin/settings/organisation', label: 'Settings' },
						{ href: '/admin/settings/notifications', label: 'Notifications' }
					]}
				/>
			</Shell>
			<Shell {...common} current={{ label: 'Gifts', kind: 'page' }}>
				<PageHeading title="Gifts" description="Every gift as it arrived, newest first." />
			</Shell>
		</div>
	);
}
