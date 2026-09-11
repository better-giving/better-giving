package terminal

import (
	"io"
	"strings"

	"github.com/charmbracelet/x/ansi"
	"github.com/charmbracelet/x/term"
)

// how this console's prose reaches a terminal: broken to a measure it can be read at, and spaced so
// that consecutive blocks read as blocks.
//
// **one thing breaks a line, and it is this file.** a sentence broken by hand in the format string
// it is printed from is one this file then breaks again, so what comes out is a line of four words
// under a line of eleven. every sentence this console writes at a terminal goes through ./Say, and
// none carries a break of its own except where it is two paragraphs (./wrap). what does not come
// through here is what nothing here could measure: ./ledger.go and ./waiting.go are drawn by
// bubbletea over the whole screen, ../../internal/account's picker by huh, and the flag block under
// a command's own words by the standard library's flag package.
//
// **the measure is counted in cells and never in bytes.** ./ledger.go's Code and Cmd render through
// lipgloss, so a sentence naming a press or a path is longer in bytes than it is on the screen —
// and a break counted over the escape codes lands early, and lands in a different place in each
// sentence depending on how many marked spans it carries.
//
// **what an operator copies is never broken.** an indented line is layout — a column of filenames,
// a row of facts, the install line a stopped update leaves — and it goes out exactly as it stands
// however far past the measure it runs, because a command broken across two lines is one that does
// not paste back. the one indented line that is not layout is a bulleted one: that is a sentence in
// a list rather than a row anybody copies, and ./broken breaks it as a sentence with its
// continuations set under its first word. ./Lines and ./Line are the other half of that reading,
// for the blocks that are layout from their first character: ./confirm.go's facts, the filenames it
// lists and ../../cmd/better-giving/main.go's command table. what cloudflare itself said is
// composed into a sentence rather than printed on its own, so it is set in from the margin where
// that happens (../../cmd/better-giving/start.go's setIn) and reaches this file already marked as
// layout.
//
// **a block ends in the blank line under it rather than opening on one.** nothing here holds state
// between calls — `to` is handed down through both packages and there is no one writer to remember
// against — so a block that spaced itself from above would have to know what came before it, and
// the space is put under instead: two blocks running are one blank line apart either way, and a
// block drawn at the top of a screen ./clear.go has just erased still starts at the top of it.

// widest is the measure prose is broken to where nothing narrower says otherwise.
const widest = 76

// Say writes one block of prose at `to`, broken to a reading measure and with a blank line under
// it, and nothing at all for a block with nothing to say.
func Say(to io.Writer, said string) {
	if said == "" {
		return
	}
	_, _ = io.WriteString(to, wrap(said, measure(to))+"\n\n")
}

// Lines writes one block of layout at `to` — rows exactly as they stand, and a blank line under
// them.
//
// Called with no rows it writes that blank line alone, which is how a block drawn a row at a time
// through ./Line is closed.
func Lines(to io.Writer, said ...string) {
	if len(said) == 0 {
		return
	}
	for _, row := range said {
		Line(to, row)
	}
	_, _ = io.WriteString(to, "\n")
}

// Line writes one row of layout at `to` and nothing under it, for the block that arrives a row at a
// time while the run that draws it is still going (../../cmd/better-giving/main.go's installing).
func Line(to io.Writer, said string) {
	if said == "" {
		return
	}
	_, _ = io.WriteString(to, said+"\n")
}

// measure is how wide a block written at `to` may be.
func measure(to io.Writer) int { return measured(to, term.GetSize) }

// the same reading with what says how wide a terminal is handed in, because a test process is not
// running at one (./say_test.go), which is ./prompt.go's arrangement for the same reason.
//
// a pipe and a file carry a descriptor exactly as a terminal does and neither has a width, so what
// says there is no terminal here is the read itself rather than the descriptor.
func measured(to io.Writer, size func(uintptr) (width, height int, err error)) int {
	file, carried := to.(interface{ Fd() uintptr })
	if !carried {
		return widest
	}
	width, _, err := size(file.Fd())
	if err != nil || width <= 0 {
		return widest
	}
	return min(width, widest)
}

// wrap breaks `said` to `at` columns, at the spaces and nowhere else.
//
// A break the sentence already carries is kept, so a value composed as two paragraphs stays two —
// and each of them is broken on its own.
func wrap(said string, at int) string {
	lines := strings.Split(said, "\n")
	for line := range lines {
		lines[line] = broken(lines[line], at)
	}
	return strings.Join(lines, "\n")
}

// the marker a row of prose in a list opens on.
const bullet = "- "

// broken is one line of prose at the measure, or the line itself where it is layout.
//
// **an indented line is layout, and a bullet is the one that is not.** a row of facts, a filename
// in a column and the install line a stopped update leaves are all read as a column or copied out
// of one, and each opens on its indent alone. a row opening on ./bullet is a sentence in a list, so
// it is broken like a sentence — with every line after the first set under its first word, leaving
// the marker the only thing in the left channel.
func broken(line string, at int) string {
	if at <= 0 {
		return line
	}
	indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
	if indent == "" {
		return folded(strings.Fields(line), "", "", at)
	}
	said, bulleted := strings.CutPrefix(line[len(indent):], bullet)
	if !bulleted {
		return line
	}
	return folded(strings.Fields(said), indent+bullet,
		indent+strings.Repeat(" ", len(bullet)), at)
}

// words folded to `at` columns, `opening` in front of the first line and `under` in front of every
// line after it.
func folded(words []string, opening, under string, at int) string {
	said := &strings.Builder{}
	said.WriteString(opening)
	width := ansi.StringWidth(opening)
	for row, word := range words {
		cells := ansi.StringWidth(word)
		switch {
		case row == 0:
			said.WriteString(word)
			width += cells
		case width+1+cells > at:
			said.WriteString("\n" + under + word)
			width = ansi.StringWidth(under) + cells
		default:
			said.WriteString(" " + word)
			width += 1 + cells
		}
	}
	return said.String()
}
