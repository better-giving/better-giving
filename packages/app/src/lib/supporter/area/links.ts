import registryBadge from '@better-giving/operator/registry/styles/badge-css.css?url';
import registryDropzone from '@better-giving/operator/registry/styles/file-dropzone-css.css?url';
import registryNoticeCard from '@better-giving/operator/registry/styles/notice-card-css.css?url';
import registryProgress from '@better-giving/operator/registry/styles/progress-css.css?url';
import registrySpamCheck from '@better-giving/operator/registry/styles/spam-check-css.css?url';
import registryStateCard from '@better-giving/operator/registry/styles/state-card-css.css?url';
import registryTable from '@better-giving/operator/registry/styles/table-css.css?url';
import { donorPageLinks } from '$lib/donate/plain-page';
import area from './area.css?url';

// the stylesheets a supporter screen's route links: the donor page's own chain (`donorPageLinks`
// in $lib/donate/plain-page.tsx — the form's tokens and its button and field, the faces, the page's
// chrome), then the registry's sheets for the parts a donor page draws none of, then ./area.css.
// the photo's dropzone and the spam check's slot also wear the chain's button and field classes.
// the registry sheets read only the roles the form's token file already declares on this root, and
// every one of them is unlayered, as the donor chain is; nothing here is layered, so their order
// is source order and ./area.css, last, places what they draw.
export function supporterAreaLinks() {
	return [
		...donorPageLinks(),
		...[
			registryBadge,
			registryProgress,
			registryNoticeCard,
			registryStateCard,
			registryTable,
			registryDropzone,
			registrySpamCheck,
			area
		].map((href) => ({ rel: 'stylesheet' as const, href }))
	];
}
