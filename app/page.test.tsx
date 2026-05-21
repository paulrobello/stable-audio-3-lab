import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudioPreview, clampPlaybackVolume } from "./page";

describe("playback volume", () => {
  it("clamps saved playback volume into the browser audio range", () => {
    expect(clampPlaybackVolume(-0.5)).toBe(0);
    expect(clampPlaybackVolume(0.42)).toBe(0.42);
    expect(clampPlaybackVolume(1.5)).toBe(1);
    expect(clampPlaybackVolume(Number.NaN)).toBe(0.8);
  });

  it("applies the default playback volume to rendered audio controls", () => {
    render(<AudioPreview src="/outputs/test.mp3" volume={0.37} label="Test preview" />);

    const audio = screen.getByLabelText("Test preview") as HTMLAudioElement;
    expect(audio.volume).toBe(0.37);
  });
});
