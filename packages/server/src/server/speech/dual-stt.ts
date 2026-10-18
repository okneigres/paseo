import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type pino from "pino";

import type {
  SpeechToTextProvider,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "./speech-provider.js";

// How long the slower model is waited for once the faster one has answered. Both local
// models read at about a tenth of real time, so a gap this long means the slower one is
// stuck, not busy. The turn is then delivered with the text that exists, marked.
const DEFAULT_STRAGGLER_GRACE_MS = 120_000;

export interface DualSttLabels {
  primary: string;
  secondary: string;
}

/**
 * Reads the same audio with two models and delivers both texts as one transcript, each
 * labelled, so the agent can compare them and take the better parts of each. If one model
 * fails or does not finish, the other's text is still delivered, with a note saying so.
 */
export class DualSpeechToTextProvider implements SpeechToTextProvider {
  public readonly id: string;

  constructor(
    private readonly primary: SpeechToTextProvider,
    private readonly secondary: SpeechToTextProvider,
    private readonly labels: DualSttLabels,
    private readonly options: { stragglerGraceMs?: number } = {},
  ) {
    this.id = primary.id;
  }

  createSession(params: {
    logger: pino.Logger;
    language?: string;
    prompt?: string;
  }): StreamingTranscriptionSession {
    let secondary: StreamingTranscriptionSession | null = null;
    let secondaryFailure: string | null = null;
    try {
      secondary = this.secondary.createSession(params);
    } catch (error) {
      secondaryFailure = describe(error);
    }
    return new DualTranscriptionSession({
      primary: this.primary.createSession(params),
      secondary,
      secondaryFailure,
      labels: this.labels,
      logger: params.logger,
      stragglerGraceMs: this.options.stragglerGraceMs ?? DEFAULT_STRAGGLER_GRACE_MS,
    });
  }
}

interface SideResult {
  text: string;
  language?: string;
  isLowConfidence?: boolean;
}

interface Round {
  segmentId: string;
  // Index 0 is the primary model, 1 the secondary one.
  results: Array<SideResult | { failure: string } | undefined>;
  timer: ReturnType<typeof setTimeout> | null;
  done: boolean;
}

interface Side {
  label: string;
  session: StreamingTranscriptionSession | null;
  failure: string | null;
  // Rounds committed to this model that its own segment id is not known for yet.
  waiting: Round[];
  bySegmentId: Map<string, Round>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFailure(result: Round["results"][number]): result is { failure: string } {
  return Boolean(result) && "failure" in (result as object);
}

class DualTranscriptionSession extends EventEmitter implements StreamingTranscriptionSession {
  public requiredSampleRate: number;

  private readonly sides: [Side, Side];
  private readonly rounds: Round[] = [];
  private readonly logger: pino.Logger;
  private readonly stragglerGraceMs: number;
  private segmentId = uuidv4();
  private previousSegmentId: string | null = null;
  private closed = false;
  private errorEmitted = false;

  constructor(input: {
    primary: StreamingTranscriptionSession;
    secondary: StreamingTranscriptionSession | null;
    secondaryFailure: string | null;
    labels: DualSttLabels;
    logger: pino.Logger;
    stragglerGraceMs: number;
  }) {
    super();
    this.logger = input.logger.child({ component: "dual-stt" });
    this.stragglerGraceMs = input.stragglerGraceMs;
    this.requiredSampleRate = input.primary.requiredSampleRate;
    this.sides = [
      {
        label: input.labels.primary,
        session: input.primary,
        failure: null,
        waiting: [],
        bySegmentId: new Map(),
      },
      {
        label: input.labels.secondary,
        session: input.secondary,
        failure: input.secondaryFailure,
        waiting: [],
        bySegmentId: new Map(),
      },
    ];
    this.sides.forEach((side, index) => this.attach(side, index));
  }

  private attach(side: Side, index: number): void {
    const session = side.session;
    if (!session) {
      return;
    }
    session.on("committed", ({ segmentId }) => {
      const round = side.waiting.shift();
      if (round) {
        side.bySegmentId.set(segmentId, round);
      }
    });
    session.on("transcript", (event) => this.handleTranscript(side, index, event));
    session.on("error", (error) => this.failSide(index, describe(error)));
  }

  async connect(): Promise<void> {
    const results = await Promise.allSettled(
      this.sides.map((side) => side.session?.connect() ?? Promise.resolve()),
    );
    if (results[0].status === "rejected") {
      throw results[0].reason;
    }
    if (results[1].status === "rejected") {
      this.failSide(1, describe(results[1].reason));
    }
    const secondary = this.sides[1].session;
    if (secondary && !this.sides[1].failure) {
      if (secondary.requiredSampleRate !== this.requiredSampleRate) {
        this.failSide(1, "its audio sample rate differs from the first model's");
      }
    }
  }

  appendPcm16(chunk: Buffer): void {
    this.sides.forEach((side, index) => {
      if (!side.session || side.failure) {
        return;
      }
      try {
        side.session.appendPcm16(chunk);
      } catch (error) {
        this.failSide(index, describe(error));
      }
    });
  }

  commit(): void {
    const round: Round = {
      segmentId: this.segmentId,
      results: [undefined, undefined],
      timer: null,
      done: false,
    };
    this.rounds.push(round);
    this.emit("committed", {
      segmentId: round.segmentId,
      previousSegmentId: this.previousSegmentId,
    });
    this.previousSegmentId = round.segmentId;
    this.segmentId = uuidv4();

    this.sides.forEach((side, index) => {
      if (!side.session || side.failure) {
        round.results[index] = { failure: side.failure ?? "not available" };
        return;
      }
      side.waiting.push(round);
      try {
        side.session.commit();
      } catch (error) {
        this.failSide(index, describe(error));
      }
    });
    this.settle(round);
  }

  clear(): void {
    for (const side of this.sides) {
      try {
        side.session?.clear();
      } catch {
        // a failed side is reported elsewhere
      }
    }
    this.segmentId = uuidv4();
  }

  close(): void {
    this.closed = true;
    for (const round of this.rounds) {
      if (round.timer) clearTimeout(round.timer);
    }
    this.rounds.length = 0;
    for (const side of this.sides) {
      try {
        side.session?.close();
      } catch {
        // already closed
      }
    }
  }

  private handleTranscript(side: Side, index: number, event: StreamingTranscriptionEvent): void {
    if (!event.isFinal) {
      // Progress is shown from the first model only; the second one is read at the end.
      if (index === 0) {
        this.emit("transcript", {
          segmentId: this.segmentId,
          transcript: event.transcript,
          isFinal: false,
        });
      }
      return;
    }
    const round = side.bySegmentId.get(event.segmentId);
    side.bySegmentId.delete(event.segmentId);
    if (!round || round.done) {
      this.logger.debug({ side: side.label }, "dual_stt.late_or_unknown_final");
      return;
    }
    round.results[index] = {
      text: event.transcript,
      ...(event.language ? { language: event.language } : {}),
      ...(event.isLowConfidence !== undefined ? { isLowConfidence: event.isLowConfidence } : {}),
    };
    this.settle(round);
  }

  private failSide(index: number, reason: string): void {
    const side = this.sides[index];
    if (side.failure) {
      return;
    }
    side.failure = reason;
    this.logger.warn({ side: side.label, reason }, "dual_stt.side_failed");
    for (const round of this.rounds) {
      if (!round.results[index]) {
        round.results[index] = { failure: reason };
      }
    }
    for (const round of [...this.rounds]) {
      this.settle(round);
    }
    if (this.sides.every((candidate) => candidate.failure)) {
      this.reportTotalFailure(reason);
    }
  }

  private reportTotalFailure(reason: string): void {
    if (this.errorEmitted || this.closed) {
      return;
    }
    this.errorEmitted = true;
    this.emit("error", new Error(`Both speech-to-text models failed: ${reason}`));
  }

  // Deliver a round once every model has answered or failed; if only one has answered,
  // give the other a bounded time.
  private settle(round: Round): void {
    if (round.done || this.closed) {
      return;
    }
    const answered = round.results.filter((result) => result && !isFailure(result)).length;
    const pending = round.results.filter((result) => !result).length;

    if (pending === 0) {
      if (answered === 0) {
        // Nothing was read at all; the caller's error handling reads the audio again.
        this.finish(round);
        return;
      }
      this.deliver(round);
      return;
    }
    if (answered > 0 && !round.timer) {
      round.timer = setTimeout(() => {
        round.results.forEach((result, index) => {
          if (!result) {
            round.results[index] = { failure: "it did not finish in time" };
          }
        });
        this.logger.warn({ segmentId: round.segmentId }, "dual_stt.straggler_gave_up");
        this.deliver(round);
      }, this.stragglerGraceMs);
    }
  }

  private finish(round: Round): void {
    round.done = true;
    if (round.timer) clearTimeout(round.timer);
    const at = this.rounds.indexOf(round);
    if (at >= 0) this.rounds.splice(at, 1);
  }

  private deliver(round: Round): void {
    if (round.done) {
      return;
    }
    this.finish(round);

    const answered = round.results
      .map((result, index) => ({ result, index }))
      .filter(
        (entry): entry is { result: SideResult; index: number } =>
          Boolean(entry.result) && !isFailure(entry.result),
      );
    const everyAnswerEmpty = answered.every((entry) => entry.result.text.trim().length === 0);
    const allLowConfidence = answered.every(
      (entry) => entry.result.isLowConfidence === true || entry.result.text.trim().length === 0,
    );

    // Silence or noise: say nothing, so it is treated like any other empty turn.
    if (everyAnswerEmpty) {
      this.emit("transcript", {
        segmentId: round.segmentId,
        transcript: "",
        isFinal: true,
        ...(allLowConfidence ? { isLowConfidence: true } : {}),
      });
      return;
    }

    const lines = round.results.map((result, index) => {
      const label = this.sides[index].label;
      if (!result || isFailure(result)) {
        const reason = result && isFailure(result) ? result.failure : "not available";
        return `[${label}] (no text: ${reason})`;
      }
      const text = result.text.trim();
      return `[${label}] ${text.length > 0 ? text : "(nothing recognized)"}`;
    });
    const primaryResult = round.results[0];
    const language =
      primaryResult && !isFailure(primaryResult) ? primaryResult.language : undefined;
    this.emit("transcript", {
      segmentId: round.segmentId,
      transcript: lines.join("\n"),
      isFinal: true,
      ...(language ? { language } : {}),
    });
  }
}
