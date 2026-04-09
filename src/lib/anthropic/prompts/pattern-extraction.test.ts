import { describe, it, expect } from 'vitest';

import {
  buildPatternExtractionSystemPrompt,
  buildPatternExtractionUserPrompt,
  parsePatternExtractionResponse,
  type PatternExtractionContext,
  type FeedbackItem,
  type ExistingPattern,
} from './pattern-extraction';

describe('buildPatternExtractionSystemPrompt', () => {
  it('returns a string with required sections', () => {
    const prompt = buildPatternExtractionSystemPrompt();

    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes all pattern types', () => {
    const prompt = buildPatternExtractionSystemPrompt();

    expect(prompt).toContain('### voice');
    expect(prompt).toContain('### hook');
    expect(prompt).toContain('### topic');
    expect(prompt).toContain('### rejection');
    expect(prompt).toContain('### edit');
  });

  it('includes extraction rules', () => {
    const prompt = buildPatternExtractionSystemPrompt();

    expect(prompt).toContain('EXTRACTION RULES');
    expect(prompt).toContain('Minimum Evidence');
    expect(prompt).toContain('Specificity');
    expect(prompt).toContain('Edit Priority');
  });

  it('includes output format structure', () => {
    const prompt = buildPatternExtractionSystemPrompt();

    expect(prompt).toContain('OUTPUT FORMAT');
    expect(prompt).toContain('"patterns"');
    expect(prompt).toContain('"contradictions"');
    expect(prompt).toContain('"clarificationNeeded"');
  });

  it('includes confidence scoring guidelines', () => {
    const prompt = buildPatternExtractionSystemPrompt();

    expect(prompt).toContain('CONFIDENCE SCORING');
    expect(prompt).toContain('90-100');
    expect(prompt).toContain('>= 50');
  });

  it('includes contradiction detection section', () => {
    const prompt = buildPatternExtractionSystemPrompt();

    expect(prompt).toContain('CONTRADICTION DETECTION');
  });

  it('includes clarification request section', () => {
    const prompt = buildPatternExtractionSystemPrompt();

    expect(prompt).toContain('CLARIFICATION REQUESTS');
  });
});

