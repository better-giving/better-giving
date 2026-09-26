import type {
	BasicHookOperation,
	Trigger,
	WebhookTriggerPerformList,
	WebhookTriggerPerformSubscribe,
	WebhookTriggerPerformUnsubscribe
} from 'zapier-platform-core';
import { deploymentUrl } from '../deployment.js';

/** a trigger the deployment has, by the key its `/zapier` routes name it with. */
type TriggerKey = 'new_gift' | 'new_donor' | 'gift_refunded';

type HookTrigger = {
	key: TriggerKey;
	noun: string;
	label: string;
	description: string;
	sample: Record<string, unknown>;
};

/** a REST hook trigger on the deployment's `/zapier` routes. */
export function hookTrigger({ key, noun, label, description, sample }: HookTrigger) {
	const performSubscribe = (async (z, bundle) => {
		const response = await z.request({
			method: 'POST',
			url: deploymentUrl(z, bundle, '/zapier/hooks'),
			body: { trigger: key, hook_url: bundle.targetUrl }
		});
		return response.data as { id: string };
	}) satisfies WebhookTriggerPerformSubscribe;

	const performUnsubscribe = (async (z, bundle) => {
		const { id } = bundle.subscribeData as { id: string };
		await z.request({
			method: 'DELETE',
			url: deploymentUrl(z, bundle, `/zapier/hooks/${encodeURIComponent(id)}`)
		});
		return {};
	}) satisfies WebhookTriggerPerformUnsubscribe;

	// how many, and in what order, is the deployment's (packages/app/src/routes/zapier.samples.$trigger.ts).
	const performList = (async (z, bundle) => {
		const response = await z.request({
			url: deploymentUrl(z, bundle, `/zapier/samples/${key}`)
		});
		return (response.data as { data: Record<string, unknown>[] }).data;
	}) satisfies WebhookTriggerPerformList;

	const operation = {
		type: 'hook',
		performSubscribe,
		performUnsubscribe,
		perform: (_z, bundle) => [bundle.cleanedRequest],
		performList,
		sample
	} satisfies BasicHookOperation;

	return { key, noun, display: { label, description }, operation } satisfies Trigger;
}
