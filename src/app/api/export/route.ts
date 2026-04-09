import { NextRequest, NextResponse } from 'next/server';
import { listPosts } from '@/db/models/posts';
import { listFeedback } from '@/db/models/feedback';
import { listPatterns } from '@/db/models/patterns';
import { listCostEntries } from '@/db/models/costs';
import { Post, Feedback, Pattern, CostEntry } from '@/types';

interface ExportData {
  exportedAt: string;
  version: string;
  posts: Post[];
  feedback: Feedback[];
  patterns: Pattern[];
  costHistory: CostEntry[];
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getAllData(): ExportData {
  const posts = listPosts({ limit: 100000 });
  const feedback = listFeedback({ limit: 100000 });
  const patterns = listPatterns({ limit: 100000 });
  const costHistory = listCostEntries({ limit: 100000 });

  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    posts,
    feedback,
    patterns,
    costHistory,
  };
}

function escapeCSVField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function jsonToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

function postsToCSV(posts: Post[]): string {
  const headers = [
    'id',
    'content',
    'type',
    'status',
    'confidenceScore',
    'reasoning',
    'voiceEvaluation',
    'createdAt',
    'postedAt',
  ];

  const rows = posts.map((post) => [
    escapeCSVField(post.id),
    escapeCSVField(post.content),
    escapeCSVField(post.type),
    escapeCSVField(post.status),
    escapeCSVField(post.confidenceScore),
    escapeCSVField(jsonToString(post.reasoning)),
    escapeCSVField(jsonToString(post.voiceEvaluation)),
    escapeCSVField(post.createdAt),
    escapeCSVField(post.postedAt),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function feedbackToCSV(feedback: Feedback[]): string {
  const headers = [
    'id',
    'postId',
    'action',
    'category',
    'comment',
    'diffBefore',
    'diffAfter',
    'createdAt',
  ];

  const rows = feedback.map((fb) => [
    escapeCSVField(fb.id),
    escapeCSVField(fb.postId),
    escapeCSVField(fb.action),
    escapeCSVField(fb.category),
    escapeCSVField(fb.comment),
    escapeCSVField(fb.diffBefore),
    escapeCSVField(fb.diffAfter),
    escapeCSVField(fb.createdAt),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function patternsToCSV(patterns: Pattern[]): string {
  const headers = [
    'id',
    'patternType',
    'description',
    'evidenceCount',
    'editEvidenceCount',
    'rejectionEvidenceCount',
    'createdAt',
    'updatedAt',
  ];

  const rows = patterns.map((pattern) => [
    escapeCSVField(pattern.id),
    escapeCSVField(pattern.patternType),
    escapeCSVField(pattern.description),
    escapeCSVField(pattern.evidenceCount),
    escapeCSVField(pattern.editEvidenceCount),
    escapeCSVField(pattern.rejectionEvidenceCount),
    escapeCSVField(pattern.createdAt),
    escapeCSVField(pattern.updatedAt),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function costHistoryToCSV(costs: CostEntry[]): string {
  const headers = ['id', 'apiName', 'tokensUsed', 'costUsd', 'createdAt'];

  const rows = costs.map((cost) => [
    escapeCSVField(cost.id),
    escapeCSVField(cost.apiName),
    escapeCSVField(cost.tokensUsed),
    escapeCSVField(cost.costUsd),
    escapeCSVField(cost.createdAt),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function dataToCSV(data: ExportData): string {
  const sections = [
    `# Posts (exported: ${data.exportedAt})`,
    postsToCSV(data.posts),
    '',
    '# Feedback',
    feedbackToCSV(data.feedback),
    '',
    '# Patterns',
    patternsToCSV(data.patterns),
    '',
    '# Cost History',
    costHistoryToCSV(data.costHistory),
  ];

  return sections.join('\n');
}

type ExportFormat = 'json' | 'csv';

function isValidFormat(format: string | null): format is ExportFormat {
  return format === 'json' || format === 'csv';
}

export function GET(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');

    if (!isValidFormat(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Use ?format=json or ?format=csv' },
        { status: 400 }
      );
    }

    const data = getAllData();
    const filename = `ai-social-engine-export-${formatDate(new Date())}`;

    if (format === 'json') {
      const jsonContent = JSON.stringify(data, null, 2);
      return new NextResponse(jsonContent, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}.json"`,
        },
      });
    }

    const csvContent = dataToCSV(data);
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to export data: ${errorMessage}` }, { status: 500 });
  }
}
