import { supporterSignIn } from '@better-giving/emails';

// the first-time arm, which publishes a supporter's page. the returning arm swaps the heading, the
// opening and the closing and keeps the rest.
export default function SupporterSignIn() {
	return supporterSignIn.template({
		orgName: 'Harbor Light Community Rescue and Family Services Network',
		link: 'https://give.example.org/fundraise/open?token=Zk3f9QxT7mWb2LpV8aDn5EyH1cRj4uSg',
		signInUrl: 'https://give.example.org/fundraise/sign-in',
		arm: { kind: 'first', pageTitle: 'Keep the pantry trucks running this winter' }
	}).node;
}
