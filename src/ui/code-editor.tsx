import { html } from "@codemirror/lang-html";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";
import { highlightHandlebars } from "./handlebars-highlight.js";

export const CodeEditor = ({
  value,
  onChange,
  label,
  isReadOnly = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  label: string;
  isReadOnly?: boolean;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const latestValueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
    latestValueRef.current = value;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: latestValueRef.current,
        extensions: [
          basicSetup,
          html(),
          highlightHandlebars,
          EditorView.lineWrapping,
          EditorState.readOnly.of(isReadOnly),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [label, isReadOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (view !== null && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  return <div className="code-editor" ref={hostRef} />;
};
