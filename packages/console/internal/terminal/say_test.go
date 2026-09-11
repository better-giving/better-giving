package terminal

import (
	"bytes"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func TestAParagraphBreaksAtTheMeasure(t *testing.T) {
	said := wrap(strings.Repeat("word ", 40), 76)
	for _, line := range strings.Split(said, "\n") {
		if len(line) > 76 {
			t.Errorf("a line runs %d columns past the measure: %q", len(line)-76, line)
		}
	}
	if !strings.Contains(said, "\n") {
		t.Errorf("nothing was broken: %q", said)
	}
}

func TestALongTokenIsNeverBrokenInTheMiddle(t *testing.T) {
	// a path, an address or an install line is copied out of the terminal, and one broken across
	// two lines is one that does not paste back.
	line := "curl -fsSL https://github.com/better-giving/console/releases/latest/download/x.sh | sh"
	for _, word := range strings.Fields(wrap(line, 40)) {
		if !strings.Contains(line, word) {
			t.Errorf("%q is not a word of the line, so a token was broken", word)
		}
	}
}

func TestABreakTheSentenceAlreadyCarriesIsKept(t *testing.T) {
	// a sentence composed as two lines is two paragraphs, and folding them into one would put a
	// break where the words do not want one.
	said := wrap("one line\nanother line", 76)
	if said != "one line\nanother line" {
		t.Errorf("wrap = %q, which lost the break the sentence carried", said)
	}
}

func TestAnIndentedLineIsLayoutAndIsLeftAsItStands(t *testing.T) {
	// the install line a stopped update leaves is copied out of the terminal, and a break this
	// measure put in it is one that does not paste back.
	row := "  curl -fsSL https://example.com/install.sh | sh"
	if said := wrap("install it yourself:\n"+row, 20); !strings.Contains(said, row) {
		t.Errorf("wrap = %q, which broke a line that is layout", said)
	}
}

func TestTheMeasureIsTheTerminalWhereItIsNarrowerThanTheReadingMeasure(t *testing.T) {
	if at := measured(os.Stdout, sized(40)); at != 40 {
		t.Errorf("measure at a 40-column terminal = %d, want 40", at)
	}
}

func TestAWideTerminalIsStillReadAtTheReadingMeasure(t *testing.T) {
	// past a reading measure a sentence runs the window, which is what this exists to stop.
	if at := measured(os.Stdout, sized(200)); at != widest {
		t.Errorf("measure at a 200-column terminal = %d, want %d", at, widest)
	}
}

func TestNoTerminalIsTheReadingMeasure(t *testing.T) {
	// a run redirected into a file has no width to ask for, and a record is read at the same
	// measure a screen is.
	var held bytes.Buffer
	if at := measured(&held, sized(40)); at != widest {
		t.Errorf("measure at a buffer = %d, want %d", at, widest)
	}
	if at := measured(os.Stdout, func(uintptr) (int, int, error) {
		return 0, 0, errors.New("not a terminal")
	}); at != widest {
		t.Errorf("measure where the width could not be asked for = %d, want %d", at, widest)
	}
}

// a terminal of a stated width, in place of asking the one this test is running under.
func sized(width int) func(uintptr) (int, int, error) {
	return func(uintptr) (int, int, error) { return width, 24, nil }
}

func TestBlocksAreSeparatedByExactlyOneBlankLine(t *testing.T) {
	var held bytes.Buffer
	Say(&held, "the first block")
	Lines(&held, "  a row", "  another row")
	Say(&held, "the last block")
	same(t, "two blocks and a list", held.String(),
		"the first block\n\n  a row\n  another row\n\nthe last block\n\n")
}

func TestABlockWithNothingToSayTakesNoRoom(t *testing.T) {
	// a sentence is empty for the outcome that landed (./outcome.go), and a blank line where one
	// would have been reads as a block that went missing.
	var held bytes.Buffer
	Say(&held, "")
	Lines(&held)
	if held.Len() != 0 {
		t.Errorf("an empty block wrote %q", held.String())
	}
}

func TestAStyledSpanIsMeasuredInCellsAndNotInBytes(t *testing.T) {
	// ./ledger.go's Code and Cmd render through lipgloss, so a sentence carrying one is longer in
	// bytes than it is on the screen — and a measure taken in bytes breaks it early.
	bold := "\x1b[1mword\x1b[0m"
	said := wrap(strings.Repeat(bold+" ", 20), 76)
	for _, line := range strings.Split(said, "\n") {
		if ansi.StringWidth(line) > 76 {
			t.Errorf("%q is %d cells wide", line, ansi.StringWidth(line))
		}
	}
	if lines := strings.Count(said, "\n") + 1; lines != 2 {
		t.Errorf("twenty four-cell words at 76 columns came out in %d lines, so the measure "+
			"was taken over the escape codes", lines)
	}
}

func TestALongBulletWrapsAndItsContinuationSitsPastTheMarker(t *testing.T) {
	// a bullet is prose in a list and not a row anybody copies, so it is broken like a sentence —
	// and the marker stays the only thing in the left channel.
	said := wrap("  - "+strings.Repeat("word ", 30), 40)
	lines := strings.Split(said, "\n")
	if len(lines) < 2 {
		t.Fatalf("a bullet 150 columns long came out whole: %q", said)
	}
	if !strings.HasPrefix(lines[0], "  - word") {
		t.Errorf("the first line is %q, want the marker in front of the words", lines[0])
	}
	for _, line := range lines[1:] {
		if !strings.HasPrefix(line, "    word") {
			t.Errorf("a continuation is %q, want it under the first word and not under the marker",
				line)
		}
	}
	for _, line := range lines {
		if ansi.StringWidth(line) > 40 {
			t.Errorf("%q is %d cells wide", line, ansi.StringWidth(line))
		}
	}
}

func TestABulletThatFitsIsLeftAsItWasWritten(t *testing.T) {
	row := "  - spam protection — registered against the address that worker answers on"
	if said := wrap(row, widest); said != row {
		t.Errorf("wrap = %q, want a row that fits left alone", said)
	}
}

func TestAnIndentedLineThatIsNotABulletIsStillUntouched(t *testing.T) {
	// the install line, ./confirm.go's facts and its filenames open on no marker, and every one of
	// them is a row somebody copies or reads as a column.
	for _, row := range []string{
		"  curl -fsSL https://example.com/install.sh | sh",
		"  0013_pledges.sql",
		"  -port int",
	} {
		if said := wrap(row, 20); said != row {
			t.Errorf("wrap(%q) = %q, want it left as it stands", row, said)
		}
	}
}

func TestABulletCarryingAMarkedSpanIsMeasuredInCells(t *testing.T) {
	said := wrap("  - "+strings.Repeat("\x1b[1mword\x1b[0m ", 20), 40)
	for _, line := range strings.Split(said, "\n") {
		if ansi.StringWidth(line) > 40 {
			t.Errorf("%q is %d cells wide, so the marker's row was measured over the escapes",
				line, ansi.StringWidth(line))
		}
	}
}

func TestABulletKeepsItsHangingIndentUnderABreakTheCopyAlreadyCarries(t *testing.T) {
	said := wrap("this makes:\n\n  - "+strings.Repeat("word ", 30), 40)
	lines := strings.Split(said, "\n")
	if lines[0] != "this makes:" || lines[1] != "" {
		t.Fatalf("the paragraph above the list came out as %q", lines[:2])
	}
	if !strings.HasPrefix(lines[2], "  - ") || !strings.HasPrefix(lines[3], "    ") {
		t.Errorf("the list under it is drawn as %q and %q", lines[2], lines[3])
	}
}
