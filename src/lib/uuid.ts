export function randomUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
    const getRandomValues = (typeof crypto !== 'undefined' && typeof (crypto as any).getRandomValues === 'function')
      ? (crypto as any).getRandomValues.bind(crypto)
      : null;
    const bytes = getRandomValues ? getRandomValues(new Uint8Array(16)) : new Uint8Array(16).map(() => Math.floor(Math.random() * 256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  } catch (e) {
    const rnd = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return `${rnd()}${rnd()}-${rnd()}-${rnd()}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
  }
}

export default randomUUID;
