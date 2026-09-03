import { vi } from 'vitest';

globalThis.fetch = vi.fn<typeof fetch>();
