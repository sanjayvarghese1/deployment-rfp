export function randomUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
    // browser-compatible RFC4122 v4 implementation using getRandomValues
    const getRandomValues = (typeof crypto !== 'undefined' && typeof (crypto as any).getRandomValues === 'function')
      ? (crypto as any).getRandomValues.bind(crypto)
      : null;

    const bytes: Uint8Array = getRandomValues
      ? getRandomValues(new Uint8Array(16)) as Uint8Array
      : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    // Per RFC4122 v4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  } catch (e) {
    // Last-resort fallback
    const rnd = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return `${rnd()}${rnd()}-${rnd()}-${rnd()}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
  }
}

export default randomUUID;
