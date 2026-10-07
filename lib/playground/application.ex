defmodule Playground.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    # Snippets define modules over and over (`defmodule User`). Don't warn about it.
    Code.put_compiler_option(:ignore_module_conflict, true)

    children = [Playground.Server] ++ bridge()
    Supervisor.start_link(children, strategy: :one_for_one, name: Playground.Supervisor)
  end

  # Popcorn.Proxy only exists in the browser runtime; `mix test` runs without it.
  defp bridge do
    if Popcorn.Wasm.available?(), do: [Popcorn.Proxy], else: []
  end
end
