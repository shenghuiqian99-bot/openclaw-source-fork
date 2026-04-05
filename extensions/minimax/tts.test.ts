import { describe, expect, it, vi } from "vitest";
import {
  buildMinimaxTtsPayload,
  minimaxTTS,
  normalizeMinimaxTtsFormat,
} from "./tts.js";

describe("minimax tts", () => {
  it("normalizes format to supported MiniMax output types", () => {
    expect(normalizeMinimaxTtsFormat(undefined)).toBe("mp3");
    expect(normalizeMinimaxTtsFormat("mp3")).toBe("mp3");
    expect(normalizeMinimaxTtsFormat("wav")).toBe("wav");
    expect(normalizeMinimaxTtsFormat("pcm")).toBe("mp3");
  });

  it("builds the expected async TTS task payload", () => {
    expect(
      buildMinimaxTtsPayload({
        text: "hello",
        model: "speech-2.8-hd",
        voiceId: "English_expressive_narrator",
        speed: 1.2,
        format: "wav",
      }),
    ).toMatchObject({
      model: "speech-2.8-hd",
      text: "hello",
      language_boost: "auto",
      voice_setting: {
        voice_id: "English_expressive_narrator",
        speed: 1.2,
      },
      audio_setting: {
        format: "wav",
      },
    });
  });

  it("creates, polls, and downloads MiniMax TTS audio", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ task_id: "task-123", base_resp: { status_code: 0 } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "Processing", base_resp: { status_code: 0 } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: "Success", file_id: "file-456", base_resp: { status_code: 0 } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(Buffer.from("audio-data"), { status: 200 }));

    const result = await minimaxTTS({
      text: "hello",
      apiKey: "sk-test",
      timeoutMs: 5000,
      fetchFn,
    });

    expect(result.outputFormat).toBe("mp3");
    expect(result.audioBuffer.toString()).toBe("audio-data");
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://api.minimax.io/v1/t2a_async_v2");
    expect(fetchFn.mock.calls[3]?.[0]).toBe(
      "https://api.minimax.io/v1/files/retrieve_content?file_id=file-456",
    );
  });
});