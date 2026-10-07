defmodule PocketBeam.SQL do
  @moduledoc """
  Turns an Ecto query into Postgres SQL without a database.

  It does what `Repo.to_sql/2` does internally (plan, normalize, generate),
  but without a running `Repo` or a connection.
  """

  @adapter Ecto.Adapters.Postgres

  @spec to_sql(Ecto.Queryable.t()) :: {String.t(), [term()]}
  def to_sql(queryable) do
    # Like Repo.all/2: a query without `select` selects the whole schema.
    query = queryable |> Ecto.Queryable.to_query() |> Ecto.Query.Planner.ensure_select(true)
    {planned, params, _cache_key} = Ecto.Query.Planner.plan(query, :all, @adapter)
    {normalized, _select} = Ecto.Query.Planner.normalize(planned, :all, @adapter, 0)

    sql = normalized |> Ecto.Adapters.Postgres.Connection.all() |> IO.iodata_to_binary()
    {sql, Enum.map(params, fn {_cast, dump} -> dump end)}
  end

  @doc """
  Replaces the `$1`, `$2`… placeholders with the parameters written as
  Postgres literals, so the query can be pasted into `psql`.

  Placeholders inside quoted strings or identifiers are left alone. This is
  for reading and debugging: the database never receives this string.
  """
  @spec inline(String.t(), [term()]) :: String.t()
  def inline(sql, params) do
    literals = params |> Enum.map(&literal/1) |> List.to_tuple()
    sql |> scan(literals, :code, []) |> IO.iodata_to_binary()
  end

  defp scan(<<>>, _literals, _state, acc), do: Enum.reverse(acc)

  defp scan(<<"'", rest::binary>>, literals, :code, acc), do: scan(rest, literals, :string, ["'" | acc])
  defp scan(<<"'", rest::binary>>, literals, :string, acc), do: scan(rest, literals, :code, ["'" | acc])
  defp scan(<<"\"", rest::binary>>, literals, :code, acc), do: scan(rest, literals, :identifier, ["\"" | acc])
  defp scan(<<"\"", rest::binary>>, literals, :identifier, acc), do: scan(rest, literals, :code, ["\"" | acc])

  defp scan(<<"$", rest::binary>>, literals, :code, acc) do
    case Integer.parse(rest) do
      {n, rest} when n >= 1 and n <= tuple_size(literals) ->
        scan(rest, literals, :code, [elem(literals, n - 1) | acc])

      _ ->
        scan(rest, literals, :code, ["$" | acc])
    end
  end

  defp scan(<<char::utf8, rest::binary>>, literals, state, acc), do: scan(rest, literals, state, [<<char::utf8>> | acc])

  # --- Postgres literals ---

  defp literal(nil), do: "NULL"
  defp literal(true), do: "TRUE"
  defp literal(false), do: "FALSE"
  defp literal(n) when is_integer(n), do: Integer.to_string(n)
  defp literal(n) when is_float(n), do: Float.to_string(n)
  defp literal(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp literal(%Date{} = d), do: quote_string(Date.to_iso8601(d))
  defp literal(%Time{} = t), do: quote_string(Time.to_iso8601(t))
  defp literal(%NaiveDateTime{} = dt), do: quote_string(NaiveDateTime.to_iso8601(dt))
  defp literal(%DateTime{} = dt), do: quote_string(DateTime.to_iso8601(dt))
  defp literal(list) when is_list(list), do: "ARRAY[" <> Enum.map_join(list, ", ", &literal/1) <> "]"
  defp literal(map) when is_map(map) and not is_struct(map), do: quote_string(JSON.encode!(map))

  defp literal(binary) when is_binary(binary) do
    cond do
      String.valid?(binary) -> quote_string(binary)
      # Ecto dumps UUIDs as 16 raw bytes.
      byte_size(binary) == 16 -> quote_string(Ecto.UUID.load!(binary))
      true -> "'\\x" <> Base.encode16(binary, case: :lower) <> "'::bytea"
    end
  end

  defp literal(other), do: quote_string(inspect(other))

  defp quote_string(string), do: "'" <> String.replace(string, "'", "''") <> "'"
end
