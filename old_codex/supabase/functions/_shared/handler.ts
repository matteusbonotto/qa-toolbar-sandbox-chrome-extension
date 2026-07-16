import { ApiError, errorResponse, preflight } from "./http.ts";

export function serve(handler: (request: Request) => Promise<Response>): void {
  Deno.serve(async (request) => {
    const optionsResponse = preflight(request);
    if (optionsResponse) return optionsResponse;
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(request, error.status, error.code);
      console.error("edge_function_failure", { name: error instanceof Error ? error.name : "UnknownError" });
      return errorResponse(request, 500, "internal_error");
    }
  });
}
