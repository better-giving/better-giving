import type { Authentication, Bundle, ZObject } from 'zapier-platform-core';
import { deploymentUrl } from './deployment.js';

// the connection is two values: where the deployment answers and the key its console made. the
// key rides every request as a bearer, set once by ./middleware.ts.

/** who the key belongs to. `organisation` is the deployment's public field, `null` until it has a legal name. */
type Me = { organisation: string | null };

async function test(z: ZObject, bundle: Bundle): Promise<Me> {
	const response = await z.request({ url: deploymentUrl(z, bundle, '/zapier/me') });
	// any site can answer 200; a deployment's answer carries `organisation`.
	if (!isMe(response.data)) {
		throw new z.errors.Error(
			`${JSON.stringify(bundle.authData.address)} is not a Better Giving deployment: it did not answer as one. Reconnect with the address your deployment answers on.`,
			'NotADeployment'
		);
	}
	return response.data;
}

function isMe(value: unknown): value is Me {
	return typeof value === 'object' && value !== null && 'organisation' in value;
}

/** the name a connection is listed under: the organisation, or the deployment's host until it has one. */
async function connectionLabel(_z: ZObject, bundle: Bundle): Promise<string> {
	const { organisation } = bundle.inputData as Partial<Me>;
	return organisation ?? new URL(bundle.authData.address ?? '').host;
}

export default {
	type: 'custom',
	fields: [
		{
			key: 'address',
			label: 'Deployment address',
			type: 'string',
			required: true,
			helpText: 'Where your Better Giving deployment answers, such as `https://give.example.org`.'
		},
		{
			key: 'key',
			label: 'Zapier key',
			type: 'password',
			required: true,
			helpText: 'The key made under Zapier in the Better Giving console. It starts with `bgz_`.'
		}
	],
	test,
	connectionLabel
} satisfies Authentication;
