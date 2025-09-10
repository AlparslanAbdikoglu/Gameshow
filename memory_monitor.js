#!/usr/bin/env node
/**
 * Memory Usage Monitor for Lifeline Voting System
 * Monitors memory consumption during extended voting sessions
 */

const WebSocket = require('ws');

class MemoryMonitor {
    constructor() {
        this.ws = null;
        this.monitoringInterval = null;
        this.memoryHistory = [];
        this.maxHistorySize = 100;
        this.votesSent = 0;
        this.startTime = Date.now();
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log('🔌 Connecting to bridge server for memory monitoring...');
            this.ws = new WebSocket('ws://localhost:8081');
            
            this.ws.on('open', () => {
                console.log('✅ Connected to bridge server');
                resolve();
            });
            
            this.ws.on('error', reject);
        });
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    recordMemoryUsage() {
        const usage = process.memoryUsage();
        const timestamp = Date.now();
        
        const record = {
            timestamp,
            elapsed: timestamp - this.startTime,
            votesSent: this.votesSent,
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            rss: usage.rss,
            external: usage.external
        };
        
        this.memoryHistory.push(record);
        
        // Keep only recent history
        if (this.memoryHistory.length > this.maxHistorySize) {
            this.memoryHistory.shift();
        }
        
        return record;
    }

    logMemoryStatus() {
        const current = this.recordMemoryUsage();
        const runtime = Math.floor((Date.now() - this.startTime) / 1000);
        
        console.log(`📊 Memory Status (${runtime}s runtime, ${this.votesSent} votes sent):`);
        console.log(`   Heap Used: ${this.formatBytes(current.heapUsed)}`);
        console.log(`   Heap Total: ${this.formatBytes(current.heapTotal)}`);
        console.log(`   RSS: ${this.formatBytes(current.rss)}`);
        console.log(`   External: ${this.formatBytes(current.external)}`);
        
        // Calculate growth rate if we have history
        if (this.memoryHistory.length > 1) {
            const first = this.memoryHistory[0];
            const growthRate = (current.heapUsed - first.heapUsed) / (current.elapsed - first.elapsed) * 1000; // bytes per second
            console.log(`   Growth Rate: ${this.formatBytes(growthRate)}/s`);
            
            if (growthRate > 1024 * 1024) { // 1MB/s growth is concerning
                console.warn(`⚠️  High memory growth rate detected!`);
            }
        }
    }

    async sendVote(username, text) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'lifeline_vote',
                username: username,
                text: text,
                platform: 'twitch',
                timestamp: Date.now()
            }));
            this.votesSent++;
        }
    }

    async simulateExtendedVoting(durationMinutes = 10) {
        console.log(`🎯 Starting extended voting simulation for ${durationMinutes} minutes...`);
        
        const endTime = Date.now() + (durationMinutes * 60 * 1000);
        let userCounter = 0;
        
        // Start memory monitoring
        this.monitoringInterval = setInterval(() => {
            this.logMemoryStatus();
        }, 10000); // Log every 10 seconds
        
        // Simulate continuous voting
        while (Date.now() < endTime) {
            // Send batch of votes
            for (let i = 0; i < 10; i++) {
                const vote = (userCounter % 3 + 1).toString(); // Cycle through 1, 2, 3
                await this.sendVote(`user${userCounter}`, vote);
                userCounter++;
            }
            
            // Wait 1 second before next batch
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`✅ Extended voting simulation completed`);
        console.log(`📊 Total votes sent: ${this.votesSent}`);
        
        // Stop monitoring
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        // Final memory analysis
        this.analyzeFinalMemoryState();
    }

    analyzeFinalMemoryState() {
        if (this.memoryHistory.length < 2) {
            console.log('⚠️ Insufficient memory history for analysis');
            return;
        }
        
        const initial = this.memoryHistory[0];
        const final = this.memoryHistory[this.memoryHistory.length - 1];
        
        console.log('\n📊 MEMORY ANALYSIS REPORT');
        console.log('═'.repeat(50));
        
        console.log(`⏱️ Test Duration: ${Math.floor((final.elapsed) / 1000)}s`);
        console.log(`🗳️ Total Votes: ${final.votesSent}`);
        console.log(`📈 Vote Rate: ${(final.votesSent / (final.elapsed / 1000)).toFixed(2)} votes/s`);
        
        console.log('\n📊 Memory Changes:');
        console.log(`   Heap Used: ${this.formatBytes(initial.heapUsed)} → ${this.formatBytes(final.heapUsed)} (${this.formatBytes(final.heapUsed - initial.heapUsed)})`);
        console.log(`   Heap Total: ${this.formatBytes(initial.heapTotal)} → ${this.formatBytes(final.heapTotal)} (${this.formatBytes(final.heapTotal - initial.heapTotal)})`);
        console.log(`   RSS: ${this.formatBytes(initial.rss)} → ${this.formatBytes(final.rss)} (${this.formatBytes(final.rss - initial.rss)})`);
        
        // Calculate memory per vote
        const memoryPerVote = (final.heapUsed - initial.heapUsed) / final.votesSent;
        console.log(`\n📊 Memory per Vote: ${this.formatBytes(memoryPerVote)}`);
        
        // Detect potential memory leaks
        const avgGrowthRate = (final.heapUsed - initial.heapUsed) / (final.elapsed / 1000);
        console.log(`📊 Average Growth Rate: ${this.formatBytes(avgGrowthRate)}/s`);
        
        if (avgGrowthRate > 1024 * 100) { // 100KB/s
            console.warn('⚠️  POTENTIAL MEMORY LEAK DETECTED!');
            console.warn('   Memory growth rate exceeds normal usage patterns');
        } else {
            console.log('✅ Memory usage appears stable');
        }
        
        // Peak detection
        const peakUsage = Math.max(...this.memoryHistory.map(h => h.heapUsed));
        const minUsage = Math.min(...this.memoryHistory.map(h => h.heapUsed));
        console.log(`📊 Peak Usage: ${this.formatBytes(peakUsage)}`);
        console.log(`📊 Min Usage: ${this.formatBytes(minUsage)}`);
        console.log(`📊 Variation: ${this.formatBytes(peakUsage - minUsage)}`);
        
        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        if (memoryPerVote > 1024) {
            console.log('   • Consider implementing vote data cleanup after processing');
            console.log('   • Review data structures for unnecessary memory retention');
        } else {
            console.log('   • Memory usage per vote is efficient');
        }
        
        if (avgGrowthRate > 10240) {
            console.log('   • Implement periodic memory cleanup');
            console.log('   • Review event listener management');
        } else {
            console.log('   • Memory growth rate is acceptable');
        }
    }

    async disconnect() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        if (this.ws) {
            this.ws.close();
            console.log('🔌 Disconnected from bridge server');
        }
    }
}

// Main execution
async function main() {
    const monitor = new MemoryMonitor();
    
    try {
        await monitor.connect();
        
        // Run extended voting simulation
        await monitor.simulateExtendedVoting(2); // 2-minute test for quick results
        
    } catch (error) {
        console.error('💥 Memory monitoring failed:', error);
    } finally {
        await monitor.disconnect();
    }
}

// Run if script is executed directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = MemoryMonitor;