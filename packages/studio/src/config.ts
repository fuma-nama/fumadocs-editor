import type { SyntaxOptions } from "@fumadocs-editor/core";
import type { SyncServerOptions } from "@fumadocs-editor/core/node";
import type { CollabUser, EditorTheme, MediaProvider, UiComponentSpec } from "@fumadocs-editor/ui";
import type { UserConfig } from "vite";

export interface StudioConfig {
  /**
   * The directory of `.md` / `.mdx` files to edit, relative to the config
   * file. Default: `content/docs`, then `content`, then the config's own
   * directory.
   */
  root?: string;
  /** @defaultValue 5180 */
  port?: number;
  /** listen address; `true` exposes the server on the network */
  host?: string | boolean;
  /**
   * Open the browser once the server is up.
   * @defaultValue true
   */
  open?: boolean;
  /** editable components; default: fumadocs-ui, admonitions and files fences */
  components?: UiComponentSpec[];
  /** parse-level dialects, e.g. `{ math: true }` */
  syntax?: SyntaxOptions;
  /** initial colour theme; the palette's theme actions persist the choice */
  theme?: EditorTheme;
  /**
   * Uploads and display URLs. Default: the studio server stores uploads
   * under `<root>/assets` and serves them. `false` turns uploads off.
   */
  media?: MediaProvider | false;
  /**
   * Collaborative editing for every tab. Off by default; `?collab` in the
   * URL (or the palette's action) turns it on for one tab.
   */
  collab?: boolean | { user?: CollabUser };
  /**
   * Credential sent on every connection and media request, verbatim, to
   * `server.authenticate`. Default: the `?token=` query parameter, then
   * localStorage `fde-token`.
   */
  auth?: () => unknown;
  /** extra stylesheets loaded into the page, relative to the config file */
  styles?: string[];
  /**
   * Node-only options. The config module is also evaluated in the browser,
   * so pass a module path (relative to the config file) instead of an
   * object whenever it imports anything Node-only.
   */
  server?: StudioServerConfig | string;
}

export interface StudioServerConfig extends Pick<
  SyncServerOptions,
  "authenticate" | "upload" | "evictAfterMs" | "helloTimeoutMs"
> {
  /** merged into the studio's Vite config: plugins (Tailwind), aliases, `server.watch` */
  vite?: UserConfig;
}
