package terminal

import (
	"errors"
	"io"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/charmbracelet/huh"

	"github.com/better-giving/console/internal/release"
)

// the dashboard password taken off an operator, and the reading that says whether it is one the
// deployment would ever authenticate against.
//
// **the rule is the deployment's own, restated here rather than invented.** the lengths are taken
// off ../release and not typed in this file, so a password this prompt accepts is one the
// deployment will authenticate against — a terminal and a deployment disagreeing about what a
// credential is would be a press that finished on a password nothing takes.
//
// **the value is legible on the screen while it is typed, and a terminal keeps its scrollback**,
// which whatever collects that machine's logs keeps too (CLAUDE.md). that is the rule this screen
// works under. what no refusal does is carry the value: it is the whole of this app's credential
// entropy, so a password this prompt will not take is measured and never quoted back.
//
// **this is the first screen of a press that makes things, so it is where what will be made is
// named.** every prompt in this package erases the screen before it draws (./clear.go), so a
// caller that printed its own line above this call would have it wiped at the moment the question
// went up — which is the same defect the one-way door was fixed for, one screen earlier. what the
// caller has to say is handed in and drawn here, the way ./confirm.go takes the newer-release line
// and the deployment it is about. the screen after this one is the placement question, which states
// its own permanence in its own description; nothing about it is restated here twice.

// AskPassword takes the dashboard password and hands back what was typed.
//
// **there is one box, and the typo it would carry is legible in it.** a password nobody reads as
// they type it is one a mistake survives into the deployment, which is then up and turning every
// sign-in away with another deploy as the way out; one standing on the screen is corrected before
// the press that makes anything.
//
// **a refusal says which rule was broken and asks again rather than ending the press.** the
// operator is standing at the prompt; a press abandoned over a value they can retype in a second is
// a chain they have to start from the beginning.
//
// `preamble` is what the caller has to say above the question, drawn on this prompt's own screen and
// empty where it has nothing. False with no error is the operator closing the prompt, which
// ./prompt.go argues is a press not made rather than a failure to report.
func AskPassword(in io.Reader, to io.Writer, preamble string) (string, bool, error) {
	_, _ = io.WriteString(to, heading(onScreen(to), preamble))
	if !attended(in, to) {
		return "", false, noTerminal{"a password for the dashboard"}
	}
	var typed string
	asking := huh.NewForm(huh.NewGroup(passwordBox(&typed))).WithInput(in).WithOutput(to)

	switch err := asking.Run(); {
	case errors.Is(err, huh.ErrUserAborted):
		return "", false, nil
	case err != nil:
		return "", false, err
	}
	return typed, true, nil
}

// the box itself: what it asks for, what it will not take, and what it shows of the value.
//
// the echo mode is written out rather than left to the field's default, because legibility is this
// screen's rule and a rule inherited from a default is one nobody reading the file can see was
// decided (./password_test.go holds it).
func passwordBox(into *string) *huh.Input {
	return huh.NewInput().
		Title("a password for the dashboard").
		Description(strconv.Itoa(release.MinAdminPasswordLength) + " characters or more").
		EchoMode(huh.EchoModeNormal).
		Validate(refusing).
		Value(into)
}

// what stands above the question: the screen erased, and then what the caller has to say.
//
// the composition is ./confirm.go's: what the caller has to say is drawn after the erase and above
// the question, because a line printed before this call is off the visible screen by the moment it
// exists to inform. it goes out at a run nobody is watching for ./clear.go's reason too — a run
// whose output is a record still says what it would have made, and the erase writes nothing there.
//
// **it is one value rather than two writes because the order is the whole of it.** the erase is
// written at a terminal alone, so a case driving this prompt over a buffer sees nothing of it and a
// clear deleted or moved below the preamble would pass every one of them
// (./password_test.go). `cleared` is that reading, taken by the caller.
func heading(cleared bool, preamble string) string {
	said := ""
	if cleared {
		said = clearScreen
	}
	if preamble != "" {
		said += preamble + "\n\n"
	}
	return said
}

// Unusable's reading as the box's own, so what refuses a password at a terminal refuses it in the
// sentence the http door refuses it in.
func refusing(typed string) error {
	if why := Unusable(typed); why != "" {
		return errors.New(why)
	}
	return nil
}

// Unusable is why a password is one no deployment would authenticate against, or empty where it is.
//
// **the three are three different mistakes and not one absence**: a box submitted blank, a value
// somebody meant that carries nothing to compare, and one too short to stand in front of /admin.
// what each of them costs is packages/operator/src/admin-password.ts's header, which is the reading
// this repeats.
//
// **nothing is trimmed.** whitespace is a legal password character, so a leading space is kept and
// a value that is only whitespace is refused outright rather than shortened into a different
// credential.
//
// **no refusal carries the value.** it is the whole of this app's credential entropy, so it is
// measured and never quoted (CLAUDE.md).
func Unusable(password string) string {
	switch {
	case password == "":
		return "this console does not deploy without a password to sign in with"
	case strings.TrimSpace(password) == "":
		return "this console does not deploy with a password that is only whitespace"
	case TypedLength(password) < release.MinAdminPasswordLength:
		return "this console does not deploy with a password shorter than " +
			strconv.Itoa(release.MinAdminPasswordLength) + " characters"
	default:
		return ""
	}
}

// TypedLength is how long a password is, counted the way the deployment counts it.
//
// the sign-in path measures a javascript string, whose length is its utf-16 code units — so a byte
// count here would take a password of six accented characters that the deployment then refuses
// every sign-in against, which is the whole of what this door exists to stop.
func TypedLength(password string) int {
	return len(utf16.Encode([]rune(password)))
}
