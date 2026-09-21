import { describe, expect, it } from "vitest";
import { usageCost } from "../src/platform/billing-service.js";
import { UsageCollector } from "../src/platform/relay-service.js";
describe("relay token accounting", () => {
  it("rounds once using integer arithmetic and includes cache usage", () => {
    expect(
      usageCost(
        { input: 3, output: 2, cacheRead: 5, cacheWrite: 1 },
        {
          input: 1000000,
          output: 3000000,
          cacheRead: 100000,
          cacheWrite: 2000000,
        },
      ),
    ).toBe(12);
    expect(() =>
      usageCost(
        { input: -1, output: 0, cacheRead: 0, cacheWrite: 0 },
        { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
      ),
    ).toThrow();
  });
  it("collects split SSE frames and treats message_delta usage as cumulative", () => {
    const collector = new UsageCollector();
    const wire =
      'event: message_start\r\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":3}}}\r\n\r\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\ndata: {"type":"message_stop"}\n\n';
    for (let index = 0; index < wire.length; index += 7)
      collector.feed(wire.slice(index, index + 7));
    expect(collector.result()).toEqual({
      input: 10,
      output: 5,
      cacheRead: 3,
      cacheWrite: 0,
    });
  });
  it("does not invent final usage for interrupted streams", () => {
    const collector = new UsageCollector();
    collector.feed(
      'data: {"type":"message_start","message":{"usage":{"input_tokens":2,"output_tokens":0}}}\n\n',
    );
    expect(collector.result()).toBe("pending_review");
  });
});
