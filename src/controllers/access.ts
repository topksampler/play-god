/** Access code for locked deployments (PLAY_GOD_ACCESS_CODE on the server), remembered in this browser only. */
const KEY = 'play-god-access-code';

export const getAccessCode = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};

export const setAccessCode = (code: string) => {
  try {
    if (code) localStorage.setItem(KEY, code);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: code applies to this page only */
  }
};

export const apiHeaders = (extra: Record<string, string> = {}): Record<string, string> => {
  const code = getAccessCode();
  return { ...extra, ...(code ? { 'x-access-code': code } : {}) };
};
