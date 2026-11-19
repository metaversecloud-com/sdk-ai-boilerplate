import { APP_PORT } from "../constants";

/**
 * Opens a server-sent-event stream of the app the way a drawer's EventSource does, from Node, e.g.
 * openStream(world.api("/sse")) or openStream(world.apiAs(43, "/sse")). Returns the status, the
 * `data:` messages parsed as JSON so far (the array fills up as they arrive; poll it with
 * expect.poll(() => stream.messages)) and close(), which hangs up: the stream never ends on its own,
 * so always close it (e.g. in a finally).
 */
export const openStream = async (path: string) => {
  const controller = new AbortController();
  const response = await fetch(`http://localhost:${APP_PORT}${path}`, { signal: controller.signal });
  const messages: any[] = [];
  const pump = (async () => {
    if (!response.body) return;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block.split("\n").find((line) => line.startsWith("data: "));
          if (data) messages.push(JSON.parse(data.slice(6)));
        }
      }
    } catch {
      // Aborted by close().
    }
  })();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    messages,
    close: async () => {
      controller.abort();
      await pump;
    },
  };
};
