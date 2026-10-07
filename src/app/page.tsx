import { redirect } from "next/navigation";
import { currentProvider } from "./(portal)/session";

// The portal is the home page: My store once signed in (Sales arrives in M5).
export default async function Home() {
  redirect((await currentProvider()) ? "/store" : "/sign-in");
}
