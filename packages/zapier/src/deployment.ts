import type { Bundle, ZObject } from 'zapier-platform-core';

/**
 * `path` on the deployment the connection names. refuses an address that is not `https:` before
 * any request is made, because every request carries the key.
 */
export function deploymentUrl(z: ZObject, bundle: Bundle, path: string): string {
	const address = bundle.authData.address ?? '';
	const origin = URL.canParse(address) ? new URL(address) : null;
	if (origin?.protocol !== 'https:') {
		throw new z.errors.Error(
			`The deployment address ${JSON.stringify(address)} is not an https:// address. Reconnect with the address your deployment answers on, such as https://give.example.org.`,
			'InvalidAddress'
		);
	}
	return new URL(path, origin.origin).href;
}
