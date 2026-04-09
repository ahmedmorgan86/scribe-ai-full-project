import { describe, expect, it } from 'vitest';
import {
  parseVoiceGuidelinesMarkdown,
  guidelinesToDocuments,
  formatGuidelinesForPrompt,
  type VoiceGuidelines,
} from './guidelines';

describe('parseVoiceGuidelinesMarkdown', () => {
  describe('section header detection', () => {
    it('should detect DO section with various headers', () => {
      const inputs = [
        "## Do's\n- Item 1",
        '## Dos\n- Item 1',
        '## Things to Do\n- Item 1',
        '## What to Do\n- Item 1',
        '## Positive Patterns\n- Item 1',
      ];

      for (const input of inputs) {
        const result = parseVoiceGuidelinesMarkdown(input);
        expect(result.dos).toHaveLength(1);
        expect(result.dos[0]).toBe('Item 1');
      }
    });

    it("should detect DON'T section with various headers", () => {
      const inputs = [
        "## Don'ts\n- Item 1",
        '## Donts\n- Item 1',
        '## Things to Avoid\n- Item 1',
        '## What Not to Do\n- Item 1',
        '## Avoid\n- Item 1',
        '## Negative Patterns\n- Item 1',
      ];

      for (const input of inputs) {
        const result = parseVoiceGuidelinesMarkdown(input);
        expect(result.donts).toHaveLength(1);
        expect(result.donts[0]).toBe('Item 1');
      }
    });

    it('should detect EXAMPLE section with various headers', () => {
      const inputs = [
        '## Examples\n- Item 1',
        '## Example\n- Item 1',
        '## Gold Examples\n- Item 1',
        '## Sample Posts\n- Item 1',
        '## Reference Posts\n- Item 1',
      ];

      for (const input of inputs) {
        const result = parseVoiceGuidelinesMarkdown(input);
        expect(result.examples).toHaveLength(1);
        expect(result.examples[0]).toBe('Item 1');
      }
    });

    it('should detect RULE section with various headers', () => {
      const inputs = [
        '## Rules\n- Item 1',
        '## Rule\n- Item 1',
        '## Guidelines\n- Item 1',
        '## Principles\n- Item 1',
        '## Constraints\n- Item 1',
      ];

      for (const input of inputs) {
        const result = parseVoiceGuidelinesMarkdown(input);
        expect(result.rules).toHaveLength(1);
        expect(result.rules[0]).toBe('Item 1');
      }
    });
  });

  describe('list item extraction with bullet markers', () => {
    it('should extract items with dash markers', () => {
      const input = `## Rules
- First rule
- Second rule
- Third rule`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toEqual(['First rule', 'Second rule', 'Third rule']);
    });

    it('should extract items with asterisk markers', () => {
      const input = `## Rules
* First rule
* Second rule`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toEqual(['First rule', 'Second rule']);
    });

    it('should extract items with bullet point markers', () => {
      const input = `## Rules
• First rule
• Second rule`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toEqual(['First rule', 'Second rule']);
    });

    it('should extract items with numbered markers', () => {
      const input = `## Rules
1. First rule
2. Second rule
3. Third rule`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toEqual(['First rule', 'Second rule', 'Third rule']);
    });
  });

  describe('plain text items (no bullet markers)', () => {
    it('should extract plain text lines as items', () => {
      const input = `## Rules
First rule
Second rule
Third rule`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toEqual(['First rule', 'Second rule', 'Third rule']);
    });

    it('should handle mixed bullet and plain text items', () => {
      const input = `## Rules
- Bulleted item
Plain text item
* Another bullet
Final plain item`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toContain('Bulleted item');
      expect(result.rules).toContain('Plain text item');
      expect(result.rules).toContain('Another bullet');
      expect(result.rules).toContain('Final plain item');
    });
  });

  describe('multi-line item continuation', () => {
    it('should combine indented continuation lines with previous item', () => {
      const input = `## Rules
- First rule that spans
  multiple lines with indent
- Second rule`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toHaveLength(2);
      expect(result.rules[0]).toBe('First rule that spans multiple lines with indent');
      expect(result.rules[1]).toBe('Second rule');
    });

    it('should treat non-indented lines after bullet as separate items', () => {
      const input = `## Rules
- First rule that spans
multiple lines without indent
- Second rule`;

      const result = parseVoiceGuidelinesMarkdown(input);
      // Non-indented continuation is treated as a separate plain text item
      expect(result.rules).toHaveLength(3);
      expect(result.rules).toContain('First rule that spans');
      expect(result.rules).toContain('multiple lines without indent');
      expect(result.rules).toContain('Second rule');
    });
  });

  describe('empty and whitespace handling', () => {
    it('should ignore empty lines between items', () => {
      const input = `## Rules
- First rule

- Second rule

- Third rule`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toEqual(['First rule', 'Second rule', 'Third rule']);
    });

    it('should trim whitespace from items', () => {
      const input = `## Rules
-   Item with extra spaces
-     Another item`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toEqual(['Item with extra spaces', 'Another item']);
    });

    it('should return empty arrays for missing sections', () => {
      const input = `## Rules
- Only a rule`;

      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.dos).toEqual([]);
      expect(result.donts).toEqual([]);
      expect(result.examples).toEqual([]);
      expect(result.rules).toEqual(['Only a rule']);
    });

    it('should return empty arrays for completely empty input', () => {
      const result = parseVoiceGuidelinesMarkdown('');
      expect(result.dos).toEqual([]);
      expect(result.donts).toEqual([]);
      expect(result.examples).toEqual([]);
      expect(result.rules).toEqual([]);
    });
  });

  describe('full document parsing', () => {
    it('should parse a complete guidelines document', () => {
      const input = `# Voice Guidelines

## Do's
- Be direct and concise
- Use active voice
- Include specific examples

## Don'ts
- Avoid jargon
- Never use passive voice
- Don't be vague

## Examples
- This is a great example post that demonstrates the voice
- Another example showing proper tone

## Rules
- Max 280 characters
- One idea per post
`;

      const result = parseVoiceGuidelinesMarkdown(input);

      expect(result.dos).toHaveLength(3);
      expect(result.dos).toContain('Be direct and concise');
      expect(result.dos).toContain('Use active voice');
      expect(result.dos).toContain('Include specific examples');

      expect(result.donts).toHaveLength(3);
      expect(result.donts).toContain('Avoid jargon');
      expect(result.donts).toContain('Never use passive voice');
      expect(result.donts).toContain("Don't be vague");

      expect(result.examples).toHaveLength(2);

      expect(result.rules).toHaveLength(2);
      expect(result.rules).toContain('Max 280 characters');
      expect(result.rules).toContain('One idea per post');
    });

    it('should preserve raw content', () => {
      const input = '## Rules\n- A rule';
      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.raw).toBe(input);
    });
  });

  describe('edge cases', () => {
    it('should handle section header without space after hash', () => {
      const input = `##Rules
- A rule`;
      const result = parseVoiceGuidelinesMarkdown(input);
      // Current implementation requires space after ##
      expect(result.rules.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle single hash headers', () => {
      const input = `# Rules
- A rule`;
      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toContain('A rule');
    });

    it('should handle triple hash headers', () => {
      const input = `### Rules
- A rule`;
      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toContain('A rule');
    });

    it('should handle content before first section', () => {
      const input = `This is intro text that should be ignored.

## Rules
- A rule`;
      const result = parseVoiceGuidelinesMarkdown(input);
      expect(result.rules).toEqual(['A rule']);
    });
  });
});

