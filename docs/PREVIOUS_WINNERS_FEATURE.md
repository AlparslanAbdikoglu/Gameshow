# Previous Winners Leaderboard Feature

## Overview
The Previous Winners feature allows you to archive and track game winners separately from the current leaderboard. Winners are stored with their complete game statistics while keeping the leaderboard data intact.

## Features

### 🏆 Winner Archive System
- Archive top players from completed games
- Store complete game statistics with each winner
- Maintain historical record of all previous winners
- Winners remain in `leaderboard-data.json` with full stats

### 📊 Data Tracked Per Winner
- Game ID (unique identifier)
- Date and time of win
- Username and contestant name
- Final points and score
- Correct answers / Total answers
- Accuracy percentage
- Best streak achieved
- Fastest correct response time
- Hot Seat appearances and correct answers
- Number of questions completed

### 🎮 Control Panel UI

#### Previous Winners Tab
Located in the Leaderboard Control panel alongside other tabs (Current Game, Daily, Weekly, etc.)

#### Available Actions
1. **🏆 Archive Top Player** - Automatically archives the #1 player from current game
2. **➕ Archive Custom Player** - Manually archive any player by username
3. **📥 Export** - Export winners data as JSON
4. **📤 Import** - Import previous winners from JSON file
5. **🗑️ Remove** - Delete individual winner entries

#### Display Information
- Total games count
- Last updated timestamp
- Sortable table with all winner details
- Visual indication of most recent winner (🆕)

## Backend API Endpoints

### GET `/api/leaderboard/previous-winners`
Fetch all previous winners data
```json
{
  "winners": [...],
  "metadata": {
    "total_games": 10,
    "last_updated": "2024-11-08T21:40:00.000Z"
  }
}
```

### POST `/api/leaderboard/previous-winners/archive`
Archive a specific player as winner
```json
{
  "username": "playerName"
}
```

### POST `/api/leaderboard/previous-winners/auto-archive`
Automatically archive the top player from current game (no body required)

### DELETE `/api/leaderboard/previous-winners/:gameId`
Remove a specific winner entry by game ID

### POST `/api/leaderboard/previous-winners/clear`
Clear all previous winners (requires confirmation)

### GET `/api/leaderboard/previous-winners/export`
Export winners data as downloadable JSON file

### POST `/api/leaderboard/previous-winners/import`
Import winners from JSON file
```json
{
  "winners": [...],
  "metadata": {...}
}
```

## Data Storage

### File: `previous-winners.json`
```json
{
  "winners": [
    {
      "game_id": "game_1699564800000_username",
      "date": "2024-11-08T21:40:00.000Z",
      "username": "topPlayer",
      "contestant_name": "StreamerName",
      "final_points": 1250,
      "correct_answers": 12,
      "total_answers": 12,
      "accuracy": 100,
      "best_streak": 12,
      "fastest_correct_time": 8500,
      "hot_seat_appearances": 2,
      "hot_seat_correct": 2,
      "questions_completed": 12
    }
  ],
  "metadata": {
    "total_games": 1,
    "last_updated": "2024-11-08T21:40:00.000Z"
  }
}
```

## Usage Workflow

### After a Game Completes:
1. Navigate to the **Previous Winners** tab in Leaderboard Control
2. Click **🏆 Archive Top Player** to automatically archive the winner
3. Or click **➕ Archive Custom Player** to manually select a winner
4. The winner is added to the archive with full stats
5. Winner data remains in `leaderboard-data.json` for reference

### Managing Winners:
- **View All Winners**: Switch to Previous Winners tab
- **Export History**: Click Export to save winners as JSON
- **Import History**: Click Import to load previous winners
- **Remove Entry**: Click 🗑️ button next to any winner to remove

### Notes:
- Winners are sorted newest first
- Each game gets a unique ID for tracking
- Import merges with existing data (no duplicates)
- All operations are saved atomically to prevent data loss

## Implementation Details

### Backend Functions (bridge-server.js)
- `loadPreviousWinners()` - Load winners from JSON file
- `savePreviousWinners(data)` - Save winners to JSON file
- `archiveWinner(username)` - Archive specific player
- `autoArchiveTopWinner()` - Archive #1 player automatically
- `removePreviousWinner(gameId)` - Remove winner entry
- `clearPreviousWinners()` - Clear all winners
- `importPreviousWinners(data)` - Import winners with merge logic

### Frontend Components
- `LeaderboardControl.tsx` - Main component with Previous Winners tab
- `renderPreviousWinners()` - Render winners table
- State management for winners data and UI modals

### Styling
- Custom CSS for winners table
- Action buttons with distinct colors
- Responsive layout for mobile/desktop
- Consistent with existing leaderboard design

## Future Enhancements (Optional)
- [ ] Winner statistics dashboard
- [ ] Filter/search winners by date range
- [ ] Multiple winners per game (top 3)
- [ ] Winner badges in current leaderboard
- [ ] Export to CSV format
- [ ] Winner celebration animations
- [ ] Historical performance graphs

## Testing
1. Start a game and complete it
2. Use Auto-Archive to archive the top player
3. Verify winner appears in Previous Winners tab
4. Test Export/Import functionality
5. Test Remove winner functionality
6. Verify data persists after server restart

## Troubleshooting

### Winners not appearing?
- Check `previous-winners.json` exists in root directory
- Verify file permissions are correct
- Check browser console for API errors

### Archive button not working?
- Ensure there are players in current game
- Check that WebSocket connection is active
- Verify API endpoint is accessible

### Data loss after import?
- Import merges data, doesn't replace
- Check imported JSON structure matches spec
- Verify game_id uniqueness
