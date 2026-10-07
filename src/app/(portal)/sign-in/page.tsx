import type { Metadata } from "next";
import { listProviders } from "@/server/access/providers";
import { db } from "@/server/db/client";
import { DemoBanner } from "@/ui/components/DemoBanner";
import { SignInForm } from "./SignInForm";
import styles from "./sign-in.module.css";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const providers = await listProviders(db);
  return (
    <>
      <DemoBanner />
      <main id="main" className={styles.page}>
        <h1>Sign in</h1>
        <p className={styles.intro}>
          This demo has no passwords. Choose a provider to continue as them. A real version would sign in through the
          practice&apos;s own login.
        </p>
        <SignInForm
          providers={providers.map(({ id, displayName, practiceName }) => ({ id, displayName, practiceName }))}
        />
      </main>
    </>
  );
}
