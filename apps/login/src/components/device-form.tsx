"use client";

/**
 * The actual "new device" UI: an email field (so it feels like the start of something, and
 * so a passkey/IDP button has a familiar field to anchor to once added), then, on submit,
 * the one message every guest without a working invite link needs: ask Aaron for a new one.
 *
 * No network call happens between those two states -- this component never looks the email
 * up anywhere, on purpose: a lookup is exactly what would let someone tell a real invited
 * address apart from a made-up one, by a different result or even just by timing. The same
 * card shows either way, for every email. See docs/STATUS-phase2.md "2b".
 *
 * Passkey and Google/Microsoft buttons slot in below the form later (see the anchor comment
 * near the end of this file); they do not change this file's core guarantee above, since
 * they complete entirely against the device's own passkey store or the IdP's own redirect,
 * never against this form or a lookup of the typed email.
 */

import { useState } from "react";
import { Button, ButtonSizes } from "./button";
import { TextInput } from "./input";

const ASK_AARON = "aaron@causality.bio";

export function DeviceForm({ defaultEmail }: { defaultEmail: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="flex flex-col space-y-4">
        <h1>This link works on one device</h1>
        <p className="ztdl-p">
          Your invite link only works on the device and browser it was opened on the first time. Ask Aaron for a new
          one: <a href={`mailto:${ASK_AARON}`}>{ASK_AARON}</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-6">
      <div className="flex flex-col space-y-4">
        <h1>Sign in</h1>
        <p className="ztdl-p">Enter the email your invite was sent to.</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
        className="flex flex-col space-y-4"
      >
        <TextInput
          type="email"
          name="email"
          autoComplete="email"
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" size={ButtonSizes.Large}>
          Continue
        </Button>
      </form>
      {/* Passkey / Google / Microsoft buttons slot in here once they exist. */}
    </div>
  );
}
