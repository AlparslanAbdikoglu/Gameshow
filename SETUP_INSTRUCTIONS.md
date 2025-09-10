# Kimbillionaire Gameshow - Setup Instructions

## Overview
This is a complete "Who Wants to Be a Millionaire" style gameshow system designed for streaming on platforms like Twitch or YouTube. The system includes a game server, control panel for the host, and OBS browser source for the audience display.

## System Requirements
- Node.js 16+ (https://nodejs.org/)
- npm (comes with Node.js)
- OBS Studio for streaming (optional)
- Modern web browser

## Quick Start

### 1. Install Dependencies

```bash
# In the root directory
npm install

# In the control panel directory
cd control-panel-react
npm install
cd ..
```

### 2. Configure the System (Optional)

Copy the template configuration files:
```bash
cp .env.template .env
cp polling-config.template.json polling-config.json
```

Edit `.env` and add your API keys if you want to enable:
- AI host functionality (Gemini API)
- Text-to-speech (Google TTS)
- Twitch chat integration
- YouTube chat integration

Note: The gameshow works without these API keys, but some features will be disabled.

### 3. Start the Servers

**Option A: Start servers manually**
```bash
# Terminal 1 - Start the main game server
node bridge-server.js

# Terminal 2 - Start the control panel
cd control-panel-react
npm start
```

**Option B: Start both with one command**
```bash
# Create a start script
npm run start-all
```

### 4. Access the Applications

- **Control Panel**: http://localhost:3000/control
- **Game Display (OBS Browser Source)**: http://localhost:8081/gameshow
- **API Status**: http://localhost:8081/api/state

## OBS Setup

1. Add a Browser Source in OBS
2. Set URL to: `http://localhost:8081/gameshow`
3. Set Width: 1920, Height: 1080
4. Check "Shutdown source when not visible" (optional)
5. Check "Refresh browser when scene becomes active" (optional)

## Basic Usage

### Starting a Game

1. Open the Control Panel (http://localhost:3000/control)
2. Enter contestant name in the Game Setup section
3. Click "START GAME"
4. Use the Question Control section to:
   - Show Question
   - Show Answers
   - Lock in Answer (after contestant selects)
   - Reveal Answer
   - Next Question

### Using Lifelines

The game includes three classic lifelines:
- **50:50**: Removes two wrong answers
- **Ask a Mod**: Allows chat moderators to help
- **Take Another Vote**: Re-polls the audience

### Chat Integration (Optional)

If you configured Twitch/YouTube credentials:
1. The system will automatically connect to your channel
2. Viewers can vote using A, B, C, or D in chat
3. Results display in real-time on the game display

## File Structure

```
kimbillionaire-gameshow/
├── bridge-server.js          # Main game server
├── control-panel-react/      # React control panel
│   ├── src/                  # Source code
│   └── public/               # Static files
├── assets/                   # Game assets
│   ├── audio/sfx/           # Sound effects
│   └── graphics/            # Visual assets
├── static/                  # Browser source files
├── package.json             # Dependencies
└── .env                     # Configuration (create from template)
```

## Troubleshooting

### Port Already in Use
If you get an error about port 8081 or 3000 being in use:
```bash
# Find and kill the process using the port
lsof -i :8081
kill -9 [PID]
```

### Control Panel Can't Connect to Server
- Make sure bridge-server.js is running on port 8081
- Check that no firewall is blocking local connections
- Try accessing http://localhost:8081/api/state directly

### Audio Not Playing in OBS
- Make sure OBS audio monitoring is enabled for the browser source
- Check browser source properties → "Control audio via OBS"

### Chat Integration Not Working
- Verify your API credentials in .env file
- Check polling-config.json has the correct channel name
- Look for connection errors in the server console

## Advanced Configuration

### Changing Ports
Edit the port numbers in:
- `bridge-server.js` - Search for `PORT = 8081`
- `control-panel-react/package.json` - Add `"start": "PORT=3001 react-scripts start"`

### Custom Questions
Questions are currently stored in `bridge-server.js`. Search for the `questions` array to modify them.

### Styling Changes
- Game display styles: `static/gameshow.css`
- Control panel styles: `control-panel-react/src/styles/`

## Support

For issues or questions about the codebase, please refer to the inline documentation in the source files.

## License

This codebase is provided as-is for educational and entertainment purposes.