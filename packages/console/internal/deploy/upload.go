package deploy

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/better-giving/console/internal/bundle"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
)

// the binding types an upload keeps rather than replaces.
//
// **the values are binding types and not binding names**, which is what makes one list cover every
// var and every secret a deployment holds without this binary knowing any of them. without it a
// plain-text var is deleted by the upload — the publishable key and the turnstile sitekey among
// them, which is a donation form that can charge nothing and is protected by nothing. it is
// `keep_vars: true` in packages/app/wrangler.jsonc read onto the raw api, and that file argues the
// trade at length.
var keepBindings = []string{"plain_text", "json", "secret_text", "secret_key"}

// the content type every module of the worker goes up as.
const moduleType = "application/javascript+module"

// uploadAssets opens an upload session, sends whatever cloudflare asks for, and answers with the
// token the script names its assets by.
//
// A session that asks for nothing is a redeploy that changed no static file, and its own token is
// what the script goes up with.
func uploadAssets(ctx context.Context, options Options, held bundle.Bundle, say func(Progress)) (string, failure) {
	manifest := map[string]any{}
	byHash := map[string]bundle.Asset{}
	for _, asset := range held.Assets {
		manifest[asset.Path] = map[string]any{"hash": asset.Hash, "size": len(asset.Body)}
		byHash[asset.Hash] = asset
	}

	answer := options.Send(ctx, http.MethodPost,
		"/accounts/"+options.Account+"/workers/scripts/"+options.Config.Name+"/assets-upload-session",
		map[string]any{"manifest": manifest})
	if refused := refusal(ctx, answer); refused.Kind != "" {
		return "", refused
	}
	session := cf.ReadShaped(answer, func(value any) (map[string]any, bool) {
		held, ok := value.(map[string]any)
		return held, ok
	})
	if session.Kind != cf.ResultValue {
		return "", failure{Kind: Stopped, Detail: cf.Said(answer)}
	}
	token, _ := session.Value["jwt"].(string)
	if token == "" {
		return "", failure{Kind: Stopped, Detail: "Cloudflare opened an upload session with no token on it"}
	}

	upload := options.Assets(token)
	completed := false
	buckets, _ := session.Value["buckets"].([]any)
	for at, bucket := range buckets {
		hashes, ok := bucket.([]any)
		if !ok {
			return "", failure{Kind: Stopped, Detail: "Cloudflare asked for a bucket in a shape nothing was written against"}
		}
		parts := []cf.Part{}
		for _, one := range hashes {
			hash, ok := one.(string)
			if !ok {
				return "", failure{Kind: Stopped, Detail: "Cloudflare asked for a file by something that is not a hash"}
			}
			asset, held := byHash[hash]
			if !held {
				// the hash is the whole of what can be looked up: the manifest that opened the
				// session is keyed by path and this names no path in it.
				return "", failure{Kind: Stopped, Detail: "Cloudflare asked in " + bucketOf(at, len(buckets)) +
					" for a file no path in this bundle hashes to: " + hash}
			}
			// the part is named and filed by the hash, and the bytes travel base64-encoded as text —
			// which is what the query below says they are.
			parts = append(parts, cf.Part{
				Name:        hash,
				Filename:    hash,
				ContentType: asset.ContentType,
				Body:        []byte(base64.StdEncoding.EncodeToString(asset.Body)),
			})
		}

		say(Progress{Stage: Uploading, Detail: bucketOf(at, len(buckets)), Step: at + 1, Steps: len(buckets)})
		// nobody counts a bucket's own bytes: what is counted here is the buckets cloudflare asked
		// for, and a second count under the same words would be two shares in one line.
		answer := upload(ctx, http.MethodPost,
			"/accounts/"+options.Account+"/workers/assets/upload?base64=true", parts, nil)
		if refused := refusal(ctx, answer); refused.Kind != "" {
			return "", refused
		}
		// the last bucket answers with the completion token and the ones before it answer with
		// none, so the token is whichever came last rather than the one at a place in the list.
		if body, ok := answer.Body.(map[string]any); ok {
			if result, ok := body["result"].(map[string]any); ok {
				if completion, ok := result["jwt"].(string); ok && completion != "" {
					token, completed = completion, true
				}
			}
		}
	}
	// **a session that was asked for files ends in a completion token, and nothing else it hands
	// back stands in for one.** the session's own token names no upload that finished, so a script
	// carrying it claims assets cloudflare never completed — which it takes or refuses for a reason
	// that says nothing about the files.
	if len(buckets) > 0 && !completed {
		return "", failure{Kind: Stopped,
			Detail: "Cloudflare took every file and handed back no completion token for them"}
	}
	return token, failure{}
}

// which bucket of how many, for the screen to say while a large deployment uploads.
func bucketOf(at, of int) string {
	return "bucket " + strconv.Itoa(at+1) + " of " + strconv.Itoa(of)
}

