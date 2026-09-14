import * as stylex from "@stylexjs/stylex";

/** the live editor once it has painted: gates insert / placeholder motion */
export const settled = stylex.defineMarker();
/** a math node's outer wrapper; `data-active` while the caret is inside */
export const math = stylex.defineMarker();
/** an accordion item; `data-open` while expanded */
export const accordion = stylex.defineMarker();
/** a folder: nested entries indent under it */
export const folder = stylex.defineMarker();
/** a type-table row: the remove button shows on hover */
export const row = stylex.defineMarker();
/** the joystick button; `data-dragging` while the pointer holds it */
export const joystick = stylex.defineMarker();
/** a JSX element or a textblock with inline tags; `data-active` while the caret is inside */
export const jsxHost = stylex.defineMarker();
/** the file tree root; `data-dragging` while a row is being dragged */
export const fileTree = stylex.defineMarker();
/** one tree row: hover reveals its controls */
export const fileRow = stylex.defineMarker();
/** a folder's trigger; `data-panel-open` turns its chevron */
export const fileFolder = stylex.defineMarker();
/** a row-menu item; `data-highlighted` and `data-danger` colour its icon */
export const fileMenuItem = stylex.defineMarker();
