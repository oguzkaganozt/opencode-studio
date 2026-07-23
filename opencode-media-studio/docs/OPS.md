# VPS runbook

This runbook is the operator checklist for the team VPS. The README is the
primary user-facing surface; this file complements it with the operations
commands a teammate running the host needs to apply, verify, or recover
without re-deriving the deployment model.

## Layout

- Shared Unix group: `opencode-media`.
- Library root: `/srv/opencode-media-studio` (mode `2770`, root:opencode-media).
- Companion service account: `opencode-companion` (member of `opencode-media`,
  no login shell, no home).
- Companion port: `4173`.
- Public entrypoint: Cloudflare Tunnel + Cloudflare Access application.
- Shared billing key: `/etc/opencode-media-studio/fal.env` (mode `0640`,
  root:opencode-media). Each teammate sources it before `opencode`.
- The companion is a read-only Library viewer (OSC). Browser mutations are not
  exposed; Library changes happen through agent tools. When the companion is
  behind Cloudflare Tunnel, bind to `0.0.0.0` and rely on Cloudflare Access as
  the sole authentication gate. GET endpoints (list, health, version, studio,
  stream, download) are open to any admitted client.

## One-time provisioning

```bash
sudo groupadd --system opencode-media
sudo useradd --system --shell /usr/sbin/nologin --no-create-home \
  --ingroup opencode-media opencode-companion

for teammate in alice bob; do
  sudo usermod -aG opencode-media "$teammate"
done

sudo install -d -m 2770 -o root -g opencode-media /srv/opencode-media-studio
sudo install -d -m 0750 -o root -g opencode-media /etc/opencode-media-studio
```

Install one system-wide managed release and create the shared `FAL_KEY` file:

```bash
sudo npm install --global opencode-media-studio
# Optional always-on systemd companion (not OSC core install)
sudo opencode-media-studio service-install \
  --directory /srv/opencode-media-studio \
  --host 0.0.0.0 \
  --port 4173 \
  --user opencode-companion \
  --group opencode-media
# OpenCode plugin + skill registration (per operator / teammate as needed)
opencode-media-studio install --scope user

sudo tee /etc/opencode-media-studio/fal.env >/dev/null <<'EOF'
FAL_KEY=replace-with-the-team-fal-key
EOF
sudo chmod 0640 /etc/opencode-media-studio/fal.env
sudo chown root:opencode-media /etc/opencode-media-studio/fal.env
```

`service-install` also accepts `--install-root` to override `/opt/opencode-media-studio`,
`--no-service` to skip systemd unit creation, and `--dry-run` to preview without
writing files. OSC `install` / `remove` / `doctor` manage OpenCode plugin and
skill registration only.

Drop the per-user plugin config from "VPS deployment / Per-user OpenCode plugin
configuration" into `~/.config/opencode/opencode.json` for every teammate. The
config points every process at the same root-owned
`/opt/opencode-media-studio/current` release. Do not create per-user package
copies.

## Firewall

Block direct public access to the origin port with `nftables`. The companion
must only be reachable through the authenticated Cloudflare hostname. Allow
only Cloudflare's published proxy IP ranges, then verify:

```bash
sudo ss -ltnp | grep ':4173'   # expect 0.0.0.0:4173
curl -fsS http://127.0.0.1:4173/api/health
sudo nft list ruleset
```

Cloudflare publishes their current IP ranges at
`https://www.cloudflare.com/ips-v4` and `https://www.cloudflare.com/ips-v6`.
Use these to build an allowlist. If you prefer loopback-only (no Cloudflare
Tunnel), bind to `127.0.0.1` instead. Library mutations always go through
agent tools (`media_*`, generation, download), not the companion.

## Rotation

- `FAL_KEY` rotation: edit `/etc/opencode-media-studio/fal.env`, then restart
  each teammate's `opencode serve` process. The companion does not read
  `FAL_KEY`, so it does not need to restart.
- Package upgrade: run `sudo opencode-media-studio service-update`. It stages and
  validates a new release, atomically switches `current`, and restarts the
  companion. Restart active OpenCode CLI/TUI/serve processes when convenient so
  they load the new plugin; no per-user package update is required. Re-run
  `opencode-media-studio install` on each scope that should refresh the managed skill.
- Adding a teammate: add them to `opencode-media`, give them a personal
  `users/<unix-user>/` directory inside the Library root, and configure their
  `opencode.json`. No restart of the companion or other teammates is required.

## Recovery

- Companion 5xx on `/`: confirm the bundled UI exists at
  `/opt/opencode-media-studio/current/node_modules/opencode-media-studio/dist/ui/index.html`,
  then restart the unit.
- Permission denied for a teammate on a Library file: confirm the teammate is
  in `opencode-media`, the file's group is `opencode-media`, and its mode is
  `0660`. New files inherit the setgid group automatically; fix old files
  with `sudo find /srv/opencode-media-studio -group <old> -exec chgrp
  opencode-media {} +`.
- Companion rejected a request with `Host header rejected`: loopback binds
  (`127.0.0.1`) only accept loopback Host values. Wildcard binds (`0.0.0.0`)
  accept any Host header for Tunnel/proxy deployments and still require the
  header to be present.
