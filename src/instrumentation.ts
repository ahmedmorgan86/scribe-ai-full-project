/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used for initializing external services and connections.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register(): Promise<void> {
  // Only run on server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeGateway } = await import('@/lib/llm/gateway');

    try {
      const result = await initializeGateway();

      if (result.available) {
        // eslint-disable-next-line no-console
        console.log(
          `[Instrumentation] LiteLLM gateway initialized. Providers: ${result.providers?.join(', ') ?? 'none'}`
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[Instrumentation] LiteLLM gateway not available at ${result.url}. Using direct API calls.`
        );
      }
    } catch (error) {
      // GatewayStartupError is thrown when REQUIRE_LITELLM_GATEWAY=true and gateway unreachable
      console.error('[Instrumentation] LiteLLM gateway initialization failed:', error);
      throw error;
    }
  }
}
