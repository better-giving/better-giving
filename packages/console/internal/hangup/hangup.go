// Package hangup holds this process past a closed terminal for the length of a press.
//
// **a hang-up is the terminal going away, and its default action is the process going with it.** a
// terminal window closed, an ssh session dropped or a tmux pane killed sends SIGHUP, and nothing in
// this binary takes it but this: bubbletea takes SIGINT and SIGTERM, and only while it draws. a
// press killed halfway is the damage the one-way door is there to prevent — a database migrated
// under code that was never uploaded (CLAUDE.md), or a stripe endpoint created and its signing
// secret, whose only copy is in this process, never stored (../stripe/setup.go).
//
// **the hang-up is held, not dropped, and delivered at the last release.** the operator's terminal
// is gone either way; what they lose is the press, not the ending. so a hang-up that arrived under a
// hold is sent again once no hold is left, and the process ends then, as it would have — rather
// than going on to serve a console, holding its port, for a terminal nobody is at.
//
// **a held hang-up is heard at once, not only at the release.** Heard closes the moment one is
// caught, so a wait with nothing left to finish (../deployment/keyed.go's wait for the edge) ends
// then rather than sitting out its bound for a terminal that is gone; the calls a press makes are
// still held to the end.
//
// **a hold is on SIGHUP alone.** a ctrl-c during a press is bubbletea's to take and the ledger's to
// report (../terminal/ledger.go's StillGoing), and a second one still ends the process.
//
// **the last release hands back the handling the process started with**, which is what a Stop after
// a Notify does. a process started ignoring hang-ups (nohup) is one no hold has anything to do
// for, and one the release never re-sends to: the re-sent hang-up would be ignored, and the release
// would wait on an ending that never comes.
package hangup

import (
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

// read at package init, which is in front of any Notify: once one has run, go no longer reports an
// inherited SIG_IGN as ignored.
var ignoredFromTheStart = signal.Ignored(syscall.SIGHUP)

var (
	mutex sync.Mutex
	holds int
	// caught is the one channel every hold shares, notified while holds is above zero.
	caught = make(chan os.Signal, 1)
	// listening ends the watch over caught, and its answer is whether the watch took a hang-up.
	listening chan struct{}
	took      chan bool
	heard     = make(chan struct{})
	hearing   sync.Once
)

// how long a release that re-sent a held hang-up waits for it to end the process before returning:
// the kill may land on another thread, and the caller's next line would otherwise run past the end.
const ending = time.Second

// Hold keeps a hang-up from ending this process until the returned release is called, and a
// hang-up that arrived in between ends the process at the release. holds nest: a hang-up waits for
// the last one. calling a release twice releases once.
func Hold() (release func()) {
	if ignoredFromTheStart {
		return func() {}
	}
	mutex.Lock()
	defer mutex.Unlock()
	holds++
	if holds == 1 {
		signal.Notify(caught, syscall.SIGHUP)
		listening, took = make(chan struct{}), make(chan bool, 1)
		go watch(listening, took)
	}
	var once sync.Once
	return func() { once.Do(let) }
}

// Heard closes once a hang-up is caught under a hold, and stays closed for the life of the process.
//
// never reopened because the process does not outlive it: the last release re-sends the hang-up
// and its default action ends the process there. a second SIGHUP listener anywhere in the binary
// would take that re-sent hang-up instead, leaving a live process whose every later wait for the
// edge reads as stopped at its first ask.
func Heard() <-chan struct{} {
	return heard
}

func watch(listening <-chan struct{}, took chan<- bool) {
	saw := false
	for {
		select {
		case <-caught:
			saw = true
			hearing.Do(func() { close(heard) })
		case <-listening:
			took <- saw
			return
		}
	}
}

func let() {
	mutex.Lock()
	defer mutex.Unlock()
	holds--
	if holds > 0 {
		return
	}
	// once Stop returns, caught receives no more hang-ups. one dropped before it on the full
	// one-slot buffer came behind one already held, which the watch took or the drain below finds.
	signal.Stop(caught)
	close(listening)
	// a hang-up the watch took, or one it had not reached when it was told to stop.
	held := <-took
	select {
	case <-caught:
		held = true
	default:
	}
	if held {
		_ = syscall.Kill(os.Getpid(), syscall.SIGHUP)
		time.Sleep(ending)
	}
}
