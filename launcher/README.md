# 19PvP Launcher

Torrent-first launcher for the fixed `World of Warcraft 3.3.5a.torrent`. The launcher runs a local HTTP page, opens it
in the system browser, and keeps partial downloads in the selected directory so they can be resumed.

Run the launcher from this directory with:

```sh
deno task dev
```

Build a single executable with:

```sh
deno task compile
```

Generate the client patch after the client is available with:

```sh
curl -X POST http://127.0.0.1:<launcher-port>/patch
```

The launcher requests `GET /launcher/patch` from the configured service. The response may be one edit, an array of
edits, or `{ "patches": [...] }`. Each edit has `filename`, `schema`, and `rows`; each row is a sparse object such as
`{ "ID": 123, "RequiredLevel": 19 }`. Missing or `null` row fields preserve the value from the original DBC, and edits
are matched by the first schema field (normally `ID`). The generated archive is written to `Data/patch-S.mpq`.

The Windows build creates a compressed self-extracting executable. It requires `7z` on the build machine; the Windows
SFX module is kept in `tools/7zS.sfx`.

The launcher chooses an available localhost port and opens the log page in the system browser.

## Plan

### Phase 1 — Torrent download

- Embed the fixed torrent as bytes.
- Download with the vendored WebTorrent implementation.
- Use the selected directory and reuse verified partial files.
- Show status, progress, speed, downloaded bytes, peer count, and expandable logs.
- Retry failed tracker and DHT discovery after 30 seconds.
- Keep WebTorrent client and torrent errors visible in the logs.

Acceptance: the client downloads successfully and interrupted downloads resume.

### Phase 2 — Torrent controls

- Start or resume.
- Pause.
- Cancel and remove partial data.
- Retry after failure.
- Disable unsafe controls during transitions.
- Stop the torrent cleanly when the launcher closes.

Acceptance: every state transition is visible and repeatable without restarting.

### Phase 3 — Partial-download behavior

Verify the actual WebTorrent behavior when:

- the launcher closes during a download;
- the same torrent and destination are reopened;
- completed pieces are reused;
- incomplete pieces continue downloading;
- corrupted pieces are redownloaded;
- cancellation does not remove resumable data unless requested.

Document the observed behavior and keep the required storage configuration.

Acceptance: interrupted downloads do not start from zero.

### Phase 4 — Webseed

- Verify the hosting layout and HTTPS behavior.
- Require stable `Content-Length` and byte-range responses.
- Add the webseed through BEP 19 `url-list`.
- Test with P2P peers unavailable.
- Verify the final torrent content hash.

The launcher uses `https://19pvp.devazuka.com` by default. Set `LAUNCHER_SERVICE_ORIGIN` to override it. At startup it
gets the webseed URL, realmlist, and log verification value from `GET /launcher/config`. The same origin serves the
addon and receives logs.

The current host still needs to serve byte-identical torrent files for the piece checks to pass.

Acceptance: the torrent completes through HTTP when peers are unavailable.

### Phase 5 — Destination directory

- Add a real destination selector.
- Default to the launcher's current working directory.
- Persist the selected destination.
- Create it when needed.
- Show the selected path and disk-space errors.
- Keep resume data associated with that destination.

Note: a browser directory input cannot expose the absolute path to the Deno process. It can enumerate files, but a real
destination picker requires a native picker, typed path, or an explicit file-copy flow.

Acceptance: users can select a destination, restart the launcher, and resume.

### Phase 6 — Existing installation discovery

Implement discovery independently before integrating it with downloading:

- Check known directories and common user locations.
- Scan roots and additional drives with cancellation.
- Track duplicate paths.
- Tolerate permission errors.
- Exclude system and cache directories.
- Bound scan concurrency.
- Detect WoW directories using anchor files.
- Validate files using fixed sizes and SHA-256 hashes.
- Log roots, progress, candidates, validation, and final results.

When discovery finds a valid source during download:

1. Pause the torrent.
2. Validate the source files.
3. Copy verified files into the managed destination.
4. Reopen or re-add the torrent against that destination.
5. Recheck existing pieces.
6. Resume downloading only what remains.

Acceptance: discovery can reduce an active download and the UI shows pause, copy, recheck, and resumed-download phases.

### Later platform work

After the Windows flow is stable, investigate Unix and macOS separately:

- filesystem permissions;
- executable permissions and launching;
- packaging and distribution;
- application bundles;
- quarantine, signing, notarization, and updates;
- platform-specific torrent networking.
