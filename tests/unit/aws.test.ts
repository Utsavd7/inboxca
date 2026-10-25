import { afterEach, describe, expect, it, vi } from "vitest";
import { awsCredentials, awsFetch, signedHeaders } from "@/src/lib/aws";
import { fakeAws, testCredentials } from "@/tests/fixtures/aws";

// AWS's own published examples of Signature Version 4: the test suite's get-vanilla, the IAM
// ListUsers example and the S3 GET object example, with AWS's example keys.
describe("Signature Version 4", () => {
  const example = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" }; // ggignore: AWS published example key
  const at = new Date("2015-08-30T12:36:00Z");
  const signature = (headers: Record<string, string>) => headers.authorization.split("Signature=")[1];

  it("matches AWS's published examples", () => {
    expect(signature(signedHeaders("GET", "https://example.amazonaws.com/", {}, "", { service: "service", region: "us-east-1", credentials: example }, at)))
      .toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    expect(signature(signedHeaders("GET", "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08", { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" }, "", { service: "iam", region: "us-east-1", credentials: example }, at)))
      .toBe("5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
    const s3 = signedHeaders("GET", "https://examplebucket.s3.amazonaws.com/test.txt", { Range: "bytes=0-9" }, "",
      { service: "s3", region: "us-east-1", credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" } }, new Date("2013-05-24T00:00:00Z")); // ggignore: AWS published example key
    expect(signature(s3)).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(s3["x-amz-content-sha256"]).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("never puts the secret in what it sends", () => {
    const headers = signedHeaders("POST", "https://kms.ap-south-1.amazonaws.com/", { "x-amz-target": "TrentService.Decrypt" }, "{}", { service: "kms", region: "ap-south-1", credentials: testCredentials });
    expect(JSON.stringify(headers)).not.toContain(testCredentials.secretAccessKey);
    expect(headers).not.toHaveProperty("host");
  });
});

describe("credentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads key id and secret from one setting, or the standard AWS variables", () => {
    expect(awsCredentials("AKID:se:cret")).toEqual({ accessKeyId: "AKID", secretAccessKey: "se:cret" });
    expect(awsCredentials("no-secret")).toBeNull();
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIDROLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "role secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "token");
    expect(awsCredentials()).toEqual({ accessKeyId: "AKIDROLE", secretAccessKey: "role secret", sessionToken: "token" });
  });
});

describe("a signed call", () => {
  it("is accepted by a service that checks the signature, and refused when the secret is wrong", async () => {
    const fake = await fakeAws("kms", "ap-south-1", () => ({ json: { ok: true } }));
    try {
      const good = await awsFetch("POST", `${fake.url}/`, { "x-amz-target": "TrentService.Decrypt" }, "{}", { service: "kms", region: "ap-south-1", credentials: testCredentials });
      expect(good.status).toBe(200);
      const bad = await awsFetch("POST", `${fake.url}/`, {}, "{}", { service: "kms", region: "ap-south-1", credentials: { ...testCredentials, secretAccessKey: "wrong" } });
      expect(bad.status).toBe(403);
      // A session token is signed too.
      const role = await awsFetch("POST", `${fake.url}/`, {}, "{}", { service: "kms", region: "ap-south-1", credentials: { ...testCredentials, sessionToken: "invented token" } });
      expect(role.status).toBe(200);
      expect(fake.requests[2].headers["x-amz-security-token"]).toBe("invented token");
    } finally {
      await fake.close();
    }
  });

  it("is tried once more when the service is busy, and no more", async () => {
    let calls = 0;
    const fake = await fakeAws("kms", "ap-south-1", () => (calls++ % 3 === 2 ? { json: {} } : { status: 503, json: {} }));
    try {
      expect((await awsFetch("POST", `${fake.url}/`, {}, "{}", { service: "kms", region: "ap-south-1", credentials: testCredentials })).status).toBe(503);
      expect((await awsFetch("POST", `${fake.url}/`, {}, "{}", { service: "kms", region: "ap-south-1", credentials: testCredentials })).status).toBe(200);
      expect(fake.requests).toHaveLength(3);
    } finally {
      await fake.close();
    }
  });
});
