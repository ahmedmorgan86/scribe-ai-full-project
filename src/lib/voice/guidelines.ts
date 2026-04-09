import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { QDRANT_COLLECTION_NAMES, collectionExists } from '@/db/qdrant/connection';
import { countDocuments, addDocumentsBatch, deleteByFilter } from '@/db/qdrant/embeddings';
import { generateEmbeddingsBatch } from '@/lib/embeddings/service';
import { createLogger } from '@/lib/logger';

const logger = createLogger('voice:guidelines');

export type VoiceGuidelineType = 'do' | 'dont' | 'example' | 'rule';

export interface VoiceGuidelineDocument {
  id: string;
  content: string;
  guidelineType: VoiceGuidelineType;
  category?: string;
  priority?: number;
  createdAt: string;
}

export interface VoiceGuidelines {
  dos: string[];
  donts: string[];
  examples: string[];
  rules: string[];
  raw: string;
}

export interface ParsedGuideline {
  type: VoiceGuidelineType;
  content: string;
  category?: string;
  priority?: number;
}

const SECTION_HEADERS: [VoiceGuidelineType, RegExp][] = [
  [
    'dont',
    /^#+\s*(?:don'?t'?s?|things?\s+to\s+avoid|what\s+not\s+to\s+do|avoid|negative\s+patterns?)/i,
  ],
  ['do', /^#+\s*(?:do'?s?|things?\s+to\s+do|what\s+to\s+do|positive\s+patterns?)/i],
  ['example', /^#+\s*(?:examples?|gold\s+examples?|sample\s+posts?|reference\s+posts?)/i],
  ['rule', /^#+\s*(?:rules?|guidelines?|principles?|constraints?)/i],
];

function detectSectionType(line: string): VoiceGuidelineType | null {
  for (const [type, regex] of SECTION_HEADERS) {
    if (regex.test(line)) {
      return type;
    }
  }
  return null;
}

function extractListItems(lines: string[]): string[] {
  const items: string[] = [];
  let currentItem = '';
  let lastWasBullet = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      continue;
    }

    // Check if line starts with a bullet marker
    const isBulletLine = /^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed);

    // Check if line is indented (continuation of previous bullet)
    const isIndented = line.startsWith(' ') || line.startsWith('\t');

    if (isBulletLine) {
      // Save previous item if any
      if (currentItem) {
        items.push(currentItem.trim());
      }
      // Start new item (strip bullet marker)
      currentItem = trimmed.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '');
      lastWasBullet = true;
    } else if (lastWasBullet && currentItem && isIndented) {
      // Indented continuation of previous bullet item
      currentItem += ' ' + trimmed;
    } else {
      // Plain text line (no bullet marker, not indented) - treat as standalone item
      if (currentItem) {
        items.push(currentItem.trim());
      }
      currentItem = trimmed;
      lastWasBullet = false;
    }
  }

  // Don't forget the last item
  if (currentItem) {
    items.push(currentItem.trim());
  }

  return items.filter((item) => item.length > 0);
}

export function parseVoiceGuidelinesMarkdown(content: string): VoiceGuidelines {
  const lines = content.split('\n');
  const result: VoiceGuidelines = {
    dos: [],
    donts: [],
    examples: [],
    rules: [],
    raw: content,
  };

  let currentSection: VoiceGuidelineType | null = null;
  let sectionLines: string[] = [];

  const flushSection = (): void => {
    if (currentSection && sectionLines.length > 0) {
      const items = extractListItems(sectionLines);
      switch (currentSection) {
        case 'do':
          result.dos.push(...items);
          break;
        case 'dont':
          result.donts.push(...items);
          break;
        case 'example':
          result.examples.push(...items);
          break;
        case 'rule':
          result.rules.push(...items);
          break;
      }
    }
    sectionLines = [];
  };

  for (const line of lines) {
    const sectionType = detectSectionType(line);
    if (sectionType) {
      flushSection();
      currentSection = sectionType;
      continue;
    }

    if (currentSection) {
      sectionLines.push(line);
    }
  }

  flushSection();

  return result;
}

export async function loadVoiceGuidelinesFromFile(filePath: string): Promise<VoiceGuidelines> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');
  return parseVoiceGuidelinesMarkdown(content);
}

export async function loadVoiceGuidelinesFromEnv(): Promise<VoiceGuidelines | null> {
  const guidelinesPath = process.env.VOICE_GUIDELINES_PATH;
  if (!guidelinesPath) {
    return null;
  }
  return loadVoiceGuidelinesFromFile(guidelinesPath);
}

function generateGuidelineId(_type: VoiceGuidelineType, _index: number): string {
  // Qdrant requires IDs to be either unsigned integers or UUIDs
  return randomUUID();
}

export function guidelinesToDocuments(guidelines: VoiceGuidelines): VoiceGuidelineDocument[] {
  const now = new Date().toISOString();
  const documents: VoiceGuidelineDocument[] = [];

  guidelines.dos.forEach((content, index) => {
    documents.push({
      id: generateGuidelineId('do', index),
      content,
      guidelineType: 'do',
      category: 'voice',
      priority: 1,
      createdAt: now,
    });
  });

  guidelines.donts.forEach((content, index) => {
    documents.push({
      id: generateGuidelineId('dont', index),
      content,
      guidelineType: 'dont',
      category: 'voice',
      priority: 2,
      createdAt: now,
    });
  });

  guidelines.examples.forEach((content, index) => {
    documents.push({
      id: generateGuidelineId('example', index),
      content,
      guidelineType: 'example',
      category: 'reference',
      priority: 3,
      createdAt: now,
    });
  });

  guidelines.rules.forEach((content, index) => {
    documents.push({
      id: generateGuidelineId('rule', index),
      content,
      guidelineType: 'rule',
      category: 'constraint',
      priority: 1,
      createdAt: now,
    });
  });

  return documents;
}

