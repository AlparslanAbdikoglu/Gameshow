const test = require('node:test');
const assert = require('node:assert/strict');
const { processJoinCommand } = require('../lib/join-handler');

function buildGameState(overrides = {}) {
    return {
        hot_seat_entry_active: false,
        hot_seat_entries: [],
        hot_seat_entry_lookup: new Set(),
        slot_machine: null,
        ...overrides
    };
}

test('ignores JOIN when no entry windows are active', () => {
    const gameState = buildGameState();
    const handled = processJoinCommand({
        gameState,
        username: 'Roary',
        messageText: 'JOIN'
    });
    assert.equal(handled, false);
    assert.equal(gameState.hot_seat_entries.length, 0);
});

test('records hot seat entries and dedupes duplicates', () => {
    const gameState = buildGameState({ hot_seat_entry_active: true });
    const added = [];
    const handled = processJoinCommand({
        gameState,
        username: '  Kimba ',
        messageText: 'join',
        onHotSeatEntryAdded: ({ username, totalEntries }) => {
            added.push({ username, totalEntries });
        },
        onHotSeatDuplicate: (name) => {
            added.push({ duplicate: name });
        }
    });

    assert.equal(handled, true);
    assert.deepEqual(gameState.hot_seat_entries, ['Kimba']);
    assert.equal(added.length, 1);
    assert.deepEqual(added[0], { username: 'Kimba', totalEntries: 1 });

    const duplicateHandled = processJoinCommand({
        gameState,
        username: 'KIMBA',
        messageText: 'JOIN now',
        onHotSeatDuplicate: (name) => {
            added.push({ duplicate: name });
        }
    });

    assert.equal(duplicateHandled, false);
    assert.equal(gameState.hot_seat_entries.length, 1);
    assert.deepEqual(added.at(-1), { duplicate: 'KIMBA' });
});

test('routes JOIN to slot machine when collecting', () => {
    let slotMachineCalls = 0;
    const gameState = buildGameState({
        slot_machine: {
            current_round: { status: 'collecting' }
        }
    });

    const handled = processJoinCommand({
        gameState,
        username: 'Simba',
        messageText: 'JOIN!!',
        addSlotMachineEntry: (name) => {
            slotMachineCalls += 1;
            assert.equal(name, 'Simba');
            return true;
        }
    });

    assert.equal(handled, true);
    assert.equal(slotMachineCalls, 1);
});

test('handles simultaneous hot seat and slot machine windows', () => {
    let slotMachineCalls = 0;
    const gameState = buildGameState({
        hot_seat_entry_active: true,
        slot_machine: {
            current_round: { status: 'collecting' }
        }
    });

    const handled = processJoinCommand({
        gameState,
        username: 'Nala',
        messageText: 'Join please',
        addSlotMachineEntry: () => {
            slotMachineCalls += 1;
            return true;
        }
    });

    assert.equal(handled, true);
    assert.equal(slotMachineCalls, 1);
    assert.deepEqual(gameState.hot_seat_entries, ['Nala']);
});
