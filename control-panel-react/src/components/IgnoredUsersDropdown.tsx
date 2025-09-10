import React, { useState, useEffect } from 'react';
import './IgnoredUsersDropdown.css';

interface IgnoredUsersDropdownProps {
  ws: WebSocket | null;
}

const IgnoredUsersDropdown: React.FC<IgnoredUsersDropdownProps> = ({ ws }) => {
  const [ignoredUsers, setIgnoredUsers] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [newUser, setNewUser] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchIgnoredUsers();
  }, []);

  useEffect(() => {
    if (ws) {
      const handleWebSocketMessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'ignored_list_updated') {
            setIgnoredUsers(message.ignoredList || []);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.addEventListener('message', handleWebSocketMessage);
      return () => ws.removeEventListener('message', handleWebSocketMessage);
    }
  }, [ws]);

  const fetchIgnoredUsers = async () => {
    try {
      const response = await fetch('http://localhost:8081/api/ignored-users-list');
      const data = await response.json();
      setIgnoredUsers(data.ignoredList || []);
    } catch (error) {
      console.error('Error fetching ignored users:', error);
    }
  };

  const addUser = async () => {
    if (!newUser.trim()) return;
    
    const updatedList = [...ignoredUsers, newUser.trim().toLowerCase()];
    await updateIgnoredUsers(updatedList);
    setNewUser('');
  };

  const removeUser = async (user: string) => {
    const updatedList = ignoredUsers.filter(u => u !== user);
    await updateIgnoredUsers(updatedList);
  };

  const updateIgnoredUsers = async (list: string[]) => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8081/api/ignored-users-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignoredList: list })
      });
      
      if (response.ok) {
        const data = await response.json();
        setIgnoredUsers(data.ignoredList);
      }
    } catch (error) {
      console.error('Error updating ignored users:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ignored-users-dropdown">
      <button 
        className="ignored-users-btn"
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
      >
        🚫 Ignored ({ignoredUsers.length})
      </button>
      
      {isOpen && (
        <div className="dropdown-content">
          <div className="dropdown-header">
            <h4>Ignored Users (Hidden from Leaderboard)</h4>
            <button className="close-btn" onClick={() => setIsOpen(false)}>×</button>
          </div>
          
          <div className="add-user-section">
            <input
              type="text"
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addUser()}
              placeholder="Username to ignore (e.g., bot name)"
            />
            <button onClick={addUser} disabled={!newUser.trim() || loading}>
              Add
            </button>
          </div>
          
          <div className="users-list">
            {ignoredUsers.length === 0 ? (
              <div className="empty-message">No ignored users</div>
            ) : (
              ignoredUsers.map(user => (
                <div key={user} className="user-item">
                  <span>{user}</span>
                  <button 
                    className="remove-btn"
                    onClick={() => removeUser(user)}
                    disabled={loading}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default IgnoredUsersDropdown;