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
