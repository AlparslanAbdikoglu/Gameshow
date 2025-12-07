import { parseHotSeatProfilesFile } from '../hotSeatProfiles';

describe('parseHotSeatProfilesFile', () => {
  it('parses markdown headings into profile entries', () => {
    const markdown = `
## KimPossible | Kim Possible
World class cheerleader turned hero.

## ron-stoppable
- Loyal sidekick
- Nacho enthusiast
`;

    const result = parseHotSeatProfilesFile(markdown, 'profiles.md');

    expect(result.format).toBe('markdown');
    expect(Object.keys(result.profiles)).toHaveLength(2);
    expect(result.profiles['kimpossible']).toMatchObject({
      username: 'KimPossible',
      displayName: 'Kim Possible'
    });
    expect(result.profiles['ron-stoppable'].storyHtml).toContain('<ul>');
  });

  it('parses json maps keyed by username', () => {
    const json = JSON.stringify({
      Kimba: {
        displayName: 'Kimba the White Lion',
        story: 'Defender of the jungle.'
      },
      '@Roary': 'The hype expert for every show.'
    });

    const result = parseHotSeatProfilesFile(json, 'hotseat.json');

    expect(result.format).toBe('json');
    expect(result.profiles['kimba']).toBeDefined();
    expect(result.profiles['kimba']?.displayName).toBe('Kimba the White Lion');
    expect(result.profiles['roary']?.storyHtml).toContain('<p>');
  });

  it('parses json arrays of profile objects', () => {
    const json = JSON.stringify([
      {
        username: 'lionheart',
        displayName: 'Lion Heart',
        story: 'Always ready to roar.'
      },
      {
        id: 'mystery',
        storyHtml: '<p>The enigma of the savannah.</p>'
      }
    ]);

    const result = parseHotSeatProfilesFile(json);

    expect(result.format).toBe('json');
    expect(Object.keys(result.profiles)).toHaveLength(2);
    expect(result.profiles['lionheart']?.storyHtml).toContain('roar');
    expect(result.profiles['mystery']?.storyHtml).toContain('savannah');
  });

  it('returns a helpful error when the file is empty', () => {
    const result = parseHotSeatProfilesFile('   ');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.profiles).toEqual({});
  });
});
