import { Breadcrumbs } from '@better-giving/operator/components/controls/Breadcrumbs';

/*
 * every state Breadcrumbs offers: a trail of two and of four, the two pointer states pinned on the
 * link to the page directly above (PointerState in packages/operator/src/components/closed-sets.js),
 * and a trail whose labels are long enough to wrap the list and a label inside its own item.
 *
 * a trail of one draws nothing, which is not a specimen — there is nothing to look at.
 *
 * each trail sits in a plain block rather than straight in the stack: the focused link's tint in
 * packages/operator/src/styles/base.css bleeds past its own box, and a trail placed straight into
 * the stack would stretch to the page's width.
 */
export default function ControlsBreadcrumbsPreview() {
	return (
		<div className="adm-stack">
			<div>
				<Breadcrumbs
					items={[
						{ href: '#forms', label: 'Donation forms' },
						{ href: '#winter', label: 'Winter appeal' }
					]}
				/>
			</div>
			<div>
				<Breadcrumbs
					items={[
						{ href: '#forms', label: 'Donation forms' },
						{ href: '#winter', label: 'Winter appeal' },
						{ href: '#sites', label: 'Sites' },
						{ href: '#site', label: 'riverbank.org' }
					]}
				/>
			</div>
			<div>
				<Breadcrumbs
					state="hover"
					items={[
						{ href: '#donors', label: 'Donors' },
						{ href: '#donor', label: 'hover' },
						{ href: '#gift', label: 'Gift of 12 November 2025' }
					]}
				/>
			</div>
			<div>
				<Breadcrumbs
					state="focus"
					items={[
						{ href: '#donors', label: 'Donors' },
						{ href: '#donor', label: 'focus' },
						{ href: '#gift', label: 'Gift of 12 November 2025' }
					]}
				/>
			</div>
			<div>
				<Breadcrumbs
					items={[
						{ href: '#recurring', label: 'Recurring gifts' },
						{
							href: '#donor',
							label: 'Recurring gift from Margarethe Van Der Aalst-Whitmore'
						},
						{ href: '#collections', label: 'Collections that could not be made this month' },
						{ href: '#attempt', label: 'Attempt on 1 December 2025' }
					]}
				/>
			</div>
		</div>
	);
}
