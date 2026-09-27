// whether the press the page just made was turned down over what its boxes held.
//
// **a refusal wrote nothing, so a reading after it can only draw what is already on the screen.**
// what it costs instead is the answer's own render: the router carries the posted intent through
// the re-read (`getLoadingNavigation` in the installed `react-router`), so the press reads as in
// flight for the whole of it — the button on `Saving` over the refusal, and the boxes closed on the
// render the seam sends focus to the first one named (./use-console-form.ts), where a closed box
// takes none. `consoleRereads` (./dialog-params.ts) declines the reading here, and the navigation
// ends on the render the answer lands in.
//
// the router hands the answer over untyped, so each shape is read field by field.

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

/** whether an answer off a console page's action is a refusal of what the boxes held. */
export function saidRefused(answer: unknown): boolean {
	if (!isRecord(answer)) return false;
	// the organisation and notifications folds: the deployment's refusal of the profile (`OrgWrite`).
	const write = answer.write;
	if (isRecord(write) && write.kind === 'refused') return true;
	// the sites fold: the list turned down by its parse, at either end, or over a site a form still
	// lists (`SitesWrite`).
	const sites = answer.sites;
	if (isRecord(sites) && isRecord(sites.written)) {
		const { kind } = sites.written;
		if (kind === 'refused' || kind === 'blocked') return true;
	}
	// a group of deploy-time values, the mail credentials among them: boxes this console could not
	// read as an act, answered before anything was sent (`groupPress` in ./group-press.ts).
	const secrets = answer.secrets;
	if (isRecord(secrets) && isRecord(secrets.errors)) return true;
	// the mail fold's test send: an address the deployment would not send to (`TestSend`).
	const test = answer.test;
	if (isRecord(test) && test.kind === 'bad-address') return true;
	return false;
}
