import { data } from 'react-router';
import { donorPageRateLimitRefusal } from '$lib/server/api/rate-limit';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { parseMessageCursor } from '$lib/server/pages/messages';
import { readDonationPageMessages } from '$lib/server/pages/view';
import { database, overDonorPageLimit, platform } from '../context';
import type { Route } from './+types/donate.messages';

// Show more messages on /donate: the next six donors' messages after `?after=`, the `next` the page
// or the last press was handed (`DonateProfile.messages` in $lib/donate/profile.ts). a `loader` and
// no component, asked by a plain `fetch` ($lib/donate/show-more.ts), which reads its JSON.
//
// nested under ./donate.tsx by its name, so that page's `meterDonorPage` charges every press to the
// same bucket a view of the page spends. `no-store` like the page: a list a hide or a refund changes
// is no capability and no immutable bytes ($lib/server/runtime/response-cache.ts).
//
// it lists nothing where the page lists nothing: a page drawn as the donation box alone, or refused,
// draws no messages (`readDonationPageMessages` in $lib/server/pages/view.ts), and this answers
// the same then, so a broken page shows its donors no messages here either. the editor's preview
// reads its first six there too, so its Show more continues the list it drew.

const NO_STORE = { 'cache-control': 'no-store' };

export async function loader({ context, request }: Route.LoaderArgs) {
	if (context.get(overDonorPageLimit)) return donorPageRateLimitRefusal();
	const after = new URL(request.url).searchParams.get('after');
	const cursor = after === null ? null : parseMessageCursor(after);
	if (after !== null && cursor === null) {
		return data({ kind: 'refused' } as const, { status: 400, headers: NO_STORE });
	}
	const db = context.get(database);
	const { env } = context.get(platform);
	// a failed read answers as a refusal rather than a throw, so its body is this route's JSON and
	// not the runtime's plain-text 500.
	let page: Awaited<ReturnType<typeof readDonationPageMessages>>;
	try {
		const row = await ensureDonationPage(db);
		page = await readDonationPageMessages(db, env, row, request, { now: Date.now() }, cursor);
	} catch (e) {
		console.error('reading donor messages for show more failed:', e);
		return data({ kind: 'refused' } as const, { status: 500, headers: NO_STORE });
	}
	return data({ kind: 'messages', ...page } as const, { headers: NO_STORE });
}
