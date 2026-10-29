// Package pipeline embeds the pipeline app's Vite build, apps/pipeline/dist/,
// for the emulator to serve with sdk.NewClient.
//
// mise run build:app writes the build; it is never committed. The directory
// holds one committed file, dist/.gitkeep, which build:app recreates after
// Vite empties the directory, so the embed pattern always matches and the
// Go steps compile with no web build. A binary compiled that way embeds no
// manifest, and refuses to start: NewClient's error, naming the missing
// manifest, fails the emulator's graph Build.
package pipeline

import (
	"embed"
	"io/fs"
)

// Entry is the manifest key of the app's entry module, Vite's input.
const Entry = "src/main.ts"

// dist is the build as compiled in; all: takes the build's .vite/ directory,
// where the manifest lives, which a bare pattern would skip as a dotted
// name.
//
//go:embed all:dist
var dist embed.FS

// Dist returns the build's output directory, the root sdk.NewClient reads
// .vite/manifest.json and the assets from.
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		// fs.Sub fails only on an invalid path, and "dist" is valid.
		panic(err)
	}
	return sub
}
