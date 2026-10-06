const MAX_LENGTH = 64;
const FALLBACK = 'space';

const trimDashes = (value: string): string => value.replace(/^-+|-+$/g, '');

export const mailboxName = (spaceName: string): string => {
  const name = trimDashes(
    spaceName
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-'),
  );
  return trimDashes(name.slice(0, MAX_LENGTH)) || FALLBACK;
};

export const candidateNames = (name: string, count = 20): string[] =>
  Array.from({ length: count }, (_, i) => {
    if (i === 0) return name;
    const suffix = `-${i + 1}`;
    return trimDashes(name.slice(0, MAX_LENGTH - suffix.length)) + suffix;
  });
