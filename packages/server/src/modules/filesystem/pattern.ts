// Bounded wildcard matching: no regex engine or nested expansion. ** crosses directories.
export function globMatch(pattern: string, value: string): boolean {
  let previous = new Uint8Array(value.length + 1); previous[0] = 1;
  for (let p = 0; p < pattern.length; p++) {
    const character = pattern[p], double = character === '*' && pattern[p + 1] === '*';
    if (double) p++;
    if (double && pattern[p + 1] === '/') {
      // **/ consumes zero or more complete directories, including in the middle of a pattern.
      const current = previous.slice();
      let reachable = false;
      for (let i = 1; i <= value.length; i++) {
        reachable ||= !!previous[i - 1];
        if (reachable && value[i - 1] === '/') current[i] = 1;
      }
      previous = current; p++; continue;
    }
    const current = new Uint8Array(value.length + 1);
    if (character === '*') current[0] = previous[0];
    for (let i = 1; i <= value.length; i++) {
      const allowed = double || value[i - 1] !== '/';
      current[i] = character === '*' ? Number(!!previous[i] || (!!current[i - 1] && allowed))
        : Number(!!previous[i - 1] && (character === '?' ? allowed : character === value[i - 1]));
    }
    previous = current;
  }
  return !!previous[value.length];
}
