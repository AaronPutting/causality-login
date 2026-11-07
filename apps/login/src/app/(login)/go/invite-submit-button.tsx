"use client";

/**
 * The invite landing page's Continue button is a server action submit (see `go/page.tsx`),
 * so there is no client state to hook a spinner into except React's own `useFormStatus` --
 * same pattern `idps/base-button.tsx` already uses for the IDP buttons. Needed because
 * redemption itself takes close to a second (Zitadel's bcrypt password check, see
 * `causality-auth` docs/STATUS-phase2.md "2c" timing notes) plus another second or so of
 * redirects before the lab page paints -- with no feedback at all, Aaron's own real test
 * read that gap as "nothing happened." `disabled={pending}` also rules out a double submit
 * from an impatient second click while the first is still in flight.
 */

import { Button, ButtonProps, ButtonSizes } from "@/components/button";
import { Spinner } from "@/components/spinner";
import { useFormStatus } from "react-dom";

export function InviteSubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size={ButtonSizes.Large} disabled={pending} {...props}>
      {pending ? (
        <>
          <Spinner className="mr-2 h-5 w-5" />
          Opening the page…
        </>
      ) : (
        children
      )}
    </Button>
  );
}
