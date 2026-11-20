import { describe, expect, it } from "vitest";
import {
  coalesceMs,
  recordChange,
  redo,
  startHistory,
  undo,
} from "./history.js";

describe("undo history", () => {
  it("undoes and redoes changes in order", () => {
    let history = startHistory("a");
    history = recordChange(history, "b", undefined, 0);
    history = recordChange(history, "c", undefined, 1);
    history = undo(history);
    expect(history.present).toBe("b");
    history = undo(history);
    expect(history.present).toBe("a");
    expect(undo(history)).toBe(history);
    history = redo(redo(history));
    expect(history.present).toBe("c");
    expect(redo(history)).toBe(history);
  });

  it("treats a quick run of changes to one thing as one step", () => {
    let history = startHistory("");
    history = recordChange(history, "h", "text:1", 0);
    history = recordChange(history, "he", "text:1", 100);
    history = recordChange(history, "hey", "text:1", 200);
    expect(history.past).toEqual([""]);
    history = recordChange(history, "hey!", "text:1", 200 + coalesceMs);
    expect(history.past).toEqual(["", "hey"]);
    history = recordChange(history, "x", "text:2", 200 + coalesceMs + 1);
    expect(history.past).toEqual(["", "hey", "hey!"]);
  });

  it("drops what could be redone once something new changes", () => {
    let history = recordChange(startHistory(1), 2, undefined, 0);
    history = undo(history);
    history = recordChange(history, 3, undefined, 1);
    expect(history.future).toEqual([]);
    expect(recordChange(history, 3, undefined, 2)).toBe(history);
  });
});
