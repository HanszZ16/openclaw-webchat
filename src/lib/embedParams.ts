/**
 * Parse URL parameters for iframe embedding mode.
 *
 * Usage:
 *   <iframe src="http://host:5200/?user=zhonghua&ws=ws://gateway:18789&pwd=your_password"></iframe>
 *   <iframe src="http://host:5200/?user=zhonghua&ws=ws://gateway:18789&token=your_token"></iframe>
 *
 * Params:
 *   - user: username → used as session key
 *   - ws:   WebSocket URL of the gateway
 *   - pwd:  gateway password
 *   - token: device token (alternative to password)
 *   - embed: "1" to enable embed mode (hide header controls like disconnect/new session)
 */

export type EmbedParams = {
  /** Whether we're in embed/iframe mode (has user param) */
  isEmbed: boolean;
  /** Username from parent app */
  user: string | null;
  /** Pre-configured WebSocket URL */
  wsUrl: string | null;
  /** Pre-configured password */
  password: string | null;
  /** Pre-configured device token */
  token: string | null;
  /** Whether to hide header controls */
  embedUi: boolean;
};

export function getEmbedParams(): EmbedParams {
  const params = new URLSearchParams(window.location.search);

  const user = params.get('user');
  const wsUrl = params.get('ws');
  const password = params.get('pwd');
  const token = params.get('token');
  const embed = params.get('embed');

  return {
    isEmbed: !!user,
    user,
    wsUrl,
    password,
    token,
    // embed mode: hide disconnect/new session if user param is set, or explicitly via embed=1
    embedUi: !!user || embed === '1',
  };
}
