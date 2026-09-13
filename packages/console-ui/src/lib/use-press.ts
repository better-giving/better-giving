import { useFetchers, useNavigation } from 'react-router';
import { CHECK_INTENT } from './close-confirm';

// where a section page's presses stand, read the same way on every page.
//
// **the posted intent is carried through the re-read as well as through the request**
// (`getLoadingNavigation` in the installed `react-router`), so it names the press in flight and
// cannot say the answer has landed; `revalidating` is what says that — the router has the press's
// answer and is reading the page again over it (./stripe-press.ts).
//
// **the strip's check press is a fetcher and not a navigation** (./close-confirm.tsx), so it is read
// off the fetchers: every press on the page holds while everything is being read again, as it did
// when that press was a form on the page.

export function usePress() {
	const navigation = useNavigation();
	const posted = navigation.formData?.get('intent');
	const intent = typeof posted === 'string' ? posted : null;
	const checking = useFetchers().some(
		(fetcher) => fetcher.formData?.get('intent') === CHECK_INTENT
	);
	return {
		/** which intent is in flight, or `null` where none is. */
		intent,
		/** something on the page is writing or reading everything again. */
		busy: intent !== null || checking,
		revalidating: navigation.state === 'loading'
	};
}
