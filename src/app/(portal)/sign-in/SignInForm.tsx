"use client";

import { useActionState } from "react";
import { signIn } from "../actions";
import styles from "./sign-in.module.css";

type Choice = { id: string; displayName: string; practiceName: string };

/** One form with a button per provider; the button's value says who. Works without JavaScript too. */
export function SignInForm({ providers }: { providers: Choice[] }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action}>
      {state && !state.ok && (
        <p className={styles.error} role="alert">
          {state.error.message}
        </p>
      )}
      <ul className={styles.list}>
        {providers.map((provider) => (
          <li key={provider.id} className={styles.choice}>
            <div>
              <p className={styles.name}>{provider.displayName}</p>
              <p className={styles.practice}>{provider.practiceName}</p>
            </div>
            <button className="button button-primary" name="providerId" value={provider.id} disabled={pending}>
              Sign in as {provider.displayName}
            </button>
          </li>
        ))}
      </ul>
    </form>
  );
}
