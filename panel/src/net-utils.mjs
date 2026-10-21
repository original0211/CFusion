import { isIP } from 'node:net';

export { isIP };

// Shared by the Node pinned-address clients and the fetch variants. Keeping
// the classifier in one small module prevents the runtimes drifting apart.
export function isPublicAddress(address) {
  const value = String(address || '').toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  if (value.startsWith('::ffff:') && value.includes('.')) return isPublicAddress(value.slice(7));
  return isIP(value) === 6 && /^[23][0-9a-f]{3}:/.test(value) && !value.startsWith('2001:db8:');
}

export function normalizeResolvedAddresses(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    if (typeof row === 'string') return row;
    if (row && typeof row.address === 'string') return row.address;
    if (row && typeof row.data === 'string' && (row.type === 1 || row.type === 28)) return row.data;
    return '';
  }).filter(Boolean);
}
