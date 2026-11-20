import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewScheduler, previewPauseMs } from "./preview-scheduler.js";

describe("createPreviewScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders only once typing pauses, with the latest input", () => {
    const renderPreview = vi.fn<(input: string) => void>();
    const scheduler = createPreviewScheduler(renderPreview);

    scheduler.schedulePreview("<p>H");
    vi.advanceTimersByTime(previewPauseMs - 100);
    scheduler.schedulePreview("<p>He");
    vi.advanceTimersByTime(previewPauseMs - 100);
    scheduler.schedulePreview("<p>Hello</p>");
    expect(renderPreview).not.toHaveBeenCalled();

    vi.advanceTimersByTime(previewPauseMs);
    expect(renderPreview).toHaveBeenCalledTimes(1);
    expect(renderPreview).toHaveBeenCalledWith("<p>Hello</p>");
  });

  it("never renders a cancelled preview", () => {
    const renderPreview = vi.fn<(input: string) => void>();
    const scheduler = createPreviewScheduler(renderPreview, 50);

    scheduler.schedulePreview("draft");
    scheduler.cancelPreview();
    vi.advanceTimersByTime(500);

    expect(renderPreview).not.toHaveBeenCalled();
  });
});
