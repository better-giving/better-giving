import { Button } from '@better-giving/operator/components/controls/Button';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Stack } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { data, Form } from 'react-router';
import { operatorLinks } from '$lib/admin/operator-links';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { placePostedPhoto, readLiveLink } from '$lib/server/connector/photos';
import { database } from '../context';
import type { Route } from './+types/photo.$token';

// the page a chat's photo link opens ($lib/server/connector/photos.ts): one photo, for one page,
// once, within half an hour. no dashboard session — the link is the permission — so it shows only
// whether the link still works and a file box, and the photo lands in the page's draft, which donors
// see only after Publish.

export const links = operatorLinks;

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Add a photo' }, { name: 'robots', content: 'noindex' }];
}

export async function loader({ context, params }: Route.LoaderArgs) {
	const link = await readLiveLink(context.get(database), params.token);
	return data(
		{ live: link !== null },
		{ headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } }
	);
}

export async function action({ context, params, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	const placed = await placePostedPhoto(context.get(database), params.token, request);
	if (placed.ok) return { placed: true as const };
	return data({ placed: false as const, error: placed.error }, { status: placed.status });
}

export default function PhotoLink({ loaderData, actionData }: Route.ComponentProps) {
	if (actionData?.placed) {
		return (
			<PanelRoute>
				<h1>Photo added</h1>
				<Banner tone="done" word="Added">
					The photo is on the page’s draft. Go back to the chat to place it or publish.
				</Banner>
			</PanelRoute>
		);
	}
	return (
		<PanelRoute>
			<h1>Add a photo</h1>
			{actionData && !actionData.placed ? (
				<Banner tone="blocker" word="Not added">
					{actionData.error}
				</Banner>
			) : null}
			{loaderData.live ? (
				<Form method="post" encType="multipart/form-data">
					<Stack tight>
						<label>
							Photo (WebP, JPEG or PNG)
							<input type="file" name="file" accept="image/webp,image/jpeg,image/png" required />
						</label>
						<div className="adm-actions">
							<Button variant="primary">Add photo</Button>
						</div>
					</Stack>
				</Form>
			) : (
				<Banner tone="blocker" word="Link no longer works">
					This link was used already, has expired, or was disconnected. Ask the chat for a new one.
				</Banner>
			)}
		</PanelRoute>
	);
}
