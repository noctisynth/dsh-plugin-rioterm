export type BindingStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'
>;

interface BindingRecord {
  nonce: string;
  closing: boolean;
}

const prefix = 'rio-terminal.binding.v1.';
const noncePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decode(raw: string): BindingRecord {
  const record = JSON.parse(raw) as Partial<BindingRecord> | null;
  if (
    !record ||
    typeof record.nonce !== 'string' ||
    !noncePattern.test(record.nonce) ||
    typeof record.closing !== 'boolean'
  )
    throw new Error('Invalid Rio terminal binding.');
  return { nonce: record.nonce, closing: record.closing };
}

export function bindingKey(session: string, content: string): string {
  return prefix + JSON.stringify([session, content]);
}

// Each operation opens storage lazily; a window that cannot persist a binding
// must fail before creating a shell. Only operations for this tab escape here.
export function bindingFor(
  storage: () => BindingStorage,
  session: string,
  content: string,
) {
  const key = bindingKey(session, content);
  const read = () => {
    const raw = storage().getItem(key);
    return raw === null ? undefined : decode(raw);
  };
  const write = (record: BindingRecord) =>
    storage().setItem(key, JSON.stringify(record));
  return {
    read,
    async identity(nonce: string = crypto.randomUUID()) {
      const bytes = new TextEncoder().encode(
        JSON.stringify(['rio-terminal:1', session, content, nonce]),
      );
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', bytes),
      );
      const hex = Array.from(digest, (byte) =>
        byte.toString(16).padStart(2, '0'),
      );
      return { nonce, id: `rio-v1-${hex.join('')}` };
    },
    remember(nonce: string) {
      write({ nonce, closing: false });
    },
    beginClose() {
      const record = read();
      if (record) write({ ...record, closing: true });
      return record;
    },
    forget() {
      storage().removeItem(key);
    },
  };
}
export type TabBinding = ReturnType<typeof bindingFor>;

// Snapshot before starting any close: successful jobs will remove their keys.
export function closingBindings(storage: BindingStorage) {
  const jobs: { session: string; content: string }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const [session, content] = JSON.parse(key.slice(prefix.length));
      if (
        typeof session === 'string' &&
        typeof content === 'string' &&
        key === bindingKey(session, content) &&
        decode(storage.getItem(key) ?? '').closing
      )
        jobs.push({ session, content });
    } catch {
      /* Bad records grant no authority. */
    }
  }
  return jobs;
}