// reaches is the account's own copy of this worker read before a migration is applied to anything.
//
// **the migration is the one-way door and the upload is what it is applied for** (CLAUDE.md), so a
// credential this account's workers are closed to is found out while nothing has landed, rather
// than at the end of the whole migration list in front of a PUT nobody can retry their way out of.
// an account holding no worker of this name is every first deploy and is not a refusal.
//
// It is a read, and a credential that may read this account's workers without replacing one gets
// past it — the upload still says so for itself.
func reaches(ctx context.Context, options Options) failure {
	answer := options.Send(ctx, http.MethodGet,
		"/accounts/"+options.Account+"/workers/scripts/"+options.Config.Name+"/settings", nil)
	if read := cf.ReadResult(answer); read.Kind == cf.ResultValue || read.Kind == cf.ResultMissing {
		return failure{}
	}
	return refusal(ctx, answer)
}

// address gives the deployment somewhere to answer where the upload left it answering nowhere.
//
// **the api leaves workers.dev off and wrangler does not, and that is the whole of what this is
// repairing.** a `wrangler deploy` from a checkout turns it on for a worker that declares no
// routes; an upload over the raw api (./upload.go) turns nothing on — so a deployment the console's
// own press put up stood in the account reachable by nobody, which internal/deployment/address.go
// reads back as `turned-off` and the console reports as answering on no address.
//
// **the condition is that it answers nowhere, not that this is a first deploy.** a first deploy that
// stopped after the upload leaves the worker standing, so a retry that keyed on the account already
// holding it would skip the address forever — and a worker answering on a custom domain, or on
// workers.dev already, is one this leaves alone whichever deploy put it there. what it overrules is
// the one state nobody chooses: reachable by nothing at all.
//
// **a read that did not land turns nothing on.** an account whose workers cannot be read is not an
// account with a deployment answering nowhere, and a POST made on that guess would switch on a
// public address for a worker whose operator may have pointed a domain at it.
//
// previews stay off. a preview url is a second address for every version ever uploaded, and a
// deployment is the one place donors are sent.
func address(ctx context.Context, options Options) failure {
	get := func(ctx context.Context, at string) cf.Answer {
		return options.Send(ctx, http.MethodGet, at, nil)
	}
	read := deployment.PublicAddress(ctx, get, options.Account, options.Config.Name)
	answers := read.Kind != deployment.Deployed || read.Why != deployment.TurnedOff ||
		!read.ReadDomains || len(read.Domains) > 0
	if answers {
		return failure{}
	}

	answer := options.Send(ctx, http.MethodPost,
		"/accounts/"+options.Account+"/workers/scripts/"+options.Config.Name+"/subdomain",
		map[string]any{"enabled": true, "previews_enabled": false})
	return refusal(ctx, answer)
}

// how many steps the script upload's own count moves in.
//
// one report per step rather than one per write, for the reason the download's own count is thinned
// (./deploy.go's fetchSteps): the body goes out in whatever chunks the connection takes, which is
// thousands of frames for a count that moves twenty times.
const scriptSteps = 20

// how the script upload says how far it has got, thinned to one report per step of ./scriptSteps.
//
// **what it says is the bytes alone, because the line it is drawn beside already names the code**
// (../terminal/lines.go): the row this stage lights says the app's code is going up, and a detail
// repeating that would say twice what the line says once. the figures are the download's own
// (./deploy.go's arrivedOf), which is the other long call a deploy makes and the other row of the
// same ledger — **and a share alone says nothing about what is being waited on**: `37%` of this is
// four megabytes or forty with nothing on the screen to tell them apart.
//
// the count is bytes handed to the connection and not bytes cloudflare took (../cf's Sending), so
// the last report says the request went rather than that it landed — what says that is the answer.
func going(say func(Progress)) cf.Sending {
	drawn := int64(-1)
	return func(sent, of int64) {
		if of <= 0 {
			return
		}
		cell := sent * scriptSteps / of
		if cell == drawn {
			return
		}
		drawn = cell
		say(Progress{Stage: Pushing, Detail: arrivedOf(sent, of), Step: int(sent), Steps: int(of)})
	}
}

