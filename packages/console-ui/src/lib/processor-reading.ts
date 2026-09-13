import { redirect } from 'react-router';
import { readPayments, readRecurring } from '../api/client';
import { readConsole } from './console-reading';
import { holdBar } from './progress-bar';

// what both processor pages are read off (../routes/_sections.payments.stripe.tsx,
// ../routes/_sections.payments.paypal.tsx): the console's reading, which the sections layout above
// them reads too and this joins rather than taking again (./console-reading.ts), and the two
// readings of the processor accounts — each page adding the one setup run it draws.
//
// **a processor page exists only on the ready face.** every section under it is drawn over a
// deployment whose address was read and whose session answers, so any other face is `/`, which is
// where that face is drawn and where its way out is. the reading is awaited, so a redirect is decided
// before anything renders.
//
// **the setup run is read after that decision and never before it.** a run that landed is consumed
// by the reading that observed it (../api/client.ts), so a read on a face that redirects is a report
// thrown away with nothing on screen to give it.
//
// **the bar over the screen being replaced is finished here too**: a processor page is opened from
// the rail, which reads nothing again above it, and is an address an operator can reload — both put a
// bar on the screen until this reading is in (./progress-bar.ts).

export async function readProcessorScreen<Run>(request: Request, readRun: () => Promise<Run>) {
	const bar = holdBar(new URL(request.url).pathname);
	const { reading } = await readConsole(request);
	if (reading.face.kind !== 'ready') throw redirect('/', 307);

	// promises and not values, which is what lets the keys draw before the deployment is asked: both
	// go through its console surface, and the boxes are drawn out of what cloudflare said.
	//
	// **both reads are made whatever this deployment holds.** each answers for every processor it
	// holds the credentials for and carries nothing at all for one it does not (`ProcessorPayments`
	// and `RecurringReport` in ../api/types.ts), so gating either on a Stripe key would leave a
	// deployment set up on PayPal alone with no reading of the account it does charge on — and, on
	// the recurring one, no press that could put what a repeating gift needs on it.
	const payments = readPayments();
	const recurring = readRecurring();
	const run = await readRun();
	await bar.finish();

	return {
		address: reading.face.address,
		payments,
		recurring,
		run
	};
}
