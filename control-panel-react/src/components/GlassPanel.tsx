import React from 'react';
import styles from './KimbillionaireControlPanel.module.css';

interface GlassPanelProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  isLocked?: boolean;
  onTitleClick?: () => void;
}

/**
 * Reusable glass morphism panel component with professional broadcast styling
 * Optimized with React.memo for performance in high-frequency re-renders
 */
const GlassPanel: React.FC<GlassPanelProps> = React.memo(({
  children,
  title,
  className = '',
  style = {},
  isLocked = false,
  onTitleClick
}) => {
  const panelClasses = `${styles.controlSection} ${isLocked ? styles.lockedSection : ''} ${className}`;

  return (
    <div className={panelClasses} style={style}>
      {title && (
        <h2 
          onClick={onTitleClick}
          style={{ 
            cursor: onTitleClick ? 'pointer' : 'default',
            ...(isLocked && { color: '#FF6B35' })
          }}
        >
          {title}
          {isLocked && <span style={{color: '#FF6B35', marginLeft: '8px'}}>🔒 LOCKED IN</span>}
        </h2>
      )}
      {children}
    </div>
  );
});

GlassPanel.displayName = 'GlassPanel';

export default GlassPanel;