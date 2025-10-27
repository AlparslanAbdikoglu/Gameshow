#!/usr/bin/env node

/**
 * Test Lifeline Timer Fix - Verify that lifeline voting doesn't freeze
 * 
 * This test specifically verifies:
 * 1. Lifeline voting duration is 30 seconds (not 60)
 * 2. Timer properly expires and ends voting
 * 3. No freeze scenario occurs
 */

const WebSocket = require('ws');

class LifelineTimerTest {
    constructor() {
        this.ws = null;
        this.testStartTime = Date.now();
        this.connected = false;
        this.testResults = [];
        this.timerExpiredCorrectly = false;
    }

    log(message) {
        console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
    }

    addResult(test, success, details = '') {
        this.testResults.push({ test, success, details });
        const status = success ? '✅ PASS' : '❌ FAIL';
        this.log(`${status}: ${test} ${details}`);
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket('ws://localhost:8081');
            
            this.ws.on('open', () => {
                this.log('🔌 Connected to bridge server');
                this.connected = true;
                
                // Register as test client
                this.ws.send(JSON.stringify({
                    type: 'register',
                    client: 'lifeline_timer_test'
                }));
                
                resolve();
            });
            
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleMessage(message);
                } catch (error) {
                    // Ignore non-JSON messages
                }
            });
            
            this.ws.on('error', (error) => {
                this.log(`❌ WebSocket error: ${error.message}`);
                reject(error);
            });
            
            this.ws.on('close', () => {
                this.log('🔌 WebSocket connection closed');
                this.connected = false;
            });
        });
    }

    handleMessage(message) {
        // Track when lifeline voting starts
        if (message.lifeline_voting_active === true && message.lifeline_voting_timer_active === true) {
            this.log(`🗳️ Lifeline voting started - Duration: ${message.lifeline_voting_duration}ms`);
            
            // Test 1: Check that duration is 30 seconds (30000ms)
            if (message.lifeline_voting_duration === 30000) {
                this.addResult('Lifeline voting duration is 30 seconds', true);
            } else {
                this.addResult('Lifeline voting duration is 30 seconds', false, 
                    `Got ${message.lifeline_voting_duration}ms instead of 30000ms`);
            }
            
            // Set a timer to check if voting ends automatically after ~30 seconds
            setTimeout(() => {
                if (this.connected) {
                    this.checkVotingEndedCorrectly();
                }
            }, 32000); // Check 2 seconds after expected end time
        }

        // Track when lifeline voting ends
        if (message.lifeline_voting_active === false && message.lifeline_voting_timer_active === false) {
            this.log('🏁 Lifeline voting ended');
            this.timerExpiredCorrectly = true;
            
            // Test 2: Voting ended correctly (no freeze)
            this.addResult('Lifeline voting ended without freezing', true);
        }

        // Track countdown messages
        if (message.type === 'lifeline_voting_countdown') {
            const seconds = Math.ceil(message.remainingTime / 1000);
            if (seconds <= 5) {
                this.log(`⏰ Countdown: ${seconds} seconds remaining`);
            }
        }
    }

    checkVotingEndedCorrectly() {
        if (this.timerExpiredCorrectly) {
            this.addResult('Timer expired and voting ended correctly', true);
        } else {
            this.addResult('Timer expired and voting ended correctly', false, 
                'Voting appears to still be active after timer should have expired');
        }
        
        // End the test
        setTimeout(() => this.endTest(), 1000);
    }

    async sendAction(action) {
        if (!this.connected) {
            this.log('❌ Not connected to server');
            return false;
        }

        try {
            const response = await fetch('http://localhost:8081/api/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });

            if (response.ok) {
                this.log(`✅ Action sent: ${action}`);
                return true;
            } else {
                this.log(`❌ Failed to send action: ${action} (${response.status})`);
                return false;
            }
        } catch (error) {
            this.log(`❌ Error sending action ${action}: ${error.message}`);
            return false;
        }
    }

    async setupGame() {
        this.log('🎮 Setting up game for lifeline voting test...');
        
        // Reset and start game
        await this.sendAction('reset_game');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await this.sendAction('set_contestant');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await this.sendAction('start_game');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await this.sendAction('intro_complete');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await this.sendAction('show_question');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await this.sendAction('show_answers');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Lock in a wrong answer (A is wrong for first question)
        await this.sendAction('set_selected_answer');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await this.sendAction('lock_answer');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Reveal the wrong answer (should trigger lifeline voting)
        this.log('🎯 Revealing wrong answer to trigger lifeline voting...');
        await this.sendAction('reveal_answer');
        
        // Wait a moment for lifeline voting to start
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    endTest() {
        this.log('\n📊 TEST RESULTS:');
        
        let passCount = 0;
        let failCount = 0;
        
        this.testResults.forEach(result => {
            const status = result.success ? '✅ PASS' : '❌ FAIL';
            console.log(`  ${status}: ${result.test} ${result.details}`);
            if (result.success) {
                passCount++;
            } else {
                failCount++;
            }
        });
        
        console.log(`\n📈 Summary: ${passCount} passed, ${failCount} failed`);
        
        const testDuration = ((Date.now() - this.testStartTime) / 1000).toFixed(1);
        console.log(`⏱️  Test completed in ${testDuration} seconds`);
        
        if (this.ws && this.connected) {
            this.ws.close();
        }
        
        // Exit with error code if any tests failed
        process.exit(failCount > 0 ? 1 : 0);
    }

    async runTest() {
        try {
            this.log('🧪 Starting Lifeline Timer Fix Test...');
            
            // Connect to server
            await this.connect();
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Setup the game to trigger lifeline voting
            await this.setupGame();
            
            this.log('⏳ Waiting for 35 seconds to observe complete timer cycle...');
            
            // Wait 35 seconds for the complete cycle (30s timer + buffer)
            setTimeout(() => {
                if (this.connected && !this.timerExpiredCorrectly) {
                    this.log('⚠️  Timer did not expire as expected - checking final state...');
                    this.checkVotingEndedCorrectly();
                }
            }, 35000);
            
        } catch (error) {
            this.log(`❌ Test failed with error: ${error.message}`);
            this.endTest();
        }
    }
}

// Run the test
const test = new LifelineTimerTest();
test.runTest().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
});