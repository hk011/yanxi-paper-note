import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import NoteRenderer from "./NoteRenderer";

interface Props {
  draft: string;
  paperId: number;
  onDraftChange: (value: string) => void;
}

export default function NoteEditorPanel({ draft, paperId, onDraftChange }: Props) {
  return (
    <div className="note-editor">
      <div className="note-editor-pane note-editor-pane--source">
        <div className="note-editor-pane-label">Markdown</div>
        <div className="note-editor-codemirror">
          <CodeMirror
            value={draft}
            height="100%"
            extensions={[
              markdown({ base: markdownLanguage, codeLanguages: languages }),
            ]}
            onChange={onDraftChange}
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: true,
            }}
          />
        </div>
      </div>
      <div className="note-editor-pane note-editor-pane--preview">
        <div className="note-editor-pane-label">预览</div>
        <div className="note-editor-preview">
          <NoteRenderer content={draft} paperId={paperId} />
        </div>
      </div>
    </div>
  );
}
