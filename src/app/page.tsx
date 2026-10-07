import { redirect } from "next/navigation";
import { currentProvider } from "./(portal)/session";

// The portal is the home page: Sales once signed in (§8).
export default async function Home() {
  redirect((await currentProvider()) ? "/sales" : "/sign-in");
}