/**
 * @deprecated Use syncVoiceGuidelinesToQdrant instead
 */
export async function syncVoiceGuidelinesToChroma(guidelines: VoiceGuidelines): Promise<number> {
  return syncVoiceGuidelinesToQdrant(guidelines);
}

/**
 * @deprecated Use getVoiceGuidelinesFromQdrant instead
 */
export async function getVoiceGuidelinesFromChroma(): Promise<VoiceGuidelines> {
  return getVoiceGuidelinesFromQdrant();
}

export async function hasVoiceGuidelines(): Promise<boolean> {
  return hasVoiceGuidelinesInQdrant();
}

export function formatGuidelinesForPrompt(guidelines: VoiceGuidelines): string {
  const sections: string[] = [];

  if (guidelines.rules.length > 0) {
    sections.push('## Rules\n' + guidelines.rules.map((r) => `- ${r}`).join('\n'));
  }

  if (guidelines.dos.length > 0) {
    sections.push("## Do's\n" + guidelines.dos.map((d) => `- ${d}`).join('\n'));
  }

  if (guidelines.donts.length > 0) {
    sections.push("## Don'ts\n" + guidelines.donts.map((d) => `- ${d}`).join('\n'));
  }

  if (guidelines.examples.length > 0) {
    sections.push('## Examples\n' + guidelines.examples.map((e) => `> ${e}`).join('\n\n'));
  }

  return sections.join('\n\n');
}

export async function syncVoiceGuidelinesToQdrant(guidelines: VoiceGuidelines): Promise<number> {
  const documents = guidelinesToDocuments(guidelines);
  if (documents.length === 0) {
    return 0;
  }

  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
  if (!exists) {
    logger.info('voice_guidelines collection does not exist, creating it now...');
    const { createVoiceGuidelinesCollection } = await import('@/db/qdrant/collections');
    await createVoiceGuidelinesCollection();
    logger.info('voice_guidelines collection created successfully');
  }

  await clearVoiceGuidelinesFromQdrant();

  const texts = documents.map((d) => d.content);
  const embeddingResults = await generateEmbeddingsBatch(texts);

  const qdrantDocs: Array<{
    id: string;
    text: string;
    embedding: number[];
    metadata: {
      guideline_type: string;
      category?: string;
      priority?: number;
      created_at: string;
    };
  }> = documents.map((doc, index) => ({
    id: doc.id,
    text: doc.content,
    embedding: embeddingResults[index].embedding,
    metadata: {
      guideline_type: doc.guidelineType,
      category: doc.category,
      priority: doc.priority,
      created_at: doc.createdAt,
    },
  }));

  await addDocumentsBatch(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES, qdrantDocs);
  logger.info(`Synced ${documents.length} voice guidelines to Qdrant`);

  return documents.length;
}

export async function clearVoiceGuidelinesFromQdrant(): Promise<void> {
  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
  if (!exists) {
    return;
  }

  const count = await countDocuments(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
  if (count === 0) {
    return;
  }

  await deleteByFilter(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES, {
    must: [{ key: 'guideline_type', match: { value: 'do' } }],
  });
  await deleteByFilter(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES, {
    must: [{ key: 'guideline_type', match: { value: 'dont' } }],
  });
  await deleteByFilter(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES, {
    must: [{ key: 'guideline_type', match: { value: 'example' } }],
  });
  await deleteByFilter(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES, {
    must: [{ key: 'guideline_type', match: { value: 'rule' } }],
  });

  logger.debug('Cleared voice guidelines from Qdrant');
}

async function getVoiceGuidelinesByTypeFromQdrant(
  guidelineType: VoiceGuidelineType
): Promise<VoiceGuidelineDocument[]> {
  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
  if (!exists) {
    return [];
  }

  const { getQdrantClient } = await import('@/db/qdrant/connection');

  const client = getQdrantClient();
  const scrollResult = await client.scroll(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES, {
    filter: {
      must: [{ key: 'guideline_type', match: { value: guidelineType } }],
    },
    with_payload: true,
    limit: 1000,
  });

  return scrollResult.points.map((point) => {
    const payload = point.payload ?? {};
    return {
      id: String(point.id),
      content: (payload.text as string) ?? '',
      guidelineType: (payload.guideline_type as VoiceGuidelineType) ?? guidelineType,
      category: payload.category as string | undefined,
      priority: payload.priority as number | undefined,
      createdAt: (payload.created_at as string) ?? '',
    };
  });
}

export async function getVoiceGuidelinesFromQdrant(): Promise<VoiceGuidelines> {
  const [dos, donts, examples, rules] = await Promise.all([
    getVoiceGuidelinesByTypeFromQdrant('do'),
    getVoiceGuidelinesByTypeFromQdrant('dont'),
    getVoiceGuidelinesByTypeFromQdrant('example'),
    getVoiceGuidelinesByTypeFromQdrant('rule'),
  ]);

  return {
    dos: dos.map((d) => d.content),
    donts: donts.map((d) => d.content),
    examples: examples.map((d) => d.content),
    rules: rules.map((d) => d.content),
    raw: '',
  };
}

export async function hasVoiceGuidelinesInQdrant(): Promise<boolean> {
  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
  if (!exists) {
    return false;
  }
  const count = await countDocuments(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
  return count > 0;
}
