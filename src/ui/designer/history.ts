export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** What the last change was, so a run of typing in one place undoes as one step. */
  lastKey: string | undefined;
  lastAt: number;
}

export const historyLimit = 200;
export const coalesceMs = 800;

export const startHistory = <T>(present: T): History<T> => ({
  past: [],
  present,
  future: [],
  lastKey: undefined,
  lastAt: 0,
});

export const recordChange = <T>(
  history: History<T>,
  next: T,
  key: string | undefined,
  now: number,
): History<T> => {
  if (next === history.present) {
    return history;
  }
  const isSameRun =
    key !== undefined &&
    key === history.lastKey &&
    now - history.lastAt < coalesceMs;
  return {
    past: isSameRun
      ? history.past
      : [...history.past, history.present].slice(-historyLimit),
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  };
};

export const undo = <T>(history: History<T>): History<T> => {
  const previous = history.past.at(-1);
  return previous === undefined
    ? history
    : {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
        lastKey: undefined,
        lastAt: 0,
      };
};

export const redo = <T>(history: History<T>): History<T> => {
  const [next, ...rest] = history.future;
  return next === undefined
    ? history
    : {
        past: [...history.past, history.present],
        present: next,
        future: rest,
        lastKey: undefined,
        lastAt: 0,
      };
};
