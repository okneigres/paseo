import { describe, expect, it } from "vitest";
import { wrapSpokenInput, wrapTypedInputInVoiceMode } from "./voice-config";

describe("wrapTypedInputInVoiceMode", () => {
  it("keeps the text and asks for a spoken reply", () => {
    const wrapped = wrapTypedInputInVoiceMode("перезапусти сборку");

    expect(wrapped).toContain("перезапусти сборку");
    expect(wrapped).toContain("<typed-input>");
    expect(wrapped).toContain("speak tool");
    expect(wrapped).not.toContain("This message was spoken");
  });

  it("reads differently from a spoken message, which says the user spoke", () => {
    expect(wrapSpokenInput("hello")).toContain("This message was spoken by the user");
    expect(wrapTypedInputInVoiceMode("hello")).toContain("typed this message instead of speaking");
  });
});
