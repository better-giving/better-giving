import { createContext } from 'react';

// whether the browser carries the returning-staff marker ($lib/staff-marker.ts), handed down from
// the root route's loader to the site footer (./site-footer.tsx) so no donor page threads a flag
// through its own props. false where nothing provides it, which is a donor's page.
export const StaffMarkerContext = createContext(false);
