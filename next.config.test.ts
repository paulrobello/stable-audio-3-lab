import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("next config redirects", () => {
  it("sends the radio tunnel root to the radio page", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toContainEqual({
      source: "/",
      has: [{ type: "host", value: "radio.pardev.net" }],
      destination: "/radio",
      permanent: false,
    });
  });
});
