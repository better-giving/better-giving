package terminal

import (
	"errors"
	"io"
	"strconv"

	"github.com/charmbracelet/huh"

	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// the workers.dev name this cloudflare account will answer under, taken off an operator.
//
// **the question is put only where cloudflare turned a name down.** an account's own name is what
// the press derives one from and tries first (../deployment's DerivedName), so an operator who is
// reading this screen at all is one whose account name is taken or is nothing a name can be made
// of — which is why what stands above the question is why they are being asked.
//
// **the rule is cloudflare's own, restated here rather than invented**, the way ./password.go
// restates the deployment's: a box that took anything would send a typo to cloudflare to be refused
// a second time, with the operator no nearer a name that lands.
//
// **nothing about the name is a credential.** it is the address donors are sent to, so it is drawn
// as typed and quoted back in every refusal.

// AskWorkersDevName takes the workers.dev name this account will answer under.
//
// `why` is what stands above the question — the refusal that led to it being put — drawn on this
// prompt's own screen for ./password.go's reason. False with no error is the operator closing the
// prompt, which ./prompt.go argues is a press not made rather than a failure to report.
func AskWorkersDevName(in io.Reader, to io.Writer, why string) (string, bool, error) {
	_, _ = io.WriteString(to, heading(onScreen(to), why, measure(to)))
	if !attended(in, to) {
		return "", false, noTerminal{"a workers.dev name for this Cloudflare account"}
	}
	var typed string
	asking := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("a workers.dev name for this Cloudflare account").
			Description("your deployment answers at " + release.Baked.Name + ".<name>.workers.dev").
			Validate(namingRefusal).
			Value(&typed),
	)).WithInput(in).WithOutput(to)

	switch err := asking.Run(); {
	case errors.Is(err, huh.ErrUserAborted):
		return "", false, nil
	case err != nil:
		return "", false, err
	}
	return typed, true, nil
}

// what the box refuses a name with, or nil where cloudflare would take it.
func namingRefusal(typed string) error {
	if deployment.NameUsable(typed) {
		return nil
	}
	return errors.New("Cloudflare takes lowercase letters, digits and hyphens, starting and " +
		"ending on a letter or a digit, " + strconv.Itoa(deployment.NameCeiling) +
		" characters at the most")
}
