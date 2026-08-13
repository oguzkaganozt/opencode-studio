---
name: studio-fw
description: >
  Load before ESP-IDF firmware work with fw_* tools — project create, idf.py build,
  QEMU or esp-emu UART simulation, expect/fail probes. Not for mechanical FDM CAD
   (studio-cad) or electronics/PCB (studio-pcb).
license: proprietary
compatibility: opencode
---

# Firmware Studio

Use Firmware Studio for ESP-IDF firmware under `$STUDIO_HOME/studio/firmware/<id>/`.
Load this skill before any `fw_*` work.

Do not load `studio-cad` or `studio-pcb` for firmware.

## Supported chips (hard fail otherwise)

| Chip | Engine | Capabilities |
| --- | --- | --- |
| `esp32` | QEMU | uart |
| `esp32s3` | QEMU | uart |
| `esp32c3` | esp-emu | uart, gpio, wifi, ble |
| `esp32c6` | esp-emu | uart, gpio, wifi, ble, thread |
| `esp32h2` | esp-emu | uart, gpio, ble, thread |
| `esp32p4` | esp-emu | uart, gpio |

Call `fw_caps` before claiming a chip works. There is no silent fallback.

QEMU chips are UART-only. Do not claim GPIO, I2C, SPI, Wi-Fi, or BLE on `esp32` / `esp32s3`.

## Engines

Firmware Studio installs its own engines on first `fw_build` / `fw_sim_run` (XDG cache), same idea as CAD `uv`. Existing ESP-IDF / QEMU installs are reused when present.

- Build: ESP-IDF (`idf.py`)
- `esp32` / `esp32s3`: Espressif QEMU
- `esp32c3` / `esp32c6` / `esp32h2` / `esp32p4`: `esp-emu`

Do not tell the user to install ESP-IDF, QEMU, or esp-emu by hand.

## Workflow

1. `fw_workspace_list` and `fw_caps` once.
2. New project: `fw_project_create` with `id` + `chip`. Then edit `main/main.c`.
3. `fw_build`. Build success is not done.
4. `fw_sim_run` with an `expect` string the firmware must print. Optional `fail` for panic markers.
5. Claim complete only when `fw_sim_run` returns `ok: true` and `reason` is `expect` (or `exit` with code 0 when no expect was set).
6. Any source edit invalidates prior build/sim. Rebuild and re-run before citing results.

## Tools

| Need | Tool |
| --- | --- |
| List projects | `fw_workspace_list` |
| Supported chips | `fw_caps` |
| New project | `fw_project_create` |
| Status | `fw_project_read` |
| Compile | `fw_build` |
| Simulate | `fw_sim_run` |
| Read UART | `fw_sim_log` |
| Publish SPEC.json | `fw_spec` |

## Spec

After a successful sim, call `fw_spec` to write `SPEC.json` in the project directory.
Other studios open that file with the stock `read` tool. Do not call `cad_*` or `pcb_*`.
`status: blocked` means not ready (no current sim). After source edits, rebuild, re-sim, and `fw_spec` again — the file does not update itself.

## Viewer

Console is the last UART log. Selecting a line sends it to the agent as user intent. Fix with tools, not by editing the log.
