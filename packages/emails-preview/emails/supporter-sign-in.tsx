import { supporterSignIn } from '@better-giving/emails';

// the first-time arm, which publishes a supporter's page. the returning arm, whose subject and
// heading carry the organisation's name, is ./supporter-sign-in-returning.tsx.
export default function SupporterSignIn() {
	return supporterSignIn.template({
		orgName: 'Harbor Light Community Rescue and Family Services Network',
		link: 'https://give.example.org/fundraise/open?token=Zk3f9QxT7mWb2LpV8aDn5EyH1cRj4uSg',
		signInUrl: 'https://give.example.org/fundraise/sign-in',
		linkLifetimeMs: 60 * 60 * 1000,
		arm: { kind: 'first', pageTitle: 'Keep the pantry trucks running this winter' }
	}).node;
}
