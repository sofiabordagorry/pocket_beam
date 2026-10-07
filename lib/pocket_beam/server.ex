defmodule PocketBeam.Server do
  @moduledoc """
  Receives requests from the page through `Popcorn.Proxy`.

  Every run happens in its own process with a timeout, so an infinite loop
  in a snippet never blocks the app: the BEAM preempts it and we
  kill it when time is up.
  """

  use GenServer

  @name :pocket_beam
  @timeout_ms 10_000

  def start_link(_opts), do: GenServer.start_link(__MODULE__, nil, name: @name)

  @impl true
  def init(_), do: {:ok, nil}

  @impl true
  def handle_call("info", _from, state) do
    info = %{
      elixir: System.version(),
      otp: List.to_string(:erlang.system_info(:otp_release)),
      ecto: Application.spec(:ecto, :vsn) |> to_string()
    }

    {:reply, info, state}
  end

  def handle_call(["run", mode, code], from, state) when mode in ["elixir", "ecto"] do
    # Reply from a separate process so the server keeps answering while a
    # snippet runs (or loops forever).
    spawn(fn -> GenServer.reply(from, run_with_timeout(mode, code)) end)
    {:noreply, state}
  end

  defp run_with_timeout(mode, code) do
    task = Task.async(fn -> PocketBeam.Runner.run(mode, code) end)

    case Task.yield(task, @timeout_ms) || Task.shutdown(task, :brutal_kill) do
      {:ok, result} ->
        result

      _ ->
        %{
          ok: false,
          result: "** Timeout: the code ran for more than #{div(@timeout_ms, 1000)} seconds and was stopped.",
          stdout: "",
          diagnostics: [],
          time_ms: @timeout_ms
        }
    end
  end
end
