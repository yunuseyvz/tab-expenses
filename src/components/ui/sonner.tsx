/**
 * Toaster wired to the warm-tactile tokens. `sonner` is shadcn's supported
 * toast replacement; the `toast` component is deprecated.
 */
import { Toaster as Sonner  } from 'sonner'
import type {ToasterProps} from 'sonner';

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-center"
      offset={16}
      toastOptions={{
        classNames: {
          toast: 'tnum',
        },
        style: {
          background: 'var(--color-paper-raised)',
          color: 'var(--color-ink)',
          border: '1px solid var(--color-rule)',
          boxShadow: 'var(--shadow-float)',
          borderRadius: '3px',
        },
      }}
      {...props}
    />
  )
}
