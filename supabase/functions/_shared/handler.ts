import { allowedOrigin, ApiError, jsonResponse, preflight } from "./http.ts";

export function serve(handler: (request: Request) => Promise<Response>): void {
  Deno.serve(async (request) => {
    const optionsResponse = preflight(request);
    if (optionsResponse) return optionsResponse;
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigin(origin)) {
      return jsonResponse(request, { error: "origin_not_allowed" }, 403);
    }
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof ApiError) return jsonResponse(request, { error: error.code }, error.status);
      console.error("edge_function_failure", { name: error instanceof Error ? error.name : "UnknownError" });
      return jsonResponse(request, { error: "internal_error" }, 500);
    }
  });
}
