# 19PvP Launcher

Phase 1 is a Deno/WebTorrent prototype for the fixed `World of Warcraft
3.3.5a.torrent`. It downloads into a temporary directory and exposes a
scrolling diagnostic log at the local HTTP page.

Run the desktop app from this directory with:

```sh
deno task desktop:dev
```

Build the desktop executable with:

```sh
deno task desktop
```

The existing browser/server mode is still available with:

```sh
deno task dev
```

The desktop app opens the same log page in its native window. `deno desktop`
uses the local `Deno.serve()` handler for that window.
