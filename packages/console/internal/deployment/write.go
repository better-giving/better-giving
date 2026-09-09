package deployment

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// the door the thirteen are written and taken off through, which is the door ./values.go reads them
// back off.
//
// **a var is one press and seconds.** all thirteen are plain-text bindings on the worker's own
// settings, so setting one is a read of what the deployment is bound to, the named bindings
// replaced, and one patch back — no build, no migration and no upload, which is what the deploy
// path costs and what its one-way door is kept in front of.
//
// **that patch replaces the whole binding list, so everything not being written goes back up as
// `inherit`.** a name left off the list is a name gone from the new version, which is both how a
// plain-text value is taken off here and why every other binding is sent back: the list holds this
// console's own session credential, the deployment's database and its rate limiters, so a patch
// naming the vars alone would leave a deployment that serves no donation form. `inherit` is
// cloudflare's word for keeping what the deployed version holds, and a binding this console cannot
// read a name off refuses the whole press rather than being dropped from the list. the body is
// multipart and cloudflare refuses json for it outright.
//
// **the credential door beside it stores no configuration value, and is where every one of them is
// deleted.** SetSecrets writes worker secrets in one merge patch: a name the body does not mention
// is left exactly as it was, and a name it sends `null` for is deleted. it stores this console's
// own session token and nothing else, and the two presses that send it a `null` are the one that
// frees the names a deployment is holding as credentials and the removal half of SetVars — because
// leaving a binding off the settings patch is documented for the binding list and says nothing
// about the secret behind one, while `null` here is cloudflare's own word for a deletion.
//
// **no value reaches a path, an argument list or a sentence.** every value travels in a request
// body over https, the credential travels in a header (internal/cf), and what a screen draws about
// a failure is cloudflare's own words about the call rather than anything that was in it.
//
// **there is no read in front of a write.** a patch against a worker the account does not hold
// answers 10007 and creates nothing, so the write's own answer is what says there was nowhere to
// write to — a read first would be a second round trip for a sentence the answer already carries.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// Door is where one write of this deployment's values is made.
//
// The three calls are handed in rather than bound here so that every state below can be looked at
// without a cloudflare account and without a network.
type Door struct {
	AccountID  string
	WorkerName string
	// Get is the fresh read a write is decided against, which is cloudflare's own answer and never
	// a request body: the script's settings for a var, and the same reading ./values.go makes for a
	// name being freed.
	Get cf.Get
	// Patch is the merge patch a group of credentials goes up as (internal/cf's APIMergePatch).
	Patch cf.Send
	// Settings is the multipart patch a var goes up as.
	Settings cf.MultipartUpload
}

// WrittenKind is how one write of the thirteen ended.
type WrittenKind string

const (
	// WriteSet is it landing, which is the only kind that left anything on the deployment.
	WriteSet WrittenKind = "set"
	// WriteNothing is nothing to send, so cloudflare was never asked.
	WriteNothing WrittenKind = "nothing"
	// WriteUnchanged is every name already holding what was asked for.
	WriteUnchanged WrittenKind = "unchanged"
	// WriteWithheld is one or more of the names being held as credentials, which Names lists.
	WriteWithheld WrittenKind = "withheld"
	// WriteNowhere is there being nowhere to write to, which Address says the reason for.
	WriteNowhere WrittenKind = "nowhere"
	// WriteRefused is cloudflare turning this sign-in down for this account.
	WriteRefused WrittenKind = "refused"
	// WriteUnreachable is nothing found out either way.
	WriteUnreachable WrittenKind = "unreachable"
	// WriteFailed is cloudflare answering and not storing them, in its own words.
	WriteFailed WrittenKind = "failed"
)

