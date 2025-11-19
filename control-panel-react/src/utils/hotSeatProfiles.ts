export interface HotSeatProfileData {
  username: string;
  displayName: string;
  storyHtml?: string;
  storyText?: string;
  lastUpdated?: number;
}

export type HotSeatProfileFileFormat = 'markdown' | 'json';

export interface HotSeatProfileParseResult {
  profiles: Record<string, HotSeatProfileData>;
  errors: string[];
  format: HotSeatProfileFileFormat;
}

const applyInlineProfileFormatting = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(?<!\\)\*(?!\s)([^*]+?)\*(?!\s)/g, '<em>$1</em>')
    .replace(/_(?!\s)([^_]+?)_(?!\s)/g, '<em>$1</em>');

export const escapeProfileHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const stripAtPrefix = (value: string) => value.replace(/^@+/, '');

const normalizeProfileKey = (value: string) => {
  if (!value) {
    return '';
  }

  return stripAtPrefix(value.trim()).toLowerCase();
};

export const convertProfileStoryToHtml = (raw: string) => {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { html: '', text: '' };
  }

  const blocks = trimmed.split(/\n{2,}/);
  const htmlBlocks = blocks
    .map((block) => {
      const lines = block
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        return '';
      }

      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        const items = lines
          .map((line) => line.replace(/^[-*]\s+/, ''))
          .map((line) => `<li>${applyInlineProfileFormatting(escapeProfileHtml(line))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }

      const paragraph = lines.join(' ');
      return `<p>${applyInlineProfileFormatting(escapeProfileHtml(paragraph))}</p>`;
    })
    .filter(Boolean)
    .join('');

  return {
    html: htmlBlocks,
    text: trimmed
  };
};

const createProfileEntry = (
  profiles: Record<string, HotSeatProfileData>,
  errors: string[],
  contextLabel: string,
  identifier: string | null,
  displayNameValue: string | null,
  storySource: string,
  providedHtml?: string,
  providedText?: string
) => {
  const normalized = identifier ? normalizeProfileKey(identifier) : '';
  if (!normalized) {
    errors.push(`${contextLabel}: missing username.`);
    return;
  }

  const cleanedUsername = stripAtPrefix((identifier || '').trim());
  const displayName = (displayNameValue || identifier || '').trim() || cleanedUsername;

  let storyHtml = '';
  let storyText = '';

  if (providedHtml && providedHtml.trim().length > 0) {
    storyHtml = providedHtml.trim();
    storyText = providedText && providedText.trim().length > 0
      ? providedText.trim()
      : storySource && storySource.trim().length > 0
        ? storySource.trim()
        : storyHtml
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
  } else {
    const { html, text } = convertProfileStoryToHtml(storySource || '');
    storyHtml = html;
    storyText = text;
  }

  profiles[normalized] = {
    username: cleanedUsername,
    displayName,
    storyHtml,
    storyText,
    lastUpdated: Date.now()
  };
};

export const parseHotSeatProfilesMarkdown = (markdown: string): HotSeatProfileParseResult => {
  const lines = markdown.split(/\r?\n/);
  const profiles: Record<string, HotSeatProfileData> = {};
  const errors: string[] = [];

  let currentIdentifier: string | null = null;
  let currentDisplayName: string | null = null;
  let buffer: string[] = [];

  const flushCurrent = () => {
    if (!currentIdentifier) {
      buffer = [];
      return;
    }

    const storyRaw = buffer.join('\n');
    createProfileEntry(
      profiles,
      errors,
      `Profile for ${currentIdentifier}`,
      currentIdentifier,
      currentDisplayName,
      storyRaw
    );

    buffer = [];
    currentIdentifier = null;
    currentDisplayName = null;
  };

  lines.forEach((line, index) => {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      flushCurrent();

      let headingText = headingMatch[1].trim();
      if (!headingText) {
        errors.push(`Line ${index + 1}: heading is missing a username.`);
        return;
      }

      let usernamePart = headingText;
      let displayNamePart = headingText;

      if (headingText.includes('|')) {
        const [userSegment, displaySegment] = headingText.split('|');
        usernamePart = userSegment.trim();
        displayNamePart = (displaySegment || userSegment).trim();
      }

      currentIdentifier = usernamePart;
      currentDisplayName = displayNamePart;
      return;
    }

    if (!currentIdentifier && line.trim().length > 0) {
      errors.push(`Line ${index + 1}: content found before any profile heading. Use "## username" to start a profile.`);
      return;
    }

    buffer.push(line);
  });

  flushCurrent();

  if (Object.keys(profiles).length === 0 && errors.length === 0) {
    errors.push('No profiles were found in the markdown file. Use headings like "## username | Display Name".');
  }

  return { profiles, errors, format: 'markdown' };
};

export const parseHotSeatProfilesJson = (jsonText: string): HotSeatProfileParseResult => {
  const profiles: Record<string, HotSeatProfileData> = {};
  const errors: string[] = [];

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    errors.push(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { profiles, errors, format: 'json' };
  }

  const processEntry = (entry: any, contextLabel: string, fallbackKey?: string) => {
    if (entry === null || entry === undefined) {
      errors.push(`${contextLabel}: entry is empty.`);
      return;
    }

    if (typeof entry === 'string') {
      createProfileEntry(profiles, errors, contextLabel, fallbackKey || null, null, entry);
      return;
    }

    if (typeof entry !== 'object') {
      errors.push(`${contextLabel}: entry must be an object or string.`);
      return;
    }

    const usernameCandidate =
      typeof entry.username === 'string' && entry.username.trim().length > 0
        ? entry.username.trim()
        : typeof entry.id === 'string' && entry.id.trim().length > 0
          ? entry.id.trim()
          : typeof fallbackKey === 'string'
            ? fallbackKey
            : typeof entry.name === 'string'
              ? entry.name.trim()
              : '';

    const displayNameCandidate =
      typeof entry.displayName === 'string' && entry.displayName.trim().length > 0
        ? entry.displayName.trim()
        : typeof entry.name === 'string' && entry.name.trim().length > 0
          ? entry.name.trim()
          : usernameCandidate;

    const storySource =
      typeof entry.story === 'string' && entry.story.trim().length > 0
        ? entry.story
        : typeof entry.storyText === 'string' && entry.storyText.trim().length > 0
          ? entry.storyText
          : '';

    createProfileEntry(
      profiles,
      errors,
      contextLabel,
      usernameCandidate,
      displayNameCandidate,
      storySource,
      typeof entry.storyHtml === 'string' ? entry.storyHtml : undefined,
      typeof entry.storyText === 'string' ? entry.storyText : undefined
    );
  };

  if (Array.isArray(parsed)) {
    parsed.forEach((entry, index) => processEntry(entry, `Entry ${index + 1}`));
  } else if (parsed && typeof parsed === 'object') {
    Object.entries(parsed).forEach(([key, value]) => {
      processEntry(value, `Key "${key}"`, key);
    });
  } else {
    errors.push('JSON root must be an object or array.');
  }

  if (Object.keys(profiles).length === 0 && errors.length === 0) {
    errors.push('No profiles were found in the JSON file.');
  }

  return { profiles, errors, format: 'json' };
};

const looksLikeJson = (fileName?: string | null, contents?: string) => {
  if (fileName && fileName.toLowerCase().endsWith('.json')) {
    return true;
  }

  const trimmed = (contents || '').trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

export const parseHotSeatProfilesFile = (contents: string, fileName?: string | null): HotSeatProfileParseResult => {
  const trimmed = (contents || '').trim();
  if (!trimmed) {
    return {
      profiles: {},
      errors: ['The selected file is empty. Add at least one profile before uploading.'],
      format: looksLikeJson(fileName, contents) ? 'json' : 'markdown'
    };
  }

  if (looksLikeJson(fileName, contents)) {
    return parseHotSeatProfilesJson(trimmed);
  }

  return parseHotSeatProfilesMarkdown(contents);
};

