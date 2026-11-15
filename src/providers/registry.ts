import { ProviderError } from "../contract/ports";
import type { Provider, ProviderRegistry } from "../contract/ports";
import { CLAUDE_PROVIDER_ID, ClaudeAgentProvider } from "./claude";
import type { ClaudeAgentProviderOptions } from "./claude";

export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  register(provider: Provider): void {
    if (this.providers.has(provider.id)) {
      throw new ProviderError(`A provider with id "${provider.id}" is already registered`, provider.id);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}

export interface DefaultRegistryOptions {
  claude?: ClaudeAgentProviderOptions;
}

/**
 * Fan-in file: add one `registry.register(...)` line here for each new
 * provider. Nothing else in the codebase changes.
 */
export function createDefaultRegistry(options: DefaultRegistryOptions = {}): ProviderRegistry {
  const registry = new InMemoryProviderRegistry();
  registry.register(new ClaudeAgentProvider(options.claude));
  return registry;
}

export { CLAUDE_PROVIDER_ID };
