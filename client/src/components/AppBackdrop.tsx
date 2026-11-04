/**
 * Fixed background layers inside `.app-shell`, drawn behind the content and
 * styled entirely by index.css from <html data-*> appearance attributes:
 * photo wallpaper, place-based pattern, and animated motion. Each layer is
 * display:none unless its knob turns it on, so it costs nothing by default.
 */
interface AppBackdropProps {
  /**
   * Include the layers drawn from the user's own data (photo wallpaper,
   * place patterns). Off on signed-out screens: those images are only served
   * to their owner, so requesting them there would just fail.
   */
  personal?: boolean;
}

export function AppBackdrop({ personal = true }: AppBackdropProps) {
  return (
    <>
      {personal && <div className="app-wallpaper" aria-hidden="true" />}
      {personal && <div className="app-places" aria-hidden="true" />}
      <div className="app-motion" aria-hidden="true" />
    </>
  );
}
