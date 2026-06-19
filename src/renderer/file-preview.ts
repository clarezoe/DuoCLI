// Right-side file preview. Supports multiple render modes by file type:
//   - markdown  → sanitized rendered HTML (with source toggle)
//   - html      → sandboxed iframe (no scripts) (with source toggle)
//   - image     → <img> from a data URL
//   - source    → read-only CodeMirror 6 editor (fallback for everything else)
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { syntaxHighlighting, defaultHighlightStyle, foldGutter } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { yaml } from '@codemirror/lang-yaml';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const MARKDOWN_EXTS = new Set(['md', 'markdown']);
const HTML_EXTS = new Set(['html', 'htm']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']);

export type PreviewMode = 'markdown' | 'html' | 'image' | 'source';

// Choose the preview mode for a given file extension.
export function modeForExt(ext: string): PreviewMode {
  const e = ext.toLowerCase();
  if (MARKDOWN_EXTS.has(e)) return 'markdown';
  if (HTML_EXTS.has(e)) return 'html';
  if (IMAGE_EXTS.has(e)) return 'image';
  return 'source';
}

// Whether a file extension has a dedicated rich preview (used by terminal link routing).
export function isPreviewableExt(ext: string): boolean {
  const e = ext.toLowerCase();
  return MARKDOWN_EXTS.has(e) || HTML_EXTS.has(e) || IMAGE_EXTS.has(e);
}

// MIME type for image data URLs.
function imageMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'svg': return 'image/svg+xml';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'ico': return 'image/x-icon';
    default: return `image/${ext.toLowerCase()}`;
  }
}

// Pick a language extension by file extension. Unknown types return empty (plain text).
function languageForExt(ext: string) {
  switch (ext) {
    case 'md':
    case 'markdown':
      return markdown();
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'tsx':
      return javascript({ typescript: ext.startsWith('ts'), jsx: ext.endsWith('x') });
    case 'json':
      return json();
    case 'py':
      return python();
    case 'html':
    case 'htm':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'yml':
    case 'yaml':
      return yaml();
    default:
      return [];
  }
}

export interface FilePreview {
  // Show text content (markdown/html/source picked by ext).
  show(content: string, ext: string): void;
  // Show an image from a base64 data URL (or any URL).
  showImage(dataUrl: string, ext: string): void;
  destroy(): void;
}

// Mount the preview inside the given container.
export function createFilePreview(parent: HTMLElement): FilePreview {
  // --- Source editor (CodeMirror) ---
  const cmHost = document.createElement('div');
  cmHost.className = 'fp-source';
  const language = new Compartment();
  const view = new EditorView({
    parent: cmHost,
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        language.of([]),
      ],
    }),
  });

  // --- Rendered markdown container ---
  const mdHost = document.createElement('div');
  mdHost.className = 'fp-markdown markdown-body';
  mdHost.hidden = true;

  // --- HTML iframe (sandboxed, no scripts) ---
  const htmlHost = document.createElement('iframe');
  htmlHost.className = 'fp-html';
  // No `allow-scripts` → previewed HTML cannot execute JS.
  htmlHost.setAttribute('sandbox', '');
  htmlHost.hidden = true;

  // --- Image container ---
  const imgHost = document.createElement('div');
  imgHost.className = 'fp-image';
  imgHost.hidden = true;
  const imgEl = document.createElement('img');
  imgHost.appendChild(imgEl);

  // --- Source/rendered toggle (md & html only) ---
  const toggleBar = document.createElement('div');
  toggleBar.className = 'fp-toggle';
  toggleBar.hidden = true;
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'fp-toggle-btn';
  toggleBar.appendChild(toggleBtn);

  parent.appendChild(toggleBar);
  parent.appendChild(mdHost);
  parent.appendChild(htmlHost);
  parent.appendChild(imgHost);
  parent.appendChild(cmHost);

  // Current document state for toggling between rendered and source.
  let curContent = '';
  let curExt = '';
  let curMode: PreviewMode = 'source';
  let showingSource = false;

  function applyVisibility(): void {
    const renderedVisible = !showingSource;
    cmHost.hidden = !(curMode === 'source' || (showingSource && curMode !== 'image'));
    mdHost.hidden = !(curMode === 'markdown' && renderedVisible);
    htmlHost.hidden = !(curMode === 'html' && renderedVisible);
    imgHost.hidden = curMode !== 'image';
    toggleBar.hidden = !(curMode === 'markdown' || curMode === 'html');
    toggleBtn.textContent = showingSource ? 'Rendered' : 'Source';
  }

  function renderRendered(): void {
    if (curMode === 'markdown') {
      const rawHtml = marked.parse(curContent, { async: false }) as string;
      mdHost.innerHTML = DOMPurify.sanitize(rawHtml);
      mdHost.scrollTop = 0;
    } else if (curMode === 'html') {
      // Sandboxed iframe with no script execution; render the file verbatim.
      htmlHost.srcdoc = curContent;
    }
  }

  function renderSource(): void {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: curContent },
      effects: language.reconfigure(languageForExt(curExt)),
    });
    view.scrollDOM.scrollTop = 0;
  }

  toggleBtn.addEventListener('click', () => {
    showingSource = !showingSource;
    if (showingSource) renderSource();
    else renderRendered();
    applyVisibility();
  });

  return {
    show(content: string, ext: string) {
      curContent = content;
      curExt = ext;
      curMode = modeForExt(ext);
      showingSource = false;
      if (curMode === 'markdown' || curMode === 'html') {
        renderRendered();
      } else {
        // source / fallback
        renderSource();
      }
      applyVisibility();
    },
    showImage(dataUrl: string, ext: string) {
      curContent = '';
      curExt = ext;
      curMode = 'image';
      showingSource = false;
      imgEl.src = dataUrl;
      imgEl.alt = '';
      applyVisibility();
    },
    destroy() {
      view.destroy();
    },
  };
}
