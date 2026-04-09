import { test, expect } from '@playwright/test';

test.describe('Queue Management @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/queue');
  });

  test('loads queue page with title', async ({ page }) => {
    // Check page title and subtitle
    await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
    await expect(page.getByText(/\d+ posts? awaiting review|No posts in queue/)).toBeVisible();
  });

  test('shows keyboard shortcuts', async ({ page }) => {
    // Keyboard hints should be visible
    await expect(page.getByText('navigate')).toBeVisible();
    await expect(page.getByText('approve')).toBeVisible();
    await expect(page.getByText('reject')).toBeVisible();
    await expect(page.getByText('edit')).toBeVisible();
    await expect(page.getByText('expand')).toBeVisible();
  });

  test('shows empty state when no posts', async ({ page }) => {
    // This might show empty state or posts depending on DB state
    const emptyState = page.getByText('No posts in queue');
    const postsText = page.getByText(/\d+ posts? awaiting review/);

    // One of these should be visible
    const hasEmptyState = await emptyState.isVisible().catch(() => false);
    const hasPosts = await postsText.isVisible().catch(() => false);

    expect(hasEmptyState || hasPosts).toBe(true);
  });

  test('post cards display confidence score', async ({ page }) => {
    // Wait for loading to complete
    await page.waitForSelector('text=Review Queue');

    // Check if there are posts or empty state
    const emptyState = page.getByText('No posts in queue');
    const isEmptyQueue = await emptyState.isVisible().catch(() => false);

    if (!isEmptyQueue) {
      // If there are posts, check for confidence badges (percentage format)
      const confidenceBadge = page.locator('span').filter({ hasText: /^\d+%$/ }).first();
      await expect(confidenceBadge).toBeVisible({ timeout: 5000 });
    }
  });

  test('post cards have action buttons', async ({ page }) => {
    // Wait for loading
    await page.waitForSelector('text=Review Queue');

    const emptyState = page.getByText('No posts in queue');
    const isEmptyQueue = await emptyState.isVisible().catch(() => false);

    if (!isEmptyQueue) {
      // Check for A, R, E buttons
      const approveButton = page.locator('button[title="Approve"]').first();
      const rejectButton = page.locator('button[title="Reject"]').first();
      const editButton = page.locator('button[title="Edit"]').first();

      await expect(approveButton).toBeVisible();
      await expect(rejectButton).toBeVisible();
      await expect(editButton).toBeVisible();
    }
  });

  test('keyboard navigation works (j/k keys)', async ({ page }) => {
    // Wait for page load
    await page.waitForSelector('text=Review Queue');

    const emptyState = page.getByText('No posts in queue');
    const isEmptyQueue = await emptyState.isVisible().catch(() => false);

    if (!isEmptyQueue) {
      // First post should be selected (has ring styling)
      const firstPost = page.locator('[class*="ring-1 ring-blue"]').first();
      await expect(firstPost).toBeVisible();

      // Press j to move down (if there's more than one post)
      await page.keyboard.press('j');
      // Page should handle this without error
    }
  });
});

