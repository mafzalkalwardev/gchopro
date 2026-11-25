# Design

## Visual concept

GChoPro looks like a dispatch bench for handsets the operator owns. A vertical rail lists SIM slots the way they sit in a phone, and the main pane is a message tape: one line after another, with status stamped at the edge. A stranger should see slots, a handset, and a send queue before reading the product name. Amber is used only for live signal and attention, the way a radio's lamp marks the channel that is on the air.

## Type

- **Newsreader** is the display face. It is an editorial serif, closer to a ledger heading than to a startup wordmark, and it suits a bench where the operator reads names and notices.
- **IBM Plex Sans** is the body face. It stays readable in dense admin tables and portal threads.
- **IBM Plex Mono** is for phone numbers, slot indexes, and message ids, so digits line up and are not mistaken for prose.

Load all three with `next/font` so the build self-hosts them. Fallback stack: Newsreader, Palatino, "Palatino Linotype", serif; then IBM Plex Sans, "Segoe UI", sans-serif; then IBM Plex Mono, ui-monospace, monospace.

## Color

Tokens live in CSS variables.

| Token | Hex | Use |
| --- | --- | --- |
| `--color-ink` | `#1C1915` | Text, rules, the slot rail on paper |
| `--color-paper` | `#F4F0E6` | Page background |
| `--color-signal` | `#C46B1A` | Live SIM, unread, and the one accent for attention |

Ink dominates. Signal is the accent. Paper is the neutral ground. Do not introduce a second accent.

## Layout

The slot rail sits on the left and is narrower than the tape. It is the asymmetric decision: slots are a physical column, not a row of equal cards. On a narrow screen the rail collapses first, into a single slot switcher above the tape. The tape keeps full width. Touch targets stay at least 44px. Widths to build and check: 320, 768, 1024, and 1440. No horizontal scroll at those widths.

M0 does not build these screens. The boot shell only applies the tokens.

## Motion

- Slot-rail collapse and tape updates are state changes. They are instant when `prefers-reduced-motion: reduce` is set.
- Later screens may use GSAP for a scroll-linked walkthrough of the dispatch path, because that sequence is tied to reading order.
- Framer Motion, when added, is limited to enter, exit, and layout of panels. It is not used for decoration.
- No animation in M0.

## Responsive

Build and check 320, 768, 1024, and 1440 when screens exist. Verify 320 and 1440 in the browser, and check 768 and 1024 the same way. Text wraps. Images scale inside their frame.

## Logo

No logo in M0. The media phase adds a mark that uses ink and signal only.
