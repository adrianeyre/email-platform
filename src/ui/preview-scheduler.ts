export interface PreviewScheduler<Input> {
  schedulePreview(input: Input): void;
  cancelPreview(): void;
}

export const previewPauseMs = 400;

export const createPreviewScheduler = <Input>(
  renderPreview: (input: Input) => void,
  pauseMs = previewPauseMs,
): PreviewScheduler<Input> => {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const cancelPreview = () => {
    if (pending !== undefined) {
      clearTimeout(pending);
      pending = undefined;
    }
  };
  return {
    schedulePreview: (input) => {
      cancelPreview();
      pending = setTimeout(() => {
        pending = undefined;
        renderPreview(input);
      }, pauseMs);
    },
    cancelPreview,
  };
};
