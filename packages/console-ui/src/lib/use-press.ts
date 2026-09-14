import { useNavigation } from 'react-router';

// where a section page's presses stand, read the same way on every page.
//
// **the posted intent is carried through the re-read as well as through the request**
// (`getLoadingNavigation` in the installed `react-router`), so it names the press in flight and
// cannot say the answer has landed; `revalidating` is what says that — the router has the press's
// answer and is reading the page again over it (./stripe-press.ts).

export function usePress() {
	const navigation = useNavigation();
	const posted = navigation.formData?.get('intent');
	const intent = typeof posted === 'string' ? posted : null;
	return {
		/** which intent is in flight, or `null` where none is. */
		intent,
		/** a press on the page is in flight, or the page is being read again over its answer. */
		busy: intent !== null,
		revalidating: navigation.state === 'loading'
	};
}
