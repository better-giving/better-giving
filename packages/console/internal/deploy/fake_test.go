package deploy

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// the config both halves of a deploy are checked against.
func baked() release.Config {
	return release.Config{
		Name:                "better-giving",
		DatabaseName:        "better-giving",
		MigrationsDir:       "./migrations",
		Migrations:          []string{"0000_a.sql"},
		TurnstileWidgetName: "better-giving",
		Commit:              strings.Repeat("a", 40),
	}
}

// the shape this deployment's worker goes up in, which is packages/app's own.
func shape() release.UploadShape {
	return release.UploadShape{
		D1Binding:          "DB",
		RateLimits:         []release.RateLimit{{Name: "API_RATE_LIMITER", NamespaceID: "7412", Simple: release.Simple{Limit: 600, Period: 60}}},
		CompatibilityDate:  "2026-07-22",
		CompatibilityFlags: []string{"nodejs_compat"},
		Observability:      true,
	}
}

// a release bundle as the release packs one, carrying one more served file per name in `assets`.
func packed(t *testing.T, manifest release.Config, assets ...string) []byte {
	t.Helper()
	written, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	files := map[string]string{
		"manifest.json":         string(written),
		"worker/index.js":       "export default {};\n",
		"assets/embed.js":       "console.log(1);\n",
		"assets/_headers":       "/embed.js\n  cache-control: public\n",
		"migrations/0000_a.sql": "create table a (b text);\n",
	}
	for at, name := range assets {
		files["assets/"+name] = "console.log(" + strconv.Itoa(at+2) + ");\n"
	}

	var out bytes.Buffer
	zipped := gzip.NewWriter(&out)
	archive := tar.NewWriter(zipped)
	for name, body := range files {
		if err := archive.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body))}); err != nil {
			t.Fatalf("WriteHeader: %v", err)
		}
		if _, err := archive.Write([]byte(body)); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}
	archive.Close()
	zipped.Close()
	return out.Bytes()
}

// a cloudflare account that answers the five calls a deploy makes, recording each.
type account struct {
	mutex sync.Mutex
	// paths is every path called, in order, so that a case can say what a run did and did not do.
	paths []string
	// metadata is the json part of each script upload.
	metadata []map[string]any
	// modules is the file parts of each script upload, by part name, in the same order.
	modules []map[string]string
	// subdomains is the body of every workers.dev call, by the script it was made about.
	subdomains map[string][]map[string]any
	// refusesSubdomain is an account this credential may upload to and not turn a worker on at.
	refusesSubdomain bool
	// workersDev is whether the app worker already answers on a workers.dev address, which a deploy
	// reads before it gives one to a worker answering nowhere.
	workersDev bool
	// customDomains is what the account lists as this worker's own domains.
	customDomains []string
	// sessions is how many upload sessions were opened.
	sessions int
	// uploaded is the completion token each asset bucket upload was authorised with.
	uploaded []string
	// migrated is the sql of every statement the database was sent.
	migrated []string

	// throughMigrate is how many calls arrived on the send bound to a schema change's own deadline.
	throughMigrate int

	// wantsNothing is an upload session that asks for no file, which is a redeploy that changed
	// none of them.
	wantsNothing bool
	// wantsUnknown is a session asking for a file by a hash no path in the bundle hashes to.
	wantsUnknown bool
	// oneFilePerBucket is a session asking for the files a bucket at a time, which is what a large
	// deployment's upload is: cloudflare decides how many, and the run counts them.
	oneFilePerBucket bool
	// noCompletion is every bucket taken and no completion token handed back.
	noCompletion bool
	// refusesWorkers is an account whose workers this credential is turned down on.
	refusesWorkers bool
	// neverDeployed is an account holding no worker of this name until one is uploaded, which is
	// every account before its first deploy.
	neverDeployed bool
	// refusesSQL is the sql this database turns down, matched as a prefix.
	refusesSQL string
	// bound is what GET settings reports afterwards, and nil means every binding that went up.
	bound []string
}

func (held *account) called(path string) {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	held.paths = append(held.paths, path)
}

func (held *account) saw(path string) bool {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	for _, one := range held.paths {
		if one == path {
			return true
		}
	}
	return false
}

