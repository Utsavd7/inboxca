import type { Metadata } from "next";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Sign up | InboxCA" };

export default function SignUp() {
  return (
    <>
      <h1>Sign up</h1>
      <SignUpForm />
    </>
  );
}