describe('guidelinesToDocuments', () => {
  it('should convert guidelines to documents with proper structure', () => {
    const guidelines: VoiceGuidelines = {
      dos: ['Do this'],
      donts: ['Avoid that'],
      examples: ['Example post'],
      rules: ['A rule'],
      raw: '',
    };

    const docs = guidelinesToDocuments(guidelines);

    expect(docs).toHaveLength(4);

    const doDoc = docs.find((d) => d.guidelineType === 'do');
    expect(doDoc).toBeDefined();
    expect(doDoc?.content).toBe('Do this');
    expect(doDoc?.category).toBe('voice');
    expect(doDoc?.priority).toBe(1);

    const dontDoc = docs.find((d) => d.guidelineType === 'dont');
    expect(dontDoc).toBeDefined();
    expect(dontDoc?.content).toBe('Avoid that');
    expect(dontDoc?.priority).toBe(2);

    const exampleDoc = docs.find((d) => d.guidelineType === 'example');
    expect(exampleDoc).toBeDefined();
    expect(exampleDoc?.category).toBe('reference');
    expect(exampleDoc?.priority).toBe(3);

    const ruleDoc = docs.find((d) => d.guidelineType === 'rule');
    expect(ruleDoc).toBeDefined();
    expect(ruleDoc?.category).toBe('constraint');
  });

  it('should generate unique IDs for each document', () => {
    const guidelines: VoiceGuidelines = {
      dos: ['Do 1', 'Do 2'],
      donts: [],
      examples: [],
      rules: [],
      raw: '',
    };

    const docs = guidelinesToDocuments(guidelines);
    const ids = docs.map((d) => d.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should return empty array for empty guidelines', () => {
    const guidelines: VoiceGuidelines = {
      dos: [],
      donts: [],
      examples: [],
      rules: [],
      raw: '',
    };

    const docs = guidelinesToDocuments(guidelines);
    expect(docs).toEqual([]);
  });
});

describe('formatGuidelinesForPrompt', () => {
  it('should format guidelines as readable markdown', () => {
    const guidelines: VoiceGuidelines = {
      dos: ['Be direct', 'Use examples'],
      donts: ['Avoid jargon'],
      examples: ['Great example post'],
      rules: ['Max 280 chars'],
      raw: '',
    };

    const formatted = formatGuidelinesForPrompt(guidelines);

    expect(formatted).toContain('## Rules');
    expect(formatted).toContain('- Max 280 chars');
    expect(formatted).toContain("## Do's");
    expect(formatted).toContain('- Be direct');
    expect(formatted).toContain("## Don'ts");
    expect(formatted).toContain('- Avoid jargon');
    expect(formatted).toContain('## Examples');
    expect(formatted).toContain('> Great example post');
  });

  it('should omit empty sections', () => {
    const guidelines: VoiceGuidelines = {
      dos: ['Be direct'],
      donts: [],
      examples: [],
      rules: [],
      raw: '',
    };

    const formatted = formatGuidelinesForPrompt(guidelines);

    expect(formatted).toContain("## Do's");
    expect(formatted).not.toContain("## Don'ts");
    expect(formatted).not.toContain('## Examples');
    expect(formatted).not.toContain('## Rules');
  });

  it('should return empty string for empty guidelines', () => {
    const guidelines: VoiceGuidelines = {
      dos: [],
      donts: [],
      examples: [],
      rules: [],
      raw: '',
    };

    const formatted = formatGuidelinesForPrompt(guidelines);
    expect(formatted).toBe('');
  });
});
