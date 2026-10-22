/* [INPUT]: Trusted shared apps-sdk-ui SVG catalog, shared action size token and optional presentation class.
 * [OUTPUT]: Shared React action icon with a consistent 18px canvas.
 * [POS]: React adapter only; artwork and license remain in shared/icons.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { iconSvg } from './index.js';
const iconSize = 'var(--buddy-action-icon-size, 18px)';
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`buddy-icon ${className}`}
      style={{ display: 'inline-flex', flexShrink: 0, width: iconSize, height: iconSize }}
      dangerouslySetInnerHTML={{
        __html: iconSvg(name).replace(
          '<svg ',
          `<svg style="display:block;width:${iconSize};height:${iconSize}" `,
        ),
      }}
    />
  );
}
