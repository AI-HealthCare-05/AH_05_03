import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";

export interface NotionMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * 이 에디터의 접근 이름을 담은 요소의 id.
   *
   * `contenteditable` 이라 `label htmlFor` 로 못 잇는다 — 화면에 라벨이 보여도
   * 낭독기에는 이름 없는 편집 영역으로 들린다. 부르는 쪽이 이미 그 문구를 그리고
   * 있으므로 문구를 복제하지 않고 id 로 가리킨다.
   */
  ariaLabelledBy?: string;
}

export function NotionMarkdownEditor({
  value,
  onChange,
  placeholder = "통증의 증상이나 불편함을 자유롭게 적어보세요. ('#' 제목, '-' 불릿, '[]' 체크리스트 지원)",
  disabled = false,
  ariaLabelledBy,
}: NotionMarkdownEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      // tiptap-markdown extension storage
      const storage = ed.storage as unknown as { markdown?: { getMarkdown: () => string } };
      const md = storage.markdown?.getMarkdown() ?? "";
      onChange(md);
    },
  });

  // 외부(AI 정제, 날짜 선택 시 기록 전환 등)에서 value가 변경되었을 때 에디터 내용 동기화
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage as unknown as { markdown?: { getMarkdown: () => string } };
    const currentMarkdown = storage.markdown?.getMarkdown() ?? "";
    if (value !== currentMarkdown) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) {
    return (
      <div className="notion-editor-skeleton">
        <div className="skeleton-line" />
      </div>
    );
  }

  return (
    <div className={`notion-editor-wrapper ${disabled ? "is-disabled" : ""}`}>
      {/* 노션 스타일 미니멀 서식 툴바 */}
      <div className="notion-editor-toolbar" role="toolbar" aria-label="텍스트 서식 도구">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`toolbar-btn ${editor.isActive("heading", { level: 1 }) ? "is-active" : ""}`}
          title="대제목 (# )"
          aria-label="대제목"
        >
          H1
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`toolbar-btn ${editor.isActive("heading", { level: 2 }) ? "is-active" : ""}`}
          title="중제목 (## )"
          aria-label="중제목"
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`toolbar-btn ${editor.isActive("heading", { level: 3 }) ? "is-active" : ""}`}
          title="소제목 (### )"
          aria-label="소제목"
        >
          H3
        </button>

        <span className="toolbar-divider" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`toolbar-btn ${editor.isActive("bold") ? "is-active" : ""}`}
          title="굵게 (**텍스트**)"
          aria-label="굵게"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`toolbar-btn ${editor.isActive("italic") ? "is-active" : ""}`}
          title="기울임 (*텍스트*)"
          aria-label="기울임"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`toolbar-btn ${editor.isActive("strike") ? "is-active" : ""}`}
          title="취소선 (~~텍스트~~)"
          aria-label="취소선"
        >
          <s>S</s>
        </button>

        <span className="toolbar-divider" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={`toolbar-btn ${editor.isActive("taskList") ? "is-active" : ""}`}
          title="체크리스트 ([] )"
          aria-label="체크리스트"
        >
          ☑
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`toolbar-btn ${editor.isActive("bulletList") ? "is-active" : ""}`}
          title="글머리 기호 (- )"
          aria-label="글머리 기호"
        >
          •
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`toolbar-btn ${editor.isActive("orderedList") ? "is-active" : ""}`}
          title="번호 목록 (1. )"
          aria-label="번호 목록"
        >
          1.
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`toolbar-btn ${editor.isActive("blockquote") ? "is-active" : ""}`}
          title="인용구 (> )"
          aria-label="인용구"
        >
          ”
        </button>

        <span className="toolbar-divider" />

        <button
          type="button"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className="toolbar-btn"
          title="구분선 (---)"
          aria-label="구분선"
        >
          ―
        </button>
      </div>

      {/* 에디터 본문 영역 */}
      {/* tiptap 은 `role="textbox"` 를 스스로 붙이지 않는다. 편집 영역이라는 것과
          그 이름을 여기서 같이 준다 — 둘 중 하나만 주면 낭독기가 "편집 가능" 만
          알리고 무엇을 적는 칸인지는 말하지 못한다. */}
      <EditorContent
        editor={editor}
        className="notion-editor-content"
        role="textbox"
        aria-multiline="true"
        aria-labelledby={ariaLabelledBy}
      />

      {/* 폼 시리얼라이제이션 및 접근성을 위한 숨김 textarea */}
      <textarea
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          border: 0,
        }}
        tabIndex={-1}
        aria-hidden="true"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
