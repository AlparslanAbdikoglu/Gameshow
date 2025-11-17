import React from 'react';
import styles from './KimbillionaireControlPanel.module.css';
import { SlotMachineState } from '../types/gameTypes';

interface SlotMachinePanelProps {
  slotMachine?: SlotMachineState;
}

const SlotMachinePanel: React.FC<SlotMachinePanelProps> = ({ slotMachine }) => {
  if (!slotMachine) {
    return (
      <div className={styles.slotMachinePanel}>
        <div className={styles.slotMachineHeader}>
          <h2>Leo Slot Machine</h2>
          <span className={styles.slotMachineStatus}>Syncing…</span>
        </div>
        <p>Waiting for bridge server state.</p>
      </div>
    );
  }

  if (!slotMachine.enabled) {
    return (
      <div className={styles.slotMachinePanel}>
        <div className={styles.slotMachineHeader}>
          <h2>Leo Slot Machine</h2>
          <span className={styles.slotMachineStatus}>Disabled</span>
        </div>
        <p>Enable the slot machine bonus in bridge-server to show live status.</p>
      </div>
    );
  }

  const round = slotMachine.current_round;
  const statusLabel = round
    ? round.status.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())
    : 'Idle';
  const entryCount = round?.entries?.length || 0;
  const leverUser = round?.lever_candidate || slotMachine.last_round_result?.leverUser || '—';
  const upcoming = (slotMachine.schedule_questions || []).map((index) => index + 1);
  const countdownSeconds = round && round.entry_started_at
    ? Math.max(0, Math.ceil((round.entry_duration_ms - (Date.now() - round.entry_started_at)) / 1000))
    : null;
  const triggerEmoji = round?.trigger_emoji || slotMachine.trigger_emoji || '';
  const triggerEmojiUrl = round?.trigger_emoji_url || slotMachine.trigger_emoji_url || null;

  return (
    <div className={styles.slotMachinePanel}>
      <div className={styles.slotMachineHeader}>
        <h2>Leo Slot Machine</h2>
        <span className={styles.slotMachineStatus}>{statusLabel}</span>
      </div>
      <div className={styles.slotMachineGrid}>
        <div>
          <div className={styles.slotMachineLabel}>Entries</div>
          <div className={styles.slotMachineValue}>{entryCount}</div>
        </div>
        <div>
          <div className={styles.slotMachineLabel}>Lever Lion</div>
          <div className={styles.slotMachineValue}>{leverUser || '—'}</div>
        </div>
        <div>
          <div className={styles.slotMachineLabel}>Countdown</div>
          <div className={styles.slotMachineValue}>{countdownSeconds != null ? `${countdownSeconds}s` : '—'}</div>
        </div>
      </div>
      <div className={styles.slotMachineNote}>
        Next automatic windows: {upcoming.length ? upcoming.map((q) => `Q${q}`).join(', ') : '—'} · Trigger emote{' '}
        <span className={styles.slotMachineTriggerPreview}>
          {triggerEmojiUrl && triggerEmoji ? (
            <>
              <img
                src={triggerEmojiUrl}
                alt={triggerEmoji}
                className={styles.slotMachineTriggerImage}
              />
              {triggerEmoji}
            </>
          ) : (
            triggerEmoji || '—'
          )}
        </span>
      </div>
      {round?.entries?.length ? (
        <div className={styles.slotMachineEntries}>
          {round.entries.slice(0, 6).map((name) => (
            <span key={name}>{name}</span>
          ))}
          {round.entries.length > 6 && <span>+{round.entries.length - 6} more</span>}
        </div>
      ) : (
        <p className={styles.slotMachineNote}>Prompt chat to type JOIN before questions 5, 10, and 15.</p>
      )}
    </div>
  );
};

export default SlotMachinePanel;