// uploadScript puts the worker up: its metadata, its entry and every module under it.
//
// It is the longest single call a deploy makes — one PUT of every module this app is built from —
// so the bytes are counted on their way up rather than the line standing in its own words until
// cloudflare answers.
func uploadScript(ctx context.Context, options Options, held bundle.Bundle, assets string, say func(Progress)) failure {
	metadata := map[string]any{
		"main_module":         held.MainModule,
		"compatibility_date":  options.Shape.CompatibilityDate,
		"compatibility_flags": options.Shape.CompatibilityFlags,
		"bindings":            bindings(options),
		"keep_bindings":       keepBindings,
		"assets":              assetsField(assets, held.Headers),
		"observability":       map[string]any{"enabled": options.Shape.Observability},
	}
	written, err := json.Marshal(metadata)
	if err != nil {
		return failure{Kind: Stopped, Detail: err.Error()}
	}

	parts := []cf.Part{{Name: "metadata", Body: written}}
	for _, module := range held.Modules {
		// the part is named by the specifier as the importing module wrote it, path separators
		// included, which is how the runtime resolves one module's import of another.
		parts = append(parts, cf.Part{
			Name:        module.Specifier,
			Filename:    module.Specifier,
			ContentType: moduleType,
			Body:        module.Body,
		})
	}

	// **the bytes are counted on net/http's own goroutine and reported from this one.** the client
	// reads the body while the caller waits inside the call (../cf's Sending), and what watches a
	// run is called where ./deploy.go's Options says it is: on the goroutine the run is on. the
	// buffer holds every cell the bar has, so the count never waits on this end and no report of it
	// is ever dropped.
	reports := make(chan Progress, scriptSteps+1)
	answered := make(chan cf.Answer, 1)
	go func() {
		answered <- options.Upload(ctx, http.MethodPut,
			"/accounts/"+options.Account+"/workers/scripts/"+options.Config.Name, parts,
			going(func(progress Progress) { reports <- progress }))
	}()

	answer := cf.Answer{}
	for waiting := true; waiting; {
		select {
		case progress := <-reports:
			say(progress)
		case answer = <-answered:
			waiting = false
		}
	}
	// whatever the last cells said while the answer was on its way back.
	for len(reports) > 0 {
		say(<-reports)
	}
	return refusal(ctx, answer)
}

// what the upload states about this deployment's static assets.
//
// `config` carries the one field this app populates: the `_headers` rules, which travel on the
// script rather than as a file the deployment serves. everything else cloudflare offers there is
// left unstated, so its own defaults apply — which is what packages/app's build leaves them at.
func assetsField(token, headers string) map[string]any {
	assets := map[string]any{"jwt": token}
	if headers != "" {
		assets["config"] = map[string]any{"_headers": headers}
	}
	return assets
}

// every binding this deployment's worker is uploaded with.
//
// the database's own is the one that is not fixed: it names a uuid resolved against the operator's
// account, and the field is `id` on the way up whatever a later read of the settings calls it.
//
// **the release goes up with them, and that is what makes it a fact about what is running.** it is
// the console's own record about the deployment rather than one of the thirteen an operator
// configures (../deployment/recorded.go), and it travels in this metadata so that no state exists
// where the code landed and the record says another release. a binary naming no release writes no
// binding at all: `keep_bindings` then leaves whatever the last deploy recorded, where an empty one
// would replace a true record with a blank.
func bindings(options Options) []any {
	held := []any{map[string]any{
		"name": options.Shape.D1Binding,
		"type": "d1",
		"id":   options.DatabaseID,
	}}
	for _, limiter := range options.Shape.RateLimits {
		held = append(held, map[string]any{
			"name":         limiter.Name,
			"type":         "ratelimit",
			"namespace_id": limiter.NamespaceID,
			"simple":       map[string]any{"limit": limiter.Simple.Limit, "period": limiter.Simple.Period},
		})
	}
	if options.Release != "" {
		held = append(held, map[string]any{
			"name": deployment.RecordedReleaseName,
			"type": "plain_text",
			"text": options.Release,
		})
	}
	return held
}

// verify reads the deployment back, because the upload's own answer says nothing about what it took.
//
// the PUT answers with an id, a startup time and whether it has assets and modules — and no
// bindings at all. so a worker uploaded without its database answers 200 and fails every request it
// then serves, which is the state this read exists to catch.
func verify(ctx context.Context, options Options) failure {
	answer := options.Send(ctx, http.MethodGet,
		"/accounts/"+options.Account+"/workers/scripts/"+options.Config.Name+"/settings", nil)
	if refused := refusal(ctx, answer); refused.Kind != "" {
		return refused
	}
	read := cf.ReadShaped(answer, func(value any) (map[string]any, bool) {
		held, ok := value.(map[string]any)
		return held, ok
	})
	if read.Kind != cf.ResultValue {
		return failure{Kind: Stopped, Detail: cf.Said(answer)}
	}

	named := map[string]bool{}
	bound, _ := read.Value["bindings"].([]any)
	for _, one := range bound {
		if binding, ok := one.(map[string]any); ok {
			if name, ok := binding["name"].(string); ok {
				named[name] = true
			}
		}
	}
	for _, want := range append([]string{options.Shape.D1Binding}, limiterNames(options)...) {
		if !named[want] {
			return failure{Kind: Stopped, Detail: "the deployment came back without its " + want + " binding"}
		}
	}
	return failure{}
}

func limiterNames(options Options) []string {
	names := []string{}
	for _, limiter := range options.Shape.RateLimits {
		names = append(names, limiter.Name)
	}
	return names
}