func (held *account) serve(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		held.called(r.Method + " " + r.URL.Path)
		switch {
		case strings.HasSuffix(r.URL.Path, "/query"):
			held.query(w, r)
		case strings.HasSuffix(r.URL.Path, "/assets-upload-session"):
			held.openSession(w, r)
		case strings.HasSuffix(r.URL.Path, "/workers/assets/upload"):
			held.takeBucket(w, r)
		case strings.HasSuffix(r.URL.Path, "/workers/subdomain"):
			held.accountSubdomain(w)
		case strings.HasSuffix(r.URL.Path, "/subdomain"):
			held.subdomain(w, r)
		case strings.HasSuffix(r.URL.Path, "/domains"):
			held.domains(w)
		case strings.HasSuffix(r.URL.Path, "/settings"):
			held.settings(w)
		case r.Method == http.MethodPut:
			held.script(t, w, r)
		default:
			http.Error(w, "no such endpoint", http.StatusNotFound)
		}
	}))
}

func (held *account) query(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SQL string `json:"sql"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	held.mutex.Lock()
	held.migrated = append(held.migrated, body.SQL)
	refused := held.refusesSQL != "" && strings.HasPrefix(body.SQL, held.refusesSQL)
	held.mutex.Unlock()

	if refused {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"success":false,"errors":[{"code":7500,"message":"near \"opps\": syntax error"}]}`))
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"result":  []any{map[string]any{"success": true, "results": []any{}}},
	})
}

func (held *account) openSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Manifest map[string]struct {
			Hash string `json:"hash"`
			Size int    `json:"size"`
		} `json:"manifest"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	held.mutex.Lock()
	held.sessions++
	token := "session-token-" + string(rune('a'+held.sessions-1))
	// every file the manifest names, in one bucket — which is a first deploy, where the account
	// holds none of them yet.
	buckets := [][]string{}
	if !held.wantsNothing {
		wanted := []string{}
		for _, entry := range body.Manifest {
			wanted = append(wanted, entry.Hash)
		}
		sort.Strings(wanted)
		if held.wantsUnknown {
			wanted = []string{"0123456789abcdef0123456789abcdef"}
		}
		if held.oneFilePerBucket {
			for _, hash := range wanted {
				buckets = append(buckets, []string{hash})
			}
		} else {
			buckets = append(buckets, wanted)
		}
	}
	held.mutex.Unlock()

	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"result":  map[string]any{"jwt": token, "buckets": buckets},
	})
}

func (held *account) takeBucket(w http.ResponseWriter, r *http.Request) {
	held.mutex.Lock()
	held.uploaded = append(held.uploaded, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	token := "completion-token-" + string(rune('a'+held.sessions-1))
	held.mutex.Unlock()

	if held.noCompletion {
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]any{}})
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]any{"jwt": token}})
}

func (held *account) script(t *testing.T, w http.ResponseWriter, r *http.Request) {
	t.Helper()
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		t.Fatalf("ParseMultipartForm: %v", err)
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(strings.Join(r.MultipartForm.Value["metadata"], "")), &metadata); err != nil {
		t.Fatalf("the metadata part is not json: %v", err)
	}
	parts := map[string]string{}
	for name, headers := range r.MultipartForm.File {
		for _, header := range headers {
			file, err := header.Open()
			if err != nil {
				t.Fatalf("the %s part could not be read: %v", name, err)
			}
			body, err := io.ReadAll(file)
			file.Close()
			if err != nil {
				t.Fatalf("the %s part could not be read: %v", name, err)
			}
			parts[name] = string(body)
		}
	}

	held.mutex.Lock()
	held.metadata = append(held.metadata, metadata)
	held.modules = append(held.modules, parts)
	held.mutex.Unlock()

	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"result":  map[string]any{"id": "better-giving", "has_assets": true, "has_modules": true},
	})
}

// the workers.dev call on one worker, which is what says it answers on an address at all. a GET is
// the read a deploy makes before it gives an address to a worker that has none.
func (held *account) subdomain(w http.ResponseWriter, r *http.Request) {
	name := path.Base(path.Dir(r.URL.Path))
	if r.Method == http.MethodGet {
		held.mutex.Lock()
		on, unknown := held.workersDev, held.neverDeployed && len(held.metadata) == 0
		held.mutex.Unlock()
		if unknown {
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"success":false,"errors":[{"code":10007,"message":"workers.api.error.script_not_found"}]}`))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"result":  map[string]any{"enabled": on, "previews_enabled": false},
		})
		return
	}

	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	held.mutex.Lock()
	if held.subdomains == nil {
		held.subdomains = map[string][]map[string]any{}
	}
	held.subdomains[name] = append(held.subdomains[name], body)
	refused := held.refusesSubdomain
	if !refused {
		held.workersDev = true
	}
	held.mutex.Unlock()

	if refused {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`))
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"result":  map[string]any{"enabled": true, "previews_enabled": false},
	})
}

// the account's own workers.dev name, which an address is composed from once the worker's own
// setting says it answers on one.
func (held *account) accountSubdomain(w http.ResponseWriter) {
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"result":  map[string]any{"subdomain": "hound"},
	})
}

// the custom domains this worker answers on, which is the other half of whether it answers at all.
func (held *account) domains(w http.ResponseWriter) {
	held.mutex.Lock()
	named := held.customDomains
	held.mutex.Unlock()

	listed := []any{}
	for _, hostname := range named {
		listed = append(listed, map[string]any{"service": "better-giving", "hostname": hostname})
	}
	json.NewEncoder(w).Encode(map[string]any{"success": true, "result": listed})
}

func (held *account) settings(w http.ResponseWriter) {
	held.mutex.Lock()
	named := held.bound
	if named == nil {
		named = []string{"DB", "API_RATE_LIMITER"}
	}
	refused, unknown := held.refusesWorkers, held.neverDeployed && len(held.metadata) == 0
	held.mutex.Unlock()

	if refused {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`))
		return
	}
	if unknown {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"success":false,"errors":[{"code":10007,"message":"workers.api.error.script_not_found"}]}`))
		return
	}

	bindings := []any{}
	for _, name := range named {
		bindings = append(bindings, map[string]any{"name": name, "type": "d1"})
	}
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"result":  map[string]any{"bindings": bindings},
	})
}

// a cloudflare turning this credential down on everything it is asked.
func refusing() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`))
	}
}

// one deploy against a fake account and a fake release, with every stage it reported.
func deployed(t *testing.T, held *account, bundle []byte) (Run, []Stage) {
	t.Helper()
	return deployedStopping(t, held, bundle, "")
}

// the same deploy, with every progress it reported rather than the stages it moved through.
func deployedReporting(t *testing.T, held *account, bundle []byte) (Run, []Progress) {
	t.Helper()
	reported := []Progress{}
	run := running(t, held, bundle, "", func(progress Progress) {
		reported = append(reported, progress)
	})
	return run, reported
}

// every progress reported at one stage, in order.
func reportedAt(reported []Progress, stage Stage) []Progress {
	held := []Progress{}
	for _, progress := range reported {
		if progress.Stage == stage {
			held = append(held, progress)
		}
	}
	return held
}

// the same deploy, with the operator stopping waiting the moment `at` is reached.
func deployedStopping(t *testing.T, held *account, bundle []byte, at Stage) (Run, []Stage) {
	t.Helper()
	stages := []Stage{}
	run := running(t, held, bundle, at, func(progress Progress) {
		if len(stages) == 0 || stages[len(stages)-1] != progress.Stage {
			stages = append(stages, progress.Stage)
		}
	})
	return run, stages
}

// one deploy against a fake account and a fake release, reporting through `say`.
func running(t *testing.T, held *account, bundle []byte, at Stage, say func(Progress)) Run {
	t.Helper()
	api := held.serve(t)
	defer api.Close()
	releases := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if bundle == nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Write(bundle)
	}))
	defer releases.Close()

	ctx, stop := context.WithCancel(context.Background())
	defer stop()

	return Deploy(ctx, Options{
		Send: cf.JSONSend(api.URL, nil),
		// the same api on the same credential, and the bound a whole file of ddl fits in — which is
		// what internal/cf's APISchemaSend binds where a deploy is wired to a real account.
		Migrate: func(ctx context.Context, method, path string, body any) cf.Answer {
			held.mutex.Lock()
			held.throughMigrate++
			held.mutex.Unlock()
			return cf.JSONSendWithin(api.URL, nil, time.Minute)(ctx, method, path, body)
		},
		Upload: cf.MultipartSend(api.URL, nil),
		Assets: func(token string) cf.MultipartUpload {
			return cf.MultipartSend(api.URL, map[string]string{"Authorization": "Bearer " + token})
		},
		Releases:   releases.Client(),
		BundleURL:  releases.URL + "/worker-1.2.3.tar.gz",
		Account:    "an-account",
		DatabaseID: "a-database",
		Config:     baked(),
		Shape:      shape(),
		Report: func(progress Progress) {
			say(progress)
			if progress.Stage == at {
				stop()
			}
		},
	})
}
