package server

import "sync"

// what this process is holding while it is being told to stop.
//
// **it exists because a press outlives the request that started it.** the payments setup is the
// one this server still holds, and it is several round trips across three hosts: a console that
// went away mid-run leaves the processor account holding an endpoint the deployment has no key to
// verify against, and nothing on the machine says so. so the terminal that is stopping asks what is
// going, names it, and waits. the two deploys are not on this list at all — they are terminal
// commands and the terminal running one is the terminal being stopped
// (../../cmd/better-giving/start.go).
//
// **it carries a sentence and never the run.** what a stop prints is read by an operator who is
// watching a console close, so each holder hands over the one line that says what they are waiting
// for; nothing here reaches the outcome, which is the page's to draw and not a terminal's.
//
// **and it carries the stop into a run's wait for the edge**, the one signal sent the other way:
// Stopping is what each run's waits are bound with (./stripe.go, ./paypal.go), so a stop cuts a
// wait short and never a call.

// Presses is every long press this server holds, as the readings a stop makes.
type Presses struct {
	mutex sync.Mutex
	going []func() (string, bool)
	// stopped is closed by Stop, and made on first use so the zero value is ready.
	stopped chan struct{}
}

// Stop tells every press's wait for the edge that the console is going, and is safe to make twice.
//
// **the wait and never the press.** every call a run makes is still waited for by the stop
// (../../cmd/better-giving/main.go's waitForPress); what a stop cuts short is a run asking the
// deployment again for a key its edge is not serving yet, whose outcome the next press finishes
// anyway (../deployment/keyed.go).
func (presses *Presses) Stop() {
	stopping := presses.Stopping()
	presses.mutex.Lock()
	defer presses.mutex.Unlock()
	select {
	case <-stopping:
	default:
		close(presses.stopped)
	}
}

// Stopping closes once Stop has been made.
func (presses *Presses) Stopping() <-chan struct{} {
	presses.mutex.Lock()
	defer presses.mutex.Unlock()
	if presses.stopped == nil {
		presses.stopped = make(chan struct{})
	}
	return presses.stopped
}

// Going names the press this process is holding, or reports there is none.
func (presses *Presses) Going() (string, bool) {
	presses.mutex.Lock()
	defer presses.mutex.Unlock()
	for _, read := range presses.going {
		if said, going := read(); going {
			return said, true
		}
	}
	return "", false
}

// watch adds one holder's reading, which the routes do as they are built.
func (presses *Presses) watch(read func() (string, bool)) {
	presses.mutex.Lock()
	defer presses.mutex.Unlock()
	presses.going = append(presses.going, read)
}
