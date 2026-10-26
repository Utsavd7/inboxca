import { afterEach, expect, it, vi } from "vitest";
import { providerChoices, refusal } from "@/src/lib/sign-in";

afterEach(() => vi.unstubAllEnvs());

it("shows Continue with Google or Microsoft only once its client ID is set", () => {
  vi.stubEnv("SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID", "");
  vi.stubEnv("SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID", "");
  expect(providerChoices()).toEqual([]);
  vi.stubEnv("SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID", "invented-id");
  expect(providerChoices()).toEqual([{ id: "azure", name: "Microsoft" }]);
  vi.stubEnv("SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID", "invented-id");
  expect(providerChoices().map(({ name }) => name)).toEqual(["Google", "Microsoft"]);
});

// What Supabase Auth puts on the way back when there is no sign in (its redirectErrors).
it("names why Google or Microsoft did not sign the person in", () => {
  const why = (query: string) => refusal(new URLSearchParams(query));
  expect(why("error=access_denied&error_description=The+user+denied+access")).toBe("cancelled");
  expect(why("error=access_denied&error_description=AADSTS65004%3A+User+declined+to+consent")).toBe("cancelled");
  expect(why("error=access_denied&error_code=provider_email_needs_verification")).toBe("unverified");
  expect(why("error=access_denied&error_code=signup_disabled")).toBe("provider");
  expect(why("error=server_error&error_description=Unable+to+exchange+external+code")).toBe("provider");
  expect(why("")).toBe("provider");
});
