import { createLogger } from '@/lib/logger';

const logger = createLogger('embeddings:service');

export interface EmbeddingConfig {
  provider: 'openai' | 'cohere';
  model?: string;
}

export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
}

const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';
const DEFAULT_COHERE_MODEL = 'embed-english-v3.0';

function getConfig(): EmbeddingConfig {
  const provider = (process.env.EMBEDDING_PROVIDER ?? 'openai') as 'openai' | 'cohere';
  const model =
    process.env.EMBEDDING_MODEL ??
    (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_COHERE_MODEL);
  return { provider, model };
}

async function generateOpenAIEmbedding(text: string, model: string): Promise<EmbeddingResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for OpenAI embeddings');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { prompt_tokens: number };
  };

  return {
    embedding: data.data[0].embedding,
    tokens: data.usage.prompt_tokens,
  };
}

async function generateOpenAIEmbeddingsBatch(
  texts: string[],
  model: string
): Promise<EmbeddingResult[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for OpenAI embeddings');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    usage: { prompt_tokens: number };
  };

  const tokensPerText = Math.ceil(data.usage.prompt_tokens / texts.length);
  const sorted = data.data.sort((a, b) => a.index - b.index);

  return sorted.map((item) => ({
    embedding: item.embedding,
    tokens: tokensPerText,
  }));
}

async function generateCohereEmbedding(text: string, model: string): Promise<EmbeddingResult> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error('COHERE_API_KEY is required for Cohere embeddings');
  }

  const response = await fetch('https://api.cohere.ai/v1/embed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      texts: [text],
      input_type: 'search_document',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cohere embedding API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    embeddings: number[][];
    meta: { billed_units: { input_tokens: number } };
  };

  return {
    embedding: data.embeddings[0],
    tokens: data.meta.billed_units.input_tokens,
  };
}

async function generateCohereEmbeddingsBatch(
  texts: string[],
  model: string
): Promise<EmbeddingResult[]> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error('COHERE_API_KEY is required for Cohere embeddings');
  }

  const response = await fetch('https://api.cohere.ai/v1/embed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      texts,
      input_type: 'search_document',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cohere embedding API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    embeddings: number[][];
    meta: { billed_units: { input_tokens: number } };
  };

  const tokensPerText = Math.ceil(data.meta.billed_units.input_tokens / texts.length);

  return data.embeddings.map((embedding) => ({
    embedding,
    tokens: tokensPerText,
  }));
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const config = getConfig();
  logger.debug(`Generating embedding with ${config.provider}/${config.model ?? 'default'}`);

  if (config.provider === 'openai' && config.model) {
    return generateOpenAIEmbedding(text, config.model);
  } else if (config.provider === 'cohere' && config.model) {
    return generateCohereEmbedding(text, config.model);
  }

  throw new Error(`Unknown embedding provider: ${String(config.provider)}`);
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) {
    return [];
  }

  const config = getConfig();
  logger.debug(
    `Generating ${texts.length} embeddings with ${config.provider}/${config.model ?? 'default'}`
  );

  if (config.provider === 'openai' && config.model) {
    return generateOpenAIEmbeddingsBatch(texts, config.model);
  } else if (config.provider === 'cohere' && config.model) {
    return generateCohereEmbeddingsBatch(texts, config.model);
  }

  throw new Error(`Unknown embedding provider: ${String(config.provider)}`);
}

export async function generateQueryEmbedding(queryText: string): Promise<EmbeddingResult> {
  const config = getConfig();

  if (config.provider === 'cohere') {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      throw new Error('COHERE_API_KEY is required for Cohere embeddings');
    }

    const response = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        texts: [queryText],
        input_type: 'search_query',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cohere embedding API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      embeddings: number[][];
      meta: { billed_units: { input_tokens: number } };
    };

    return {
      embedding: data.embeddings[0],
      tokens: data.meta.billed_units.input_tokens,
    };
  }

  return generateEmbedding(queryText);
}

export function getEmbeddingDimension(): number {
  const config = getConfig();
  if (config.provider === 'cohere') {
    return 1024;
  }
  if (config.model === 'text-embedding-3-small') {
    return 1536;
  }
  if (config.model === 'text-embedding-3-large') {
    return 3072;
  }
  return 1536;
}
