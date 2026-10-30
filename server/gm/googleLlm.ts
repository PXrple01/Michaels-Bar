// Claude über Google Vertex AI (Testphase) – mit automatischem Rückweg zur Anthropic-API.
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { GoogleError, isProviderFailure, type GoogleCloud } from "../google";
import { apiErrorText, type LlmClient, type Message } from "./narrator";

type StreamParams = Parameters<LlmClient["stream"]>[0];

/** Vertex kennt das server-seitige Ersatzmodell nicht – Option und Beta entfernen. */
function forVertex(params: StreamParams): StreamParams {
  const { fallbacks: _, ...rest } = params as StreamParams & { fallbacks?: unknown };
  return { ...rest, betas: rest.betas?.filter((b) => !String(b).startsWith("server-side-fallback")) } as StreamParams;
}

class VertexLlm implements LlmClient {
  constructor(private g: GoogleCloud) {}
  async stream(params: StreamParams, onText: (text: string) => void, signal?: AbortSignal): Promise<Message> {
    const client = new AnthropicVertex({ region: this.g.cfg.region, projectId: this.g.cfg.projectId, accessToken: await this.g.token(), maxRetries: 1 });
    const stream = client.beta.messages.stream(forVertex(params) as never, { signal });
    stream.on("text", onText);
    return (await stream.finalMessage()) as unknown as Message;
  }
}

/**
 * Im Zeitfenster Vertex, sonst (oder wenn Vertex vor der ersten Ausgabe ablehnt) die Anthropic-API.
 * Ist schon Text geflossen, wird nicht gewechselt – sonst stünde die Erzählung doppelt da.
 */
export class SwitchingLlm implements LlmClient {
  private vertex: VertexLlm;
  constructor(private g: GoogleCloud, private backup: LlmClient | null) { this.vertex = new VertexLlm(g); }

  async stream(params: StreamParams, onText: (text: string) => void, signal?: AbortSignal): Promise<Message> {
    if (!this.g.active()) {
      if (!this.backup) throw new Error("Kein Spielleiter erreichbar: Die Google-Testphase ist vorbei und ANTHROPIC_API_KEY fehlt.");
      return this.backup.stream(params, onText, signal);
    }
    let emitted = false;
    try {
      return await this.vertex.stream(params, (t) => { emitted = true; onText(t); }, signal);
    } catch (e) {
      if (emitted || signal?.aborted || !this.backup) throw e;
      const status = e instanceof GoogleError ? e.status : e instanceof Anthropic.APIError ? e.status : undefined;
      // Zugang, Guthaben oder Kontingent: eine Weile ganz zurück. Andere Fehler: nur diesen Aufruf über Anthropic.
      if (isProviderFailure(status)) this.g.markBroken("Claude (Vertex)", apiErrorText(e));
      else console.warn(`[Google] Claude (Vertex) fehlgeschlagen (${apiErrorText(e)}) – dieser Aufruf über Anthropic.`);
      return this.backup.stream(params, onText, signal);
    }
  }
}
