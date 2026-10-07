defmodule Playground.SQL do
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
end
