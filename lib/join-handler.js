function normalizeUsername(username) {
  if (typeof username !== 'string') {
    return '';
  }

  return username.trim();
}

function ensureHotSeatLookup(gameState) {
  if (gameState.hot_seat_entry_lookup instanceof Set) {
    return gameState.hot_seat_entry_lookup;
  }

  const existingEntries = Array.isArray(gameState.hot_seat_entries)
    ? gameState.hot_seat_entries
    : [];
  const lookup = new Set(
    existingEntries
      .map((name) => (typeof name === 'string' ? name.toLowerCase() : ''))
      .filter(Boolean)
  );
  gameState.hot_seat_entry_lookup = lookup;
  return lookup;
}

function isSlotMachineCollecting(gameState) {
  if (!gameState || !gameState.slot_machine || !gameState.slot_machine.current_round) {
    return false;
  }

  return gameState.slot_machine.current_round.status === 'collecting';
}

function processJoinCommand(options) {
  const {
    gameState,
    username,
    messageText,
    addSlotMachineEntry,
    onHotSeatEntryAdded,
    onHotSeatDuplicate
  } = options || {};

  if (!gameState) {
    return false;
  }

  const normalizedUsername = normalizeUsername(username);
  const message = typeof messageText === 'string' ? messageText : '';

  if (!normalizedUsername || !/\bjoin\b/i.test(message)) {
    return false;
  }

  const hotSeatActive = !!gameState.hot_seat_entry_active;
  const slotMachineActive = isSlotMachineCollecting(gameState);

  if (!hotSeatActive && !slotMachineActive) {
    return false;
  }

  let entryAdded = false;

  if (hotSeatActive) {
    const lookup = ensureHotSeatLookup(gameState);
    const lowerUsername = normalizedUsername.toLowerCase();

    if (!lookup.has(lowerUsername)) {
      lookup.add(lowerUsername);
      if (!Array.isArray(gameState.hot_seat_entries)) {
        gameState.hot_seat_entries = [];
      }
      gameState.hot_seat_entries.push(normalizedUsername);
      entryAdded = true;

      if (typeof onHotSeatEntryAdded === 'function') {
        onHotSeatEntryAdded({
          username: normalizedUsername,
          totalEntries: gameState.hot_seat_entries.length
        });
      }
    } else if (typeof onHotSeatDuplicate === 'function') {
      onHotSeatDuplicate(normalizedUsername);
    }
  }

  if (slotMachineActive && typeof addSlotMachineEntry === 'function') {
    const slotAdded = !!addSlotMachineEntry(normalizedUsername);
    entryAdded = entryAdded || slotAdded;
  }

  return entryAdded;
}

module.exports = {
  processJoinCommand
};
