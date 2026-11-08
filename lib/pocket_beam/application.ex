defmodule PocketBeam.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    # Snippets define modules over and over (`defmodule User`). Don't warn about it.
    Code.put_compiler_option(:ignore_module_conflict, true)

    children = [PocketBeam.Server]
    Supervisor.start_link(children, strategy: :one_for_one, name: PocketBeam.Supervisor)
  end
end