// Nowhere is why there was nowhere to write to.
//
// Two members and not the seven an address read has: a write finds out from its own answer, and the
// only two things it can find out are that the account holds no such worker and that this console
// holds no sign-in to ask with.
type Nowhere struct {
	// Kind is `not-deployed` or `no-credential`.
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

// Written is how one write went.
//
// Flat rather than a member per kind, because that is what the wire is: every field is written on
// every answer and each is empty on the kinds that say nothing about it.
type Written struct {
	Kind WrittenKind `json:"kind"`
	// Address is why there was nowhere to write to, and nil on every other kind.
	Address *Nowhere `json:"address"`
	// Names is the vars this deployment is holding as credentials, on WriteWithheld alone.
	Names []string `json:"names"`
	// Detail is cloudflare's own words about the call, and empty where it wrote none.
	Detail string `json:"detail"`
}

// NoCredentialWrite is the press this console holds no sign-in to make.
//
// It is a write that never happened rather than a refusal, because what an operator does about it
// is sign in rather than press again — and it is stated here so that both doors answer it in the
// same words.
func NoCredentialWrite(detail string) Written {
	return Written{Kind: WriteNowhere, Address: &Nowhere{Kind: "no-credential", Detail: detail}}
}

// SetVars sets the vars `wanted` names and takes off the ones it maps to nil, in one press.
//
// **the compare is a fresh read and never what a browser remembered.** a var's value reads back,
// which is the whole reason the thirteen are vars, so a press is decided against what cloudflare
// says the deployment holds now: a name already at the asked-for value is not written, a name
// already holding nothing is not taken off, and a name held as a credential refuses a write of it
// instead — freeing it is FreeWithheldVars below.
//
// **nil is a removal, and it is the only way a value comes off a deployment.** nil over a name held
// as a credential is a removal like any other rather than the refusal a write of it earns: that
// guard is there so a value is not stored over a credential, and a removal stores none. which door
// it goes through is the fresh read's to say — a plain-text binding is left off the patched list,
// so it is gone from the new version, and one held as a credential is deleted through SetSecrets
// with a `null`.
//
// **the settings patch goes first and the deletions follow it, on a press that has both.** the
// binding list is built from the read in front of it and carries the credential back up as
// `inherit`, so a deletion made first would send a list claiming to inherit a binding the
// deployment no longer holds; and a patch that did not land stops the press with the deployment as
// the read found it, which is a press an operator can simply make again.
//
// **it is decided over the enumeration every operator screen draws its rows from**
// (../release's DeployVars), so a name off that list is a value silently dropped rather than one
// this door writes.
func SetVars(ctx context.Context, door Door, wanted map[string]*string) Written {
	if len(wanted) == 0 {
		return Written{Kind: WriteNothing}
	}
	names := release.DeployVars

	answer := door.Get(ctx, settingsPath(door.AccountID, door.WorkerName))
	read := cf.ReadShaped(answer, func(value any) ([]any, bool) {
		held, ok := value.(map[string]any)
		if !ok {
			return nil, false
		}
		bindings, listed := held["bindings"].([]any)
		return bindings, listed
	})
	if read.Kind != cf.ResultValue {
		return unwritten(failedValues(read.Kind), read.Detail)
	}

	held := map[string]map[string]any{}
	for _, one := range read.Value {
		row, ok := one.(map[string]any)
		if !ok {
			return unnamedBinding()
		}
		name, isText := row["name"].(string)
		if !isText || name == "" {
			return unnamedBinding()
		}
		held[name] = row
	}

	// the order is the list's own rather than the map's, so what a press reports and what it sends
	// are the same on every run.
	withheld := []string{}
	send := map[string]string{}
	remove := map[string]bool{}
	free := map[string]*string{}
	for _, name := range names {
		asked, named := wanted[name]
		if !named {
			continue
		}
		row := toVar(name, held[name])
		if asked == nil {
			// a slot the read says holds nothing is already off, whatever binding the worker carries
			// under the name: the reading is what every other comparison here is decided against too.
			switch row.Kind {
			case VarValue:
				remove[name] = true
			case VarWithheld:
				free[name] = nil
			}
			continue
		}
		switch {
		case row.Kind == VarWithheld:
			withheld = append(withheld, name)
		case row.Kind != VarValue || row.Value != *asked:
			send[name] = *asked
		}
	}
	if len(withheld) > 0 {
		return Written{Kind: WriteWithheld, Names: withheld}
	}
	if len(send) == 0 && len(remove) == 0 && len(free) == 0 {
		return Written{Kind: WriteUnchanged}
	}

	if len(send) > 0 || len(remove) > 0 {
		settings, err := json.Marshal(map[string]any{
			"bindings": bindingList(read.Value, send, remove, names),
		})
		if err != nil {
			return Written{Kind: WriteFailed, Detail: err.Error()}
		}
		// counted by nobody: what goes up is one json part of binding names, over in the time a read
		// takes.
		patched := wrote(door.Settings(ctx, http.MethodPatch,
			settingsPath(door.AccountID, door.WorkerName),
			[]cf.Part{{Name: "settings", Body: settings}}, nil))
		if patched.Kind != WriteSet || len(free) == 0 {
			return patched
		}
	}
	return SetSecrets(ctx, door, free)
}

// Stored is a set of values as the map SetVars takes.
//
// The chains that publish values remove none — a first deploy and the Stripe set-up each write what
// they have just made — so every name it hands over carries a value.
func Stored(values map[string]string) map[string]*string {
	wanted := make(map[string]*string, len(values))
	for name, value := range values {
		wanted[name] = &value
	}
	return wanted
}

// the whole binding list on the way up: the names being set as plain text, the plain-text names
// being taken off left out of it, and every other one inherited from the version that is deployed —
// a name held as a credential among them, which SetVars deletes through the door beside this one.
func bindingList(held []any, send map[string]string, remove map[string]bool, names []string) []any {
	list := []any{}
	written := map[string]bool{}
	for _, one := range held {
		// every row was read for a name before this, so both readings are the same list.
		name, _ := one.(map[string]any)["name"].(string)
		if remove[name] {
			continue
		}
		if value, named := send[name]; named {
			list = append(list, plainText(name, value))
			written[name] = true
			continue
		}
		list = append(list, map[string]any{"name": name, "type": "inherit"})
	}
	// a name no binding carried, which is every one of the thirteen before the press that sets it.
	for _, name := range names {
		if value, named := send[name]; named && !written[name] {
			list = append(list, plainText(name, value))
		}
	}
	return list
}

func plainText(name, value string) map[string]any {
	return map[string]any{"name": name, "type": "plain_text", "text": value}
}

// **a binding this console cannot name refuses the press.** the patch replaces the whole list, so
// a row left out of it is a binding deleted — and a row nothing here can read a name off is one
// there is no safe way to send back up.
func unnamedBinding() Written {
	return Written{
		Kind:   WriteFailed,
		Detail: "Cloudflare listed a binding this console could not name, so nothing was written.",
	}
}

// SetSecrets stores and clears worker secrets, in one request.
//
// A name mapped to nil is deleted and a name the payload does not mention is left exactly as it
// was, which is what makes a store and a clear one press.
//
// **no configuration value is written through here, and every deletion of one is.** the thirteen
// are vars and go up through SetVars, which sends this door the `null` that takes a name off a
// deployment still holding it as a credential; FreeWithheldVars below sends the same `null` for
// every such name at once, and WriteConsoleToken stores this console's own session, which is the
// only value stored through here at all.
func SetSecrets(ctx context.Context, door Door, payload map[string]*string) Written {
	if len(payload) == 0 {
		return Written{Kind: WriteNothing}
	}
	return wrote(door.Patch(ctx, http.MethodPatch,
		secretsBulkPath(door.AccountID, door.WorkerName), secretsBulkBody(payload)))
}

// FreeWithheldVars takes every one of the thirteen this deployment is holding as a credential off
// it, so that the press beside it can set the value.
//
// **which names are freed is read here and never posted.** what it reads is cloudflare's own answer,
// so there is no door for a name a page chose — a deletion made on one would be a credential
// destroyed wherever the page that sent it said. a read that did not land frees nothing, and a read
// naming none is a page a moment out of date rather than a fault.
func FreeWithheldVars(ctx context.Context, door Door) Written {
	read := DeployedVars(ctx, door.Get, door.AccountID, door.WorkerName)
	if read.Kind != ValuesRead {
		return unwritten(read.Kind, read.Detail)
	}

	payload := map[string]*string{}
	for _, row := range read.Vars {
		if row.Kind == VarWithheld {
			payload[row.Name] = nil
		}
	}
	return SetSecrets(ctx, door, payload)
}

// where a group's values are set and cleared in one request.
//
// The name is the release's own and never one that travelled through a browser: a deployment
// operating a named environment answers under `{name}-{environment}`, so a write addressed to any
// other name would store a credential on a worker the operator is not looking at.
func secretsBulkPath(accountID, workerName string) string {
	return "/accounts/" + accountID + "/workers/scripts/" + workerName + "/secrets-bulk"
}

// the whole body of that request, stated in one place so that it is asserted rather than trusted.
//
// The map is keyed by the credential's name: an object is a value to store and `null` is a name to
// delete. `secret_text` is the one type this console stores here, and a name the deployment holds
// as a var is replaced in place by this write.
// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/bulk_update/
func secretsBulkBody(payload map[string]*string) map[string]any {
	secrets := map[string]any{}
	for name, value := range payload {
		if value == nil {
			secrets[name] = nil
			continue
		}
		secrets[name] = map[string]any{"name": name, "text": *value, "type": "secret_text"}
	}
	return map[string]any{"secrets": secrets}
}

// one write's answer, read.
//
// **a success is WriteSet whatever shape its body is in.** nothing is read off one — the page
// re-reads what the deployment holds — so an answer cloudflare has since changed the shape of is
// still a write that landed, and reporting it as a failure would tell an operator to type ten
// credentials again.
func wrote(answer cf.Answer) Written {
	read := cf.ReadResult(answer)
	switch read.Kind {
	case cf.ResultValue, cf.ResultUnreadable:
		return Written{Kind: WriteSet}
	case cf.ResultMissing:
		return Written{Kind: WriteNowhere, Address: &Nowhere{Kind: "not-deployed"}}
	case cf.ResultRefused:
		return Written{Kind: WriteRefused, Detail: cf.Said(answer)}
	}
	// ReadResult folds an answered failure and a call that never landed into one kind, and the two
	// have different ways out — the answer's own kind is what tells them apart.
	if answer.Kind == cf.Unreachable {
		return Written{Kind: WriteUnreachable, Detail: answer.Detail}
	}
	return Written{Kind: WriteFailed, Detail: cf.Said(answer)}
}

// a read that did not land, as the write it stopped.
func unwritten(kind ValuesKind, detail string) Written {
	switch kind {
	case ValuesNotDeployed:
		return Written{Kind: WriteNowhere, Address: &Nowhere{Kind: "not-deployed"}}
	case ValuesNoCredential:
		return NoCredentialWrite(detail)
	case ValuesRefused:
		return Written{Kind: WriteRefused, Detail: detail}
	case ValuesUnreachable:
		return Written{Kind: WriteUnreachable, Detail: detail}
	default:
		return Written{Kind: WriteFailed, Detail: detail}
	}
}

// ConsoleTokenName is the name the deployment reads this console's session out of.
//
// It is deliberately off release.DeployVars: that enumeration is what a browser may name, and this
// console's own credential is not one of the thirteen an operator sets. The door is here instead,
// where the only caller is the press that mints one.
const ConsoleTokenName = "CONSOLE_TOKEN"

// WriteConsoleToken stores this console's session on the deployment.
//
// **it is stored as a secret and never as a var.** a deployed var's value reads back through the
// script-settings API and prints in cloudflare's dashboard, and this console's session is the one
// credential here that nobody has to be able to read: it is minted rather than typed, and a press
// mints another.
//
// One name, so everything this deployment holds beside it is left exactly as it is: a merge patch
// mentions what it changes and nothing else.
func WriteConsoleToken(ctx context.Context, door Door, token string) Written {
	return SetSecrets(ctx, door, map[string]*string{ConsoleTokenName: &token})
}