describe('buildPatternExtractionUserPrompt', () => {
  it('formats empty context correctly', () => {
    const context: PatternExtractionContext = {
      feedbackItems: [],
      existingPatterns: [],
      voiceGuidelines: 'No guidelines yet.',
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('No existing patterns yet.');
    expect(prompt).toContain('No feedback items to analyze.');
    expect(prompt).toContain('No guidelines yet.');
  });

  it('formats single rejection feedback item', () => {
    const feedbackItem: FeedbackItem = {
      action: 'reject',
      category: 'tone',
      comment: 'Too formal for our audience',
      originalContent: 'The implementation demonstrates significant efficacy.',
    };

    const context: PatternExtractionContext = {
      feedbackItems: [feedbackItem],
      existingPatterns: [],
      voiceGuidelines: 'Be conversational.',
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('Action: REJECT');
    expect(prompt).toContain('Category: tone');
    expect(prompt).toContain('Comment: "Too formal for our audience"');
    expect(prompt).toContain('significant efficacy');
    expect(prompt).not.toContain('Edited to:');
  });

  it('formats edit feedback item with diff', () => {
    const feedbackItem: FeedbackItem = {
      action: 'edit',
      category: 'hook',
      comment: 'Made the opening more engaging',
      originalContent: 'AI is changing how we work.',
      editedContent: 'Your workflow is about to get 10x faster.',
    };

    const context: PatternExtractionContext = {
      feedbackItems: [feedbackItem],
      existingPatterns: [],
      voiceGuidelines: '',
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('Action: EDIT');
    expect(prompt).toContain('Category: hook');
    expect(prompt).toContain('AI is changing how we work.');
    expect(prompt).toContain('Edited to:');
    expect(prompt).toContain('10x faster');
  });

  it('formats multiple feedback items with separators', () => {
    const feedbackItems: FeedbackItem[] = [
      {
        action: 'reject',
        category: 'generic',
        comment: 'Too basic',
        originalContent: 'AI is cool.',
      },
      {
        action: 'reject',
        category: 'tone',
        comment: null,
        originalContent: 'Let me explain this.',
      },
    ];

    const context: PatternExtractionContext = {
      feedbackItems,
      existingPatterns: [],
      voiceGuidelines: '',
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('[1] Action: REJECT');
    expect(prompt).toContain('[2] Action: REJECT');
    expect(prompt).toContain('---');
  });

  it('formats existing patterns with type and evidence count', () => {
    const existingPatterns: ExistingPattern[] = [
      { type: 'voice', description: 'Use short sentences', evidenceCount: 5 },
      { type: 'hook', description: 'Start with a problem', evidenceCount: 3 },
    ];

    const context: PatternExtractionContext = {
      feedbackItems: [],
      existingPatterns,
      voiceGuidelines: '',
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('[voice] (evidence: 5) Use short sentences');
    expect(prompt).toContain('[hook] (evidence: 3) Start with a problem');
  });

  it('includes voice guidelines in prompt', () => {
    const guidelines = `## Voice Guidelines
- Be direct
- No corporate speak
- Use active voice`;

    const context: PatternExtractionContext = {
      feedbackItems: [],
      existingPatterns: [],
      voiceGuidelines: guidelines,
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('Be direct');
    expect(prompt).toContain('No corporate speak');
    expect(prompt).toContain('Use active voice');
  });

  it('handles null category and comment', () => {
    const feedbackItem: FeedbackItem = {
      action: 'reject',
      category: null,
      comment: null,
      originalContent: 'Some content',
    };

    const context: PatternExtractionContext = {
      feedbackItems: [feedbackItem],
      existingPatterns: [],
      voiceGuidelines: '',
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('Action: REJECT');
    expect(prompt).not.toContain('Category:');
    expect(prompt).not.toContain('Comment:');
  });

  it('includes instructions for extraction', () => {
    const context: PatternExtractionContext = {
      feedbackItems: [],
      existingPatterns: [],
      voiceGuidelines: '',
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('Extract:');
    expect(prompt).toContain('New patterns');
    expect(prompt).toContain('reinforce existing');
    expect(prompt).toContain('contradictions');
    expect(prompt).toContain('clarification');
    expect(prompt).toContain('JSON');
  });
});

describe('parsePatternExtractionResponse', () => {
  it('parses valid JSON response', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Avoid starting with 'So,'",
          "confidence": 85,
          "evidence": ["feedback 1", "feedback 2"],
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0].type).toBe('voice');
    expect(result.patterns[0].description).toBe("Avoid starting with 'So,'");
    expect(result.patterns[0].confidence).toBe(85);
    expect(result.patterns[0].evidence).toEqual(['feedback 1', 'feedback 2']);
    expect(result.patterns[0].isNew).toBe(true);
  });

  it('parses JSON embedded in text', () => {
    const response = `Here's my analysis:

{
  "patterns": [
    {
      "type": "hook",
      "description": "Start with a problem statement",
      "confidence": 75,
      "evidence": ["ex1"],
      "isNew": true
    }
  ],
  "contradictions": [],
  "clarificationNeeded": []
}

That's my analysis.`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0].type).toBe('hook');
  });

  it('filters out patterns below confidence threshold', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Strong pattern",
          "confidence": 80,
          "evidence": ["e1", "e2"],
          "isNew": true
        },
        {
          "type": "hook",
          "description": "Weak pattern",
          "confidence": 40,
          "evidence": ["e1"],
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0].description).toBe('Strong pattern');
  });

  it('filters out patterns with invalid type', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Valid pattern",
          "confidence": 80,
          "evidence": ["e1"],
          "isNew": true
        },
        {
          "type": "invalid_type",
          "description": "Invalid pattern",
          "confidence": 90,
          "evidence": ["e1"],
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0].type).toBe('voice');
  });

  it('clamps confidence to 50-100 range', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Over 100 confidence",
          "confidence": 150,
          "evidence": ["e1"],
          "isNew": true
        },
        {
          "type": "hook",
          "description": "Exactly 50 confidence",
          "confidence": 50,
          "evidence": ["e1"],
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].confidence).toBe(100);
    expect(result.patterns[1].confidence).toBe(50);
  });

  it('rounds confidence to integer', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Decimal confidence",
          "confidence": 75.7,
          "evidence": ["e1"],
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].confidence).toBe(76);
  });

  it('defaults isNew to true when missing', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Missing isNew",
          "confidence": 80,
          "evidence": ["e1"]
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].isNew).toBe(true);
  });

  it('handles empty evidence array', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "No evidence",
          "confidence": 80,
          "evidence": [],
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].evidence).toEqual([]);
  });

  it('handles non-array evidence by converting to empty array', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Invalid evidence",
          "confidence": 80,
          "evidence": "not an array",
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].evidence).toEqual([]);
  });

  it('parses contradictions correctly', () => {
    const response = `{
      "patterns": [],
      "contradictions": [
        {
          "patternA": "Use short sentences",
          "patternB": "Be detailed and thorough",
          "explanation": "These preferences conflict on brevity vs detail"
        }
      ],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.contradictions.length).toBe(1);
    expect(result.contradictions[0].patternA).toBe('Use short sentences');
    expect(result.contradictions[0].patternB).toBe('Be detailed and thorough');
    expect(result.contradictions[0].explanation).toContain('brevity');
  });

  it('parses clarification requests correctly', () => {
    const response = `{
      "patterns": [],
      "contradictions": [],
      "clarificationNeeded": [
        {
          "question": "Should posts be formal or casual?",
          "context": "Mixed feedback on tone formality",
          "options": ["Formal", "Casual", "Context-dependent"]
        }
      ]
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.clarificationNeeded.length).toBe(1);
    expect(result.clarificationNeeded[0].question).toBe('Should posts be formal or casual?');
    expect(result.clarificationNeeded[0].context).toContain('Mixed feedback');
    expect(result.clarificationNeeded[0].options).toEqual([
      'Formal',
      'Casual',
      'Context-dependent',
    ]);
  });

  it('handles missing contradictions array', () => {
    const response = `{
      "patterns": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.contradictions).toEqual([]);
  });

  it('handles missing clarificationNeeded array', () => {
    const response = `{
      "patterns": [],
      "contradictions": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.clarificationNeeded).toEqual([]);
  });

  it('handles non-array options in clarification by converting to empty array', () => {
    const response = `{
      "patterns": [],
      "contradictions": [],
      "clarificationNeeded": [
        {
          "question": "Test question",
          "context": "Test context",
          "options": "not an array"
        }
      ]
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.clarificationNeeded[0].options).toEqual([]);
  });

  it('throws error when no JSON found', () => {
    const response = 'This is just plain text with no JSON.';

    expect(() => parsePatternExtractionResponse(response)).toThrow(
      'Failed to parse pattern extraction response: no JSON found'
    );
  });

  it('throws error when patterns is not an array', () => {
    const response = `{
      "patterns": "not an array",
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    expect(() => parsePatternExtractionResponse(response)).toThrow(
      'Invalid pattern extraction response: patterns must be an array'
    );
  });

  it('throws error for malformed JSON', () => {
    const response = '{ "patterns": [ malformed }';

    expect(() => parsePatternExtractionResponse(response)).toThrow();
  });

  it('handles relatedExistingId when present', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Reinforcing existing pattern",
          "confidence": 85,
          "evidence": ["e1"],
          "isNew": false,
          "relatedExistingId": 42
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].isNew).toBe(false);
    expect(result.patterns[0].relatedExistingId).toBe(42);
  });

  it('handles null relatedExistingId', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "New pattern",
          "confidence": 85,
          "evidence": ["e1"],
          "isNew": true,
          "relatedExistingId": null
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].relatedExistingId).toBeUndefined();
  });

  it('parses all valid pattern types', () => {
    const response = `{
      "patterns": [
        { "type": "voice", "description": "Voice pattern", "confidence": 80, "evidence": [], "isNew": true },
        { "type": "hook", "description": "Hook pattern", "confidence": 80, "evidence": [], "isNew": true },
        { "type": "topic", "description": "Topic pattern", "confidence": 80, "evidence": [], "isNew": true },
        { "type": "rejection", "description": "Rejection pattern", "confidence": 80, "evidence": [], "isNew": true },
        { "type": "edit", "description": "Edit pattern", "confidence": 80, "evidence": [], "isNew": true }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns.length).toBe(5);
    expect(result.patterns.map((p) => p.type)).toEqual([
      'voice',
      'hook',
      'topic',
      'rejection',
      'edit',
    ]);
  });

  it('handles complex real-world response', () => {
    const response = `Based on my analysis of the feedback, here's what I found:

{
  "patterns": [
    {
      "type": "voice",
      "description": "Avoid starting sentences with filler words like 'So,' or 'Well,'",
      "confidence": 88,
      "evidence": ["feedback 1: removed 'So,' from opening", "feedback 3: edited out 'Well,' starter"],
      "isNew": true
    },
    {
      "type": "hook",
      "description": "Start with a specific problem or pain point, not a general statement",
      "confidence": 75,
      "evidence": ["feedback 2: changed generic opener to problem statement", "feedback 4: similar edit"],
      "isNew": true
    },
    {
      "type": "edit",
      "description": "Replace multi-clause sentences with shorter, punchier ones",
      "confidence": 92,
      "evidence": ["feedback 1", "feedback 2", "feedback 5"],
      "isNew": true
    }
  ],
  "contradictions": [
    {
      "patternA": "Use detailed technical explanations",
      "patternB": "Keep explanations brief and high-level",
      "explanation": "Feedback items 2 and 5 suggest opposite preferences for technical depth"
    }
  ],
  "clarificationNeeded": [
    {
      "question": "What level of technical detail should posts include?",
      "context": "Some feedback suggests more technical depth while others prefer simpler explanations",
      "options": ["High technical detail", "Surface-level explanations", "Depends on the topic"]
    }
  ]
}

These patterns should help improve future content generation.`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns.length).toBe(3);
    expect(result.patterns[0].description).toContain('filler words');
    expect(result.patterns[1].description).toContain('problem or pain point');
    expect(result.patterns[2].description).toContain('shorter, punchier');

    expect(result.contradictions.length).toBe(1);
    expect(result.contradictions[0].explanation).toContain('opposite preferences');

    expect(result.clarificationNeeded.length).toBe(1);
    expect(result.clarificationNeeded[0].options.length).toBe(3);
  });

  it('handles empty response arrays gracefully', () => {
    const response = `{
      "patterns": [],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns).toEqual([]);
    expect(result.contradictions).toEqual([]);
    expect(result.clarificationNeeded).toEqual([]);
  });

  it('handles multiple contradictions and clarifications', () => {
    const response = `{
      "patterns": [],
      "contradictions": [
        { "patternA": "A1", "patternB": "B1", "explanation": "E1" },
        { "patternA": "A2", "patternB": "B2", "explanation": "E2" }
      ],
      "clarificationNeeded": [
        { "question": "Q1", "context": "C1", "options": ["O1"] },
        { "question": "Q2", "context": "C2", "options": ["O2", "O3"] }
      ]
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.contradictions.length).toBe(2);
    expect(result.clarificationNeeded.length).toBe(2);
  });
});

describe('edge cases', () => {
  it('handles unicode in pattern descriptions', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Avoid emoji overuse 🎉 and special chars: café, naïve",
          "confidence": 80,
          "evidence": [],
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].description).toContain('🎉');
    expect(result.patterns[0].description).toContain('café');
  });

  it('handles very long descriptions', () => {
    const longDesc = 'A'.repeat(500);
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "${longDesc}",
          "confidence": 80,
          "evidence": [],
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].description.length).toBe(500);
  });

  it('handles special characters in descriptions', () => {
    const response = `{
      "patterns": [
        {
          "type": "voice",
          "description": "Avoid quotes like \\"this\\" and apostrophes like it's",
          "confidence": 80,
          "evidence": [],
          "isNew": true
        }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns[0].description).toContain('"this"');
    expect(result.patterns[0].description).toContain("it's");
  });

  it('handles exactly 50 confidence threshold', () => {
    const response = `{
      "patterns": [
        { "type": "voice", "description": "Exactly 50", "confidence": 50, "evidence": [], "isNew": true },
        { "type": "hook", "description": "Just under 50", "confidence": 49, "evidence": [], "isNew": true }
      ],
      "contradictions": [],
      "clarificationNeeded": []
    }`;

    const result = parsePatternExtractionResponse(response);

    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0].description).toBe('Exactly 50');
  });

  it('handles feedback with newlines in content', () => {
    const feedbackItem: FeedbackItem = {
      action: 'reject',
      category: 'tone',
      comment: 'Too long\nand formal',
      originalContent: 'Line one.\nLine two.\nLine three.',
    };

    const context: PatternExtractionContext = {
      feedbackItems: [feedbackItem],
      existingPatterns: [],
      voiceGuidelines: '',
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('Line one.');
    expect(prompt).toContain('Line two.');
    expect(prompt).toContain('Line three.');
  });

  it('handles empty strings in feedback', () => {
    const feedbackItem: FeedbackItem = {
      action: 'reject',
      category: 'generic',
      comment: '',
      originalContent: '',
    };

    const context: PatternExtractionContext = {
      feedbackItems: [feedbackItem],
      existingPatterns: [],
      voiceGuidelines: '',
    };

    const prompt = buildPatternExtractionUserPrompt(context);

    expect(prompt).toContain('[1] Action: REJECT');
  });
});
