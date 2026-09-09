package terminal

import (
	"errors"
	"fmt"
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
// **nothing typed is written back out, ever.** it is the whole of this app's credential entropy and
// a terminal keeps its scrollback, which whatever collects that machine's logs keeps too
// (CLAUDE.md). The box is masked as it is typed, the refusal states which rule was broken, and
// neither quotes the value.

// AskPassword takes the dashboard password, twice, and hands back the one that was typed the same
// way both times.
//
// **the second box is not a courtesy.** nothing is shown as it is typed and nothing anywhere echoes
// it back afterwards, so a password with a typo in it is one nobody finds out about until the
// deployment is up and turning every sign-in away — and the way out of that is another deploy.
//
// **a refusal says which rule was broken and asks again rather than ending the press.** the
// operator is standing at the prompt; a press abandoned over a value they can retype in a second is
// a chain they have to start from the beginning.
//
// False with no error is the operator closing the prompt, which ./prompt.go argues is a press not
// made rather than a failure to report.
func AskPassword(in io.Reader, to io.Writer) (string, bool, error) {
	if !attended(in) {
		return "", false, ErrNoTerminal
	}
	clear(to)
	for {
		// the two are declared per turn so a second ask opens on two empty boxes: a field is seeded
		// with what the value behind it already holds, and a box seeded with the password that was
		// just refused is one an operator submits again without reading it.
		var typed, again string
		asking := huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("a password for the dashboard").
				Description(strconv.Itoa(release.MinAdminPasswordLength)+" characters or more").
				EchoMode(huh.EchoModePassword).
				Validate(refusing).
				Value(&typed),
			huh.NewInput().
				Title("type it again").
				EchoMode(huh.EchoModePassword).
				Value(&again),
		)).WithInput(in).WithOutput(to)

		switch err := asking.Run(); {
		case errors.Is(err, huh.ErrUserAborted):
			return "", false, nil
		case err != nil:
			return "", false, err
		}
		if again == typed {
			return typed, true, nil
		}
		fmt.Fprintln(to, "those two are not the same password")
	}
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
