/* [INPUT]: Effective font-family and the settings/native HTTP authentication context.
 * [OUTPUT]: Local host font faces for React document entries, disposed with the consumer.
 * [POS]: React adapter for shared/host-fonts; no font installation or redistribution.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef } from 'react';
import { createHostFontSync } from '../shared/host-fonts';
import { hostFontSource } from './api';

export function useHostFonts(family?: string) {
  const sync = useRef<ReturnType<typeof createHostFontSync> | null>(null);
  useEffect(() => {
    const fonts = createHostFontSync(hostFontSource);
    sync.current = fonts;
    return () => {
      fonts.destroy();
      sync.current = null;
    };
  }, []);
  useEffect(() => {
    sync.current?.update(family);
  }, [family]);
}
