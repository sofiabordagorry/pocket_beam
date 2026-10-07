defmodule PocketBeam.Runner do
  @moduledoc """
  Compiles and evaluates a snippet, capturing what it prints, its result and
  the compiler diagnostics (including Elixir's type warnings).

  In `"ecto"` mode, the last value of the snippet is turned into something
  useful: an `Ecto.Query` becomes Postgres SQL, an `Ecto.Changeset` shows its
  changes and errors.
  """

  @ansi ~r/\e\[[0-9;]*m/

  def run(mode, code) do
    {:ok, io} = StringIO.open("")
    Process.group_leader(self(), io)
    started = System.monotonic_time(:millisecond)

    {outcome, diagnostics} =
      Code.with_diagnostics([log: false], fn ->
        try do
          {:ok, eval_sequentially(code)}
        rescue
          e -> {:error, Exception.format(:error, e, prune(__STACKTRACE__))}
        catch
          kind, reason -> {:error, Exception.format(kind, reason, prune(__STACKTRACE__))}
        end
      end)

    {_input, stdout} = StringIO.contents(io)

    base = %{
      stdout: stdout,
      diagnostics: Enum.map(diagnostics, &diagnostic/1),
      time_ms: System.monotonic_time(:millisecond) - started
    }

    case outcome do
      {:ok, value} -> Map.merge(base, present(mode, value))
      {:error, message} -> Map.merge(base, %{ok: false, result: message})
    end
  end

  # Evaluates top-level expressions one at a time, like IEx does, carrying
  # variables, imports and aliases forward. This lets a snippet define
  # `defmodule User` and then use `%User{}` a few lines below.
  defp eval_sequentially(code) do
    quoted = Code.string_to_quoted!(code, file: "snippet.exs", columns: true)

    exprs =
      case quoted do
        {:__block__, _, exprs} -> exprs
        expr -> [expr]
      end

    env = Code.env_for_eval(file: "snippet.exs")

    {value, _binding, _env} =
      Enum.reduce(exprs, {nil, [], env}, fn expr, {_value, binding, env} ->
        Code.eval_quoted_with_env(expr, binding, env)
      end)

    value
  end

  # --- Presenting the result ---

  defp present("ecto", %Ecto.Changeset{} = changeset) do
    errors =
      Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
        Enum.reduce(opts, msg, fn {key, value}, acc ->
          String.replace(acc, "%{#{key}}", to_string(value))
        end)
      end)

    %{
      ok: true,
      kind: "changeset",
      result: inspect(changeset, pretty: true),
      changeset: %{
        valid: changeset.valid?,
        changes: inspect(changeset.changes, pretty: true),
        errors: Enum.map(errors, fn {field, msgs} -> %{field: to_string(field), messages: msgs} end)
      }
    }
  end

  defp present("ecto", value) do
    case query?(value) do
      false ->
        %{ok: true, kind: "value", result: inspect(value, pretty: true)}

      true ->
        try do
          {sql, params} = PocketBeam.SQL.to_sql(value)
          %{
            ok: true,
            kind: "sql",
            result: inspect(value, pretty: true),
            sql: sql,
            params: Enum.map(params, &inspect/1),
            inlined: PocketBeam.SQL.inline(sql, params)
          }
        rescue
          e -> %{ok: false, result: Exception.format(:error, e, prune(__STACKTRACE__))}
        end
    end
  end

  defp present(_mode, value), do: %{ok: true, kind: "value", result: inspect(value, pretty: true)}

  # Strings and tuples are queryable too (`from "users"`), but a snippet that
  # ends in a string almost never means "give me the SQL for that table".
  defp query?(%Ecto.Query{}), do: true
  defp query?(module) when is_atom(module), do: function_exported?(module, :__schema__, 1)
  defp query?(_), do: false

  # --- Helpers ---

  defp diagnostic(d) do
    {line, column} =
      case d.position do
        {l, c} -> {l, c}
        l when is_integer(l) -> {l, nil}
        _ -> {nil, nil}
      end

    %{
      severity: to_string(d.severity),
      message: Regex.replace(@ansi, d.message, ""),
      line: line,
      column: column
    }
  end

  # Hide our own frames from stacktraces.
  defp prune(stacktrace) do
    Enum.take_while(stacktrace, fn
      {PocketBeam.Runner, _, _, _} -> false
      {:elixir, _, _, _} -> false
      {:erl_eval, _, _, _} -> false
      _ -> true
    end)
  end
end
