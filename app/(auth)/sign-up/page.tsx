import type { Metadata } from "next";
import { firmlessAccount, providerChoices } from "@/src/lib/sign-in";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Sign up | InboxCA" };

// After Google or Microsoft, a person in no firm yet is signed in already: only the firm's
// details are asked for.
export default async function SignUp() {
  const account = await firmlessAccount();
  return (
    <>
      <h1>Sign up</h1>
      <SignUpForm account={account?.email} providers={account ? [] : providerChoices()} />
    </>
  );
}
