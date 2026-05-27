import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("radio m3u playlist route", () => {
  it("serves a TuneIn-compatible m3u playlist for the request host", async () => {
    const response = await GET(new NextRequest("https://radio.pardev.net/radio.m3u?style=ambient", {
      headers: { host: "radio.pardev.net", "x-forwarded-proto": "https" },
    }));

    expect(response.headers.get("content-type")).toBe("audio/x-mpegurl; charset=utf-8");
    expect(await response.text()).toBe([
      "#EXTM3U",
      "#EXTINF:-1,Stable Audio 3 Lab Radio",
      "https://radio.pardev.net/api/radio?stream=1&style=ambient&icy=1",
      "",
    ].join("\n"));
  });
});
