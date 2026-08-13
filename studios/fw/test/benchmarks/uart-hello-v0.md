# Firmware benchmark — uart-hello-v0

## Constants (do not change between runs)

- **id:** `uart-hello-v0`
- **model:** `xai/grok-4.5`
- **agent:** `studio-fw`
- **expect:** `BENCH_UART_OK`
- **user prompt:** exact block below (byte-identical)

## User prompt

```text
I need firmware for an ESP32 that prints BENCH_UART_OK on the serial console.

Done when that text actually shows up in a run, not just in the source.
```
