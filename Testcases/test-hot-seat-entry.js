const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const assert = require('assert');

const repoRoot = path.resolve(__dirname, '..');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(child) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timed out waiting for server to start'));
        }, 10000);

        child.stdout.on('data', (data) => {
            const text = data.toString();
            if (text.includes('Bridge Server running')) {
                clearTimeout(timeout);
                resolve();
            }
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            if (text) {
                process.stderr.write(text);
            }
        });

        child.on('exit', (code) => {
            clearTimeout(timeout);
            reject(new Error(`Server exited prematurely with code ${code}`));
        });
    });
}

async function run() {
    const server = spawn('node', ['bridge-server.js'], {
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: 'test' }
    });

    try {
        await waitForServerReady(server);

        const ws = new WebSocket('ws://127.0.0.1:8081');
        const waiters = [];
        const hotSeatAnswerMessages = [];

        async function sendControlAction(body) {
            const response = await fetch('http://127.0.0.1:8081/api/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.error) {
                throw new Error(`Control action failed: ${response.status} ${payload?.error || ''}`);
            }

            return payload;
        }

        function registerWaiter(type, predicate, timeoutMs = 5000) {
            return new Promise((resolve, reject) => {
                const waiter = {
                    type,
                    predicate,
                    resolve,
                    timeout: setTimeout(() => {
                        const index = waiters.indexOf(waiter);
                        if (index !== -1) {
                            waiters.splice(index, 1);
                        }
                        reject(new Error(`Timed out waiting for ${type}`));
                    }, timeoutMs)
                };

                waiters.push(waiter);
            });
        }

        ws.on('message', (raw) => {
            let message;
            try {
                message = JSON.parse(raw.toString());
            } catch (error) {
                return;
            }

            if (message.type === 'hot_seat_answered') {
                hotSeatAnswerMessages.push(message);
            }

            for (let i = waiters.length - 1; i >= 0; i -= 1) {
                const waiter = waiters[i];
                if (waiter.type === message.type && waiter.predicate(message)) {
                    waiters.splice(i, 1);
                    clearTimeout(waiter.timeout);
                    waiter.resolve(message);
                }
            }
        });

        await new Promise((resolve, reject) => {
            ws.once('open', resolve);
            ws.once('error', reject);
        });

        function send(data) {
            ws.send(JSON.stringify(data));
        }

        function waitForMessage(type, predicate = () => true, timeoutMs) {
            return registerWaiter(type, predicate, timeoutMs);
        }

        function sendChat(username, text) {
            send({
                type: 'chat_message',
                username,
                text,
                platform: 'twitch',
                timestamp: Date.now()
            });
        }

        send({ type: 'register', client: 'integration_test' });

        await sendControlAction({ action: 'toggle_hot_seat', enabled: true });
        await waitForMessage('state', (msg) => msg.data && msg.data.hot_seat_enabled === true);

        await sendControlAction({ action: 'start_hot_seat_entry' });
        await waitForMessage('hot_seat_entry_started');

        sendChat('ViewerOne', 'JOIN');
        await waitForMessage('hot_seat_entry_update', (msg) => msg.entries === 1);

        sendChat('ViewerTwo', '!Join');
        await waitForMessage('hot_seat_entry_update', (msg) => msg.entries === 2);

        await sendControlAction({ action: 'activate_hot_seat' });
        const activation = await waitForMessage('hot_seat_activated');

        assert(Array.isArray(activation.users), 'Expected hot seat activation to include user list');
        assert(activation.users.length >= 1, 'Expected at least one hot seat user');

        const normalizedUsers = activation.users.map((u) => u.toLowerCase());
        assert(normalizedUsers.includes('viewerone') || normalizedUsers.includes('viewertwo'),
            'Expected activation to select one of the joining viewers');

        const activeUser = activation.user;
        const fallbackUser = normalizedUsers.includes('viewerone') ? 'ViewerTwo' : 'ViewerOne';

        const answersBefore = hotSeatAnswerMessages.length;
        sendChat(fallbackUser, 'A');
        await delay(400);
        assert.strictEqual(hotSeatAnswerMessages.length, answersBefore,
            'Non-hot-seat user should not be able to lock in an answer');

        sendChat(activeUser, 'B');
        const answerMessage = await waitForMessage('hot_seat_answered',
            (msg) => msg.user && msg.user.toLowerCase() === activeUser.toLowerCase());
        assert.strictEqual(answerMessage.answer, 'B', 'Hot seat answer should match submitted value');

        ws.close();
        await new Promise((resolve) => ws.once('close', resolve));
    } finally {
        server.kill('SIGINT');
        await new Promise((resolve) => {
            server.once('exit', () => resolve());
            setTimeout(resolve, 2000);
        });
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
