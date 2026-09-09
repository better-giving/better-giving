package effects

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/migrate"
	"github.com/better-giving/console/internal/release"
)

// Migrations is what a deploy would apply to the live database, and what that database records this
// binary does not carry.
//
// It is a reading and not a wire shape: the sentences a terminal says about it are
// ../terminal/redeploy.go's and the confirm it stands in front of is ../terminal/confirm.go's, and
// neither is this file's.
type Migrations struct {
	// Absent is why the database was not resolved, in ./Absent's words, and empty where it was.
	// Nothing below it is a reading where this is set.
	Absent string
	// Applied is how the read of the database's own applied list ended, and is cf.ResultValue only
	// where Names and Ahead are a reading of it.
	Applied cf.ResultKind
	// Detail is cloudflare's own words about whichever of the two did not land, and empty where
	// both did.
	Detail string
	// Names are the carried migrations the database has not, in the order they are applied.
	Names []string
	// Ahead are the migrations the database records that this binary does not carry, which is what
	// says the deployment was deployed from a newer console.
	Ahead []string
}

// Pending is what a deploy would apply to the live database, read before any press is made.
//
// **it is the migration step's own comparison with nothing applied**: the database's own
// `d1_migrations` table against the list this binary was baked with, which is the list the bundle
// carries — internal/bundle refuses a manifest naming any other. so the answer is a read of one
// table and never a bundle fetched.
//
// **the comparison is answered both ways round, because it is what says which of the two is behind
// by schema.** the carried files the database has not are what a press would apply; the files it
// records and this binary does not carry are a deployment put up by a newer console.
func Pending(
	ctx context.Context,
	credential cf.Credential,
	sends func(cf.Credential) cf.Send,
	accountID string,
) Migrations {
	read := Migrations{Names: []string{}, Ahead: []string{}}
	if credential.Kind == cf.NoCredential {
		// nothing is asked of cloudflare at all, and it is not a refusal: it wears ./Absent's words
		// because what an operator does about it is the same either way, which is sign in.
		read.Absent, read.Detail = "no-credential", credential.Detail
		return read
	}

	send := sends(credential)
	get := func(ctx context.Context, path string) cf.Answer {
		return send(ctx, http.MethodGet, path, nil)
	}
	standing := deployment.Databases(ctx, get, accountID, release.Baked.DatabaseName)
	if found := Absent(standing); found != "" {
		read.Absent, read.Detail = found, standing.Detail
		return read
	}

	applied := migrate.Applied(ctx, send, accountID, standing.UUID)
	read.Applied = applied.Kind
	if applied.Kind != cf.ResultValue {
		read.Detail = applied.Detail
		return read
	}
	read.Names = migrate.PendingNames(applied.Value, release.Baked.Migrations)
	read.Ahead = migrate.AheadNames(applied.Value, release.Baked.Migrations)
	return read
}
