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
	}
	var once sync.Once
	return func() { once.Do(let) }
}

func let() {
	mutex.Lock()
	defer mutex.Unlock()
	holds--
	if holds > 0 {
		return
	}
	// Stop returns once every signal delivered before it is on the channel.
	signal.Stop(caught)
	select {
	case <-caught:
		_ = syscall.Kill(os.Getpid(), syscall.SIGHUP)
		time.Sleep(ending)
	default:
	}
}
