# Hot Seat Integration Guide

This repository already includes the centered hot seat overlay and the server-side guard that restricts answers to the chosen contestant. If you are cherry-picking pieces of the change into another project, use the references below to copy the exact blocks that were updated.

## 1. Client logic (`static/gameshow.js`)
* **Function:** `handleHotSeatActivated(message)`
* **Lines:** 4072 – 4151
* **What changed:**
  * Builds the participant list (`message.users`/`message.user`) and chooses the primary contestant.
  * Updates the overlay elements (`#hot-seat-display`, `#hot-seat-user`, `#hot-seat-timer`, `#hot-seat-status`) and drives the HUD banner.
  * Adds the `hot-seat-active` class to the `<body>` so the CSS can center the panel and dim the rest of the UI.

Additional helper callbacks that were tuned to match the layout live immediately after this function:
* `handleHotSeatTimerUpdate` (lines 4153 – 4173)
* `handleHotSeatAnswered` (lines 4175 – 4192)
* `handleHotSeatTimeout` (lines 4194 – 4211)
* `handleHotSeatEnded` (lines 4213 – 4244)

## 2. Client styling (`static/gameshow.css`)
* **Block:** Hot seat display styles
* **Lines:** 3320 – 3512
* **What changed:**
  * `.hot-seat-display` defaults to an auto-centered card and expands into a fixed, centered overlay when the `active` class is present.
  * Supporting animations for the badge, timer, and HUD overlay.
  * `body.hot-seat-active` hides competing UI panels while the overlay is active.

## 3. Server logic (`bridge-server.js`)
* **Function:** `initializeHotSeatSession(selectedUsers, options = {})`
* **Lines:** 4762 – 4814
* **What changed:**
  * Accepts one or more selected usernames, stores them on `gameState`, and disables audience polls during the round.
  * Broadcasts the `hot_seat_activated` payload with the timer value that the client uses for the centered overlay.

Supporting utilities that call into the initializer:
* `drawHotSeatWinners` (lines 4817 – 4839) — used when the host collects `JOIN` entries.
* `selectHotSeatUser` (lines 4841 – 4905) — used for manual or random selection.
* `processHotSeatAnswer` (lines 4951 – 5009) — now rejects answers from anyone other than `gameState.hot_seat_user`.

---
**Tip:** When copying, include the entire function/block shown in the ranges above. Each block assumes the surrounding helper functions and constants that already exist in this repository.
