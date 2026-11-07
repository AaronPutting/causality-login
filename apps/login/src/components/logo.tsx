type Props = {
  darkSrc?: string;
  lightSrc?: string;
};

// Desktop target ~220px wide (2026-11-07, docs/STATUS-phase2.md "2b" polish pass), scaling
// down on phones so it never crowds the card on a 390px-wide viewport. h-auto, no explicit
// height anywhere: the logo's own intrinsic aspect ratio (the wordmark + ring, now wider
// since "Lab" was appended) sets the height, so a width-only responsive class can't distort
// it at either breakpoint.
const LOGO_CLASS = "w-[170px] sm:w-[220px] h-auto";

export function Logo({ lightSrc, darkSrc }: Props) {
  return (
    <>
      {darkSrc && (
        <div className="hidden dark:flex">
          <img className={LOGO_CLASS} src={darkSrc} alt="logo" />
        </div>
      )}
      {lightSrc && (
        <div className="flex dark:hidden">
          <img className={LOGO_CLASS} src={lightSrc} alt="logo" />
        </div>
      )}
    </>
  );
}
