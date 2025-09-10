#!/usr/bin/env node

/**
 * Test script for 50:50 lifeline when wrong answer is already selected
 * This simulates the exact scenario the user described:
 * 1. Host selects a wrong answer
 * 2. Answer is locked in and revealed as wrong
 * 3. 50:50 lifeline is used
 * 4. Should eliminate only 1 additional wrong answer, leaving 2 unchosen answers
 */

const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:8081';
let ws;
let testStep = 0;

function connectWebSocket() {
    ws = new WebSocket(SERVER_URL);
    
    ws.on('open', () => {
        console.log('✅ Connected to bridge server');
        // Register as control panel
        ws.send(JSON.stringify({
            type: 'register',
            client: 'control_panel'
        }));
        
        // Start the test sequence after a brief delay
        setTimeout(startTestSequence, 1000);
    });
    
    ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        // Listen for state updates to track the game progress
        if (message.type === 'game_state' || !message.type) {
            handleStateUpdate(message);
        }
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        process.exit(1);
    });
    
    ws.on('close', () => {
        console.log('📤 WebSocket connection closed');
    });
}

function handleStateUpdate(state) {
    // Log relevant state changes
    if (state.fifty_fifty_eliminated && state.fifty_fifty_eliminated.length > 0) {
        console.log('🎯 50:50 eliminated answers:', state.fifty_fifty_eliminated);
        console.log('   Eliminated count:', state.fifty_fifty_eliminated.length);
        
        if (state.answer_is_wrong && state.selected_answer !== null) {
            console.log('❌ Wrong answer (should stay red):', String.fromCharCode(65 + state.selected_answer));
            console.log('   Selected answer index:', state.selected_answer);
            
            // Verify that only 1 answer was eliminated (not 2)
            if (state.fifty_fifty_eliminated.length === 1) {
                console.log('✅ CORRECT: Only 1 answer eliminated (leaving 2 unchosen for 50:50)');
            } else if (state.fifty_fifty_eliminated.length === 2) {
                console.log('❌ ERROR: 2 answers eliminated (should be only 1 when wrong answer selected)');
            }
        }
    }
}

async function sendControlAction(action, data = {}) {
    const payload = JSON.stringify({
        action: action,
        ...data
    });
    
    const response = await fetch('http://localhost:8081/api/control', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: payload
    });
    
    if (!response.ok) {
        console.error(`❌ Failed to send action ${action}:`, response.status);
        return false;
    }
    
    console.log(`📡 Sent action: ${action}`);
    return true;
}

async function startTestSequence() {
    console.log('\n🧪 Starting 50:50 test with wrong answer already selected\n');
    
    // Step 1: Reset game
    console.log('Step 1: Resetting game...');
    await sendControlAction('reset_game');
    await delay(1000);
    
    // Step 2: Set contestant
    console.log('Step 2: Setting contestant...');
    await sendControlAction('set_contestant', { name: 'Test Player' });
    await delay(1000);
    
    // Step 3: Start game
    console.log('Step 3: Starting game...');
    await sendControlAction('start_game');
    await delay(2000);
    
    // Step 4: Complete intro
    console.log('Step 4: Completing intro...');
    await sendControlAction('intro_complete');
    await delay(2000);
    
    // Step 5: Show question
    console.log('Step 5: Showing question...');
    await sendControlAction('show_question');
    await delay(3000); // Wait for typewriter animation
    
    // Step 6: Show answers
    console.log('Step 6: Showing answers...');
    await sendControlAction('show_answers');
    await delay(1000);
    
    // Step 7: Select a wrong answer (let's select B, assuming A is correct)
    console.log('Step 7: Selecting wrong answer B...');
    await sendControlAction('set_selected_answer', { answer: 1 }); // Index 1 = B
    await delay(1000);
    
    // Step 8: Lock in the answer
    console.log('Step 8: Locking in answer B...');
    await sendControlAction('lock_answer');
    await delay(1000);
    
    // Step 9: Reveal answer (will show as wrong)
    console.log('Step 9: Revealing answer (should be wrong)...');
    await sendControlAction('reveal_answer');
    await delay(2000);
    
    // Step 10: Use 50:50 lifeline (directly trigger it during lifeline voting)
    console.log('\n🎯 Step 10: Using 50:50 lifeline with wrong answer B already selected...');
    console.log('Expected behavior:');
    console.log('  - Answer B stays red (wrong answer)');
    console.log('  - Only 1 additional answer eliminated (C or D)');
    console.log('  - Leaves 2 unchosen answers for true 50:50 chance');
    
    // During lifeline voting, we need to use the correct action name
    await sendControlAction('use_lifeline_fiftyFifty');
    await delay(3000);
    
    console.log('\n✅ Test sequence complete!');
    console.log('Check the logs above to verify:');
    console.log('1. Only 1 answer was eliminated (not 2)');
    console.log('2. Wrong answer B stayed red');
    console.log('3. Two unchosen answers remain for 50:50 chance');
    
    // Close connection after a delay
    setTimeout(() => {
        ws.close();
        process.exit(0);
    }, 2000);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the test
connectWebSocket();