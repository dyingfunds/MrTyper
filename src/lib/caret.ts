/**
 * Where the cursor of a textarea is drawn, measured with a hidden copy of
 * the textarea that wraps text the same way.
 */

const COPIED = [
  "box-sizing", "width", "height", "border-top-width", "border-right-width",
  "border-bottom-width", "border-left-width", "padding-top", "padding-right",
  "padding-bottom", "padding-left", "font-family", "font-size", "font-weight",
  "font-style", "font-variant", "font-stretch", "line-height", "letter-spacing",
  "word-spacing", "text-transform", "text-indent", "tab-size", "white-space",
  "overflow-wrap", "word-break",
];

export interface CaretBox {
  /** Relative to the textarea's top-left corner, after scrolling. */
  left: number;
  top: number;
  /** One line's height. */
  height: number;
}

export function caretBox(element: HTMLTextAreaElement, position: number): CaretBox {
  const style = getComputedStyle(element);
  const mirror = document.createElement("div");
  for (const name of COPIED) {
    mirror.style.setProperty(name, style.getPropertyValue(name));
  }
  // Wrap at the textarea's text width (no scrollbar), as the highlight does.
  mirror.style.boxSizing = "border-box";
  mirror.style.width = `${element.clientWidth}px`;
  mirror.style.borderWidth = "0";
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.overflow = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";

  mirror.textContent = element.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const fontSize = parseFloat(style.fontSize) || 14;
  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;
  const box = {
    left: marker.offsetLeft - element.scrollLeft,
    top: marker.offsetTop - element.scrollTop,
    height: lineHeight,
  };
  mirror.remove();
  return box;
}
