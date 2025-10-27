#!/usr/bin/env node

/**
 * Simple Lifeline Timer Test
 * Tests that the lifeline voting timer works correctly and prevents freezing
 */

console.log('🧪 Testing Lifeline Timer Fix...\n');

async function testLifelineTimer() {
    console.log('1️⃣ Setting up wrong answer scenario...');
    
    // Setup game with wrong answer
    await sendAction('reset_game');
    await sendAction('set_contestant');
    await sendAction('start_game'); 
    await sendAction('intro_complete');
    await sendAction('show_question');
    await sendAction('show_answers');
    
    // Select answer A (wrong answer for question 1)
    await sendAction('set_selected_answer', { answer: 0 });
    console.log('   ✅ Selected answer A (wrong answer)');
    
    // Reveal wrong answer (should trigger lifeline voting)
    console.log('\n2️⃣ Triggering lifeline voting...');
    await sendAction('reveal_answer');
    
    // Check that lifeline voting started
    const state = await getGameState();
    
    if (state.lifeline_voting_duration === 30000) {
        console.log('   ✅ Lifeline voting duration is 30 seconds');
    } else {
        console.log(`   ❌ Lifeline voting duration is ${state.lifeline_voting_duration}ms (should be 30000ms)`);
        return false;
    }
    
    if (state.lifeline_voting_active) {
        console.log('   ✅ Lifeline voting is active');
    } else {
        console.log('   ❌ Lifeline voting should be active but is not');
        return false;
    }
    
    console.log('\n3️⃣ Waiting for timer to complete (35 seconds)...');
    
    // Wait 35 seconds and check that voting ended
    await new Promise(resolve => setTimeout(resolve, 35000));
    
    const finalState = await getGameState();
    
    if (!finalState.lifeline_voting_active) {
        console.log('   ✅ Lifeline voting ended automatically (no freeze)');
        console.log('   ✅ Timer completed successfully');
        return true;
    } else {
        console.log('   ❌ Lifeline voting still active after 35 seconds (FROZEN!)');
        console.log('   ❌ Timer fix did not work');
        return false;
    }
}

async function sendAction(action, data = {}) {
    const body = { action, ...data };
    const response = await fetch('http://localhost:8081/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    
    if (!response.ok) {
        throw new Error(`Action ${action} failed with status ${response.status}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between actions
}

async function getGameState() {
    const response = await fetch('http://localhost:8081/api/state');
    return await response.json();
}

// Run the test
testLifelineTimer()
    .then(success => {
        console.log('\n📊 TEST RESULT:');
        if (success) {
            console.log('   🎉 LIFELINE TIMER FIX IS WORKING!');
            console.log('   ✅ 30-second timer correctly ends voting');
            console.log('   ✅ No freeze scenario detected');
            process.exit(0);
        } else {
            console.log('   💥 LIFELINE TIMER HAS ISSUES!');
            console.log('   ❌ Timer may not be working correctly');
            process.exit(1);
        }
    })
    .catch(error => {
        console.log('\n❌ TEST FAILED WITH ERROR:');
        console.log('   ', error.message);
        process.exit(1);
    });