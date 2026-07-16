import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

afterEach(cleanup);

describe("App", () => {
  it("fails closed with a configuration error instead of rendering any privileged screen when Supabase env vars are missing", async () => {
    render(<App />);
    expect(await screen.findByText("Configuração ausente")).toBeTruthy();
    expect(screen.queryByText("Painel Administrativo")).toBeNull();
    expect(screen.queryByRole("button", { name: /Entrar com Google/i })).toBeNull();
  });
});