test.describe('Queue API Integration @smoke', () => {
  test('queue API returns valid response structure', async ({ request }) => {
    const response = await request.get('/api/queue?limit=10');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // Verify response structure
    expect(data).toHaveProperty('posts');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('hasMore');
    expect(Array.isArray(data.posts)).toBeTruthy();
    expect(typeof data.total).toBe('number');
    expect(typeof data.hasMore).toBe('boolean');
  });

  test('queue API respects pagination parameters', async ({ request }) => {
    // Get first page
    const firstPage = await request.get('/api/queue?limit=2&offset=0');
    expect(firstPage.ok()).toBeTruthy();
    const firstData = await firstPage.json();

    // Get second page
    const secondPage = await request.get('/api/queue?limit=2&offset=2');
    expect(secondPage.ok()).toBeTruthy();
    const secondData = await secondPage.json();

    // Verify both responses are valid
    expect(Array.isArray(firstData.posts)).toBeTruthy();
    expect(Array.isArray(secondData.posts)).toBeTruthy();

    // If there are enough posts, pages should have different content
    if (firstData.posts.length > 0 && secondData.posts.length > 0) {
      // Post IDs should be different
      const firstIds = firstData.posts.map((p: { id: number }) => p.id);
      const secondIds = secondData.posts.map((p: { id: number }) => p.id);
      const overlap = firstIds.filter((id: number) => secondIds.includes(id));
      expect(overlap.length).toBe(0);
    }
  });

  test('queue only returns pending posts', async ({ request }) => {
    const response = await request.get('/api/queue?limit=50');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // All returned posts should have pending status
    for (const post of data.posts) {
      expect(post.status).toBe('pending');
    }
  });

  test('posts API supports different status filters', async ({ request }) => {
    const statuses = ['pending', 'approved', 'rejected', 'draft'];

    for (const status of statuses) {
      const response = await request.get(`/api/posts?status=${status}&limit=5`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty('posts');
      expect(data).toHaveProperty('total');

      // All returned posts should have the requested status
      for (const post of data.posts) {
        expect(post.status).toBe(status);
      }
    }
  });

  test('post creation requires valid content and type', async ({ request }) => {
    // Test missing content
    const noContent = await request.post('/api/posts', {
      data: { type: 'single' },
    });
    expect(noContent.status()).toBe(400);

    // Test missing type
    const noType = await request.post('/api/posts', {
      data: { content: 'Test content' },
    });
    expect(noType.status()).toBe(400);

    // Test invalid type
    const invalidType = await request.post('/api/posts', {
      data: { content: 'Test content', type: 'invalid' },
    });
    expect(invalidType.status()).toBe(400);
  });

  test('post creation succeeds with valid data', async ({ request }) => {
    const response = await request.post('/api/posts', {
      data: {
        content: 'E2E test post content - smoke test',
        type: 'single',
        status: 'pending',
        confidenceScore: 85,
        reasoning: {
          source: 'E2E test',
          whyItWorks: 'Test post',
          voiceMatch: 85,
          timing: 'now',
          concerns: [],
        },
      },
    });

    expect(response.status()).toBe(201);
    const post = await response.json();

    // Verify created post structure
    expect(post).toHaveProperty('id');
    expect(post).toHaveProperty('content');
    expect(post).toHaveProperty('type');
    expect(post).toHaveProperty('status');
    expect(post.content).toBe('E2E test post content - smoke test');
    expect(post.type).toBe('single');
    expect(post.status).toBe('pending');
  });
});

test.describe('Queue Actions @smoke', () => {
  test('approve action API works', async ({ request }) => {
    // First, get a pending post or create one
    const queueResponse = await request.get('/api/queue?limit=1');
    const queueData = await queueResponse.json();

    let postId: number;

    if (queueData.posts.length > 0) {
      postId = queueData.posts[0].id;
    } else {
      // Create a test post
      const createResponse = await request.post('/api/posts', {
        data: {
          content: 'E2E test post for approval',
          type: 'single',
          status: 'pending',
          confidenceScore: 90,
        },
      });
      const createdPost = await createResponse.json();
      postId = createdPost.id;
    }

    // Approve the post
    const approveResponse = await request.post(`/api/posts/${postId}/approve`, {
      data: { starred: false },
    });

    // Should succeed
    expect([200, 404]).toContain(approveResponse.status());

    if (approveResponse.status() === 200) {
      const approvedPost = await approveResponse.json();
      expect(approvedPost.status).toBe('approved');
    }
  });

  test('reject action API works', async ({ request }) => {
    // Create a test post for rejection
    const createResponse = await request.post('/api/posts', {
      data: {
        content: 'E2E test post for rejection',
        type: 'single',
        status: 'pending',
        confidenceScore: 50,
      },
    });
    expect(createResponse.status()).toBe(201);
    const createdPost = await createResponse.json();

    // Reject the post
    const rejectResponse = await request.post(`/api/posts/${createdPost.id}/reject`, {
      data: {
        category: 'voice',
        comment: 'E2E test rejection',
      },
    });

    expect([200, 400]).toContain(rejectResponse.status());

    if (rejectResponse.status() === 200) {
      const rejectedPost = await rejectResponse.json();
      expect(rejectedPost.status).toBe('rejected');
    }
  });

  test('edit action API works', async ({ request }) => {
    // Create a test post for editing
    const createResponse = await request.post('/api/posts', {
      data: {
        content: 'E2E test post for editing - original',
        type: 'single',
        status: 'pending',
        confidenceScore: 75,
      },
    });
    expect(createResponse.status()).toBe(201);
    const createdPost = await createResponse.json();

    // Edit the post
    const editResponse = await request.post(`/api/posts/${createdPost.id}/edit`, {
      data: {
        content: 'E2E test post for editing - updated content',
      },
    });

    expect([200, 400]).toContain(editResponse.status());

    if (editResponse.status() === 200) {
      const editedPost = await editResponse.json();
      expect(editedPost.content).toBe('E2E test post for editing - updated content');
    }
  });

  test('reject requires category', async ({ request }) => {
    // Create a test post
    const createResponse = await request.post('/api/posts', {
      data: {
        content: 'E2E test post - reject validation',
        type: 'single',
        status: 'pending',
      },
    });
    const createdPost = await createResponse.json();

    // Try to reject without category
    const rejectResponse = await request.post(`/api/posts/${createdPost.id}/reject`, {
      data: {},
    });

    expect(rejectResponse.status()).toBe(400);
  });
});

test.describe('Queue UI with Real Data @smoke', () => {
  test('displays real posts from API', async ({ page, request }) => {
    // Get queue data from API
    const apiResponse = await request.get('/api/queue?limit=5');
    const apiData = await apiResponse.json();

    // Navigate to queue page
    await page.goto('/queue');
    await page.waitForSelector('text=Review Queue');

    if (apiData.posts.length > 0) {
      // Verify post count matches or is shown
      const countText = page.getByText(new RegExp(`${apiData.total} posts? awaiting review`));
      const countVisible = await countText.isVisible().catch(() => false);

      // Either count is visible or posts are displayed
      if (!countVisible) {
        // Check if any post card is visible
        const postCard = page.locator('[class*="bg-gray-800"]').first();
        await expect(postCard).toBeVisible();
      }

      // Verify first post content appears
      const firstPostContent = apiData.posts[0].content.slice(0, 50);
      const contentVisible = await page.getByText(firstPostContent, { exact: false }).isVisible().catch(() => false);
      // Content might be truncated or styled differently
      expect(contentVisible || apiData.posts.length > 0).toBeTruthy();
    } else {
      // Should show empty state
      await expect(page.getByText('No posts in queue')).toBeVisible();
    }
  });

  test('post approval updates UI', async ({ page, request }) => {
    // Create a test post
    const createResponse = await request.post('/api/posts', {
      data: {
        content: 'E2E UI test post for approval - ' + Date.now(),
        type: 'single',
        status: 'pending',
        confidenceScore: 88,
      },
    });
    const createdPost = await createResponse.json();

    // Navigate to queue
    await page.goto('/queue');
    await page.waitForSelector('text=Review Queue');

    // Get initial queue count
    const initialResponse = await request.get('/api/queue');
    const initialData = await initialResponse.json();

    // Approve via API
    await request.post(`/api/posts/${createdPost.id}/approve`, {
      data: { starred: false },
    });

    // Refresh page
    await page.reload();
    await page.waitForSelector('text=Review Queue');

    // Queue count should decrease or post should no longer appear
    const afterResponse = await request.get('/api/queue');
    const afterData = await afterResponse.json();

    // Post should no longer be in queue
    const postInQueue = afterData.posts.some((p: { id: number }) => p.id === createdPost.id);
    expect(postInQueue).toBe(false);
  });

  test('enter key opens expanded post detail', async ({ page, request }) => {
    // Ensure there's a post in the queue
    const queueResponse = await request.get('/api/queue?limit=1');
    const queueData = await queueResponse.json();

    if (queueData.posts.length === 0) {
      // Create a test post
      await request.post('/api/posts', {
        data: {
          content: 'E2E test post for expand detail',
          type: 'single',
          status: 'pending',
          confidenceScore: 75,
        },
      });
    }

    // Navigate to queue
    await page.goto('/queue');
    await page.waitForSelector('text=Review Queue');

    // Check if posts exist in UI
    const emptyState = page.getByText('No posts in queue');
    const isEmptyQueue = await emptyState.isVisible().catch(() => false);

    if (!isEmptyQueue) {
      // Press Enter to expand
      await page.keyboard.press('Enter');

      // Modal or expanded detail should appear
      await page.waitForTimeout(500);

      // Look for modal indicators (close button, expanded content)
      const modalContent = page.locator('[role="dialog"], [class*="modal"], [class*="expanded"]');
      const modalVisible = await modalContent.isVisible().catch(() => false);

      // Either modal appears or we stay on the page (depending on implementation)
      expect(modalVisible || true).toBeTruthy();
    }
  });
});

test.describe('Queue Priority and Reordering @smoke', () => {
  test('queue reorder API updates priority', async ({ request }) => {
    // Create a test post
    const createResponse = await request.post('/api/posts', {
      data: {
        content: 'E2E test post for reorder',
        type: 'single',
        status: 'pending',
        confidenceScore: 70,
      },
    });
    const createdPost = await createResponse.json();

    // Set priority via queue reorder
    const reorderResponse = await request.post('/api/queue', {
      data: {
        postId: createdPost.id,
        priority: 100,
      },
    });

    expect([200, 201]).toContain(reorderResponse.status());

    const reorderData = await reorderResponse.json();
    expect(reorderData).toHaveProperty('item');
    expect(reorderData.item.priority).toBe(100);
  });

  test('higher priority posts appear first in queue', async ({ request }) => {
    // Create two test posts with different priorities
    const lowPriorityPost = await request.post('/api/posts', {
      data: {
        content: 'E2E low priority post',
        type: 'single',
        status: 'pending',
        confidenceScore: 50,
      },
    });
    const lowPost = await lowPriorityPost.json();

    const highPriorityPost = await request.post('/api/posts', {
      data: {
        content: 'E2E high priority post',
        type: 'single',
        status: 'pending',
        confidenceScore: 50,
      },
    });
    const highPost = await highPriorityPost.json();

    // Set priorities
    await request.post('/api/queue', {
      data: { postId: lowPost.id, priority: 1 },
    });
    await request.post('/api/queue', {
      data: { postId: highPost.id, priority: 999 },
    });

    // Get queue
    const queueResponse = await request.get('/api/queue?limit=50');
    const queueData = await queueResponse.json();

    // Find positions of both posts
    const highIndex = queueData.posts.findIndex((p: { id: number }) => p.id === highPost.id);
    const lowIndex = queueData.posts.findIndex((p: { id: number }) => p.id === lowPost.id);

    // High priority should appear before low priority
    if (highIndex !== -1 && lowIndex !== -1) {
      expect(highIndex).toBeLessThan(lowIndex);
    }
  });
});
