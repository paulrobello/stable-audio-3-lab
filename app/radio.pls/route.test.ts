import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("radio pls playlist route", () => {
  it("serves a TuneIn-compatible pls playlist for the request host", async () => {
    const response = await GET(new NextRequest("http://192.168.1.50:3007/radio.pls?style=lofi", {
      headers: { host: "192.168.1.50:3007", "x-forwarded-proto": "http" },
    }));

    expect(response.headers.get("content-type")).toBe("audio/x-scpls; charset=utf-8");
    expect(await response.text()).toBe([
      "[playlist]",
      "NumberOfEntries=1",
      "File1=http://192.168.1.50:3007/api/radio?stream=1&style=lofi&icy=1",
      "Title1=Stable Audio 3 Lab Radio",
      "Length1=-1",
      "Version=2",
      "",
    ].join("\n"));
  });
});
