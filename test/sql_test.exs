defmodule PocketBeam.SQLTest do
  use ExUnit.Case, async: true

  alias PocketBeam.SQL

  test "replaces each placeholder with its value" do
    assert SQL.inline(~s(SELECT * FROM "users" WHERE age >= $1 AND name = $2), [18, "Sofi"]) ==
             ~s(SELECT * FROM "users" WHERE age >= 18 AND name = 'Sofi')
  end

  test "escapes single quotes in strings" do
    assert SQL.inline("WHERE name = $1", ["O'Brien"]) == "WHERE name = 'O''Brien'"
  end

  test "does not confuse $1 with $10" do
    params = Enum.to_list(1..10)
    assert SQL.inline("$1, $10", params) == "1, 10"
  end

  test "leaves placeholders inside strings and identifiers alone" do
    assert SQL.inline(~s(SELECT '$1', "$1" WHERE x = $1), [7]) == ~s(SELECT '$1', "$1" WHERE x = 7)
  end

  test "writes NULL, booleans, decimals, dates, arrays and maps as Postgres literals" do
    sql = "VALUES ($1, $2, $3, $4, $5, $6)"
    params = [nil, true, Decimal.new("9.90"), ~D[2026-11-12], ["a", "b"], %{"k" => 1}]

    assert SQL.inline(sql, params) ==
             ~s|VALUES (NULL, TRUE, 9.90, '2026-11-12', ARRAY['a', 'b'], '{"k":1}')|
  end

  test "writes UUIDs as text" do
    uuid = "2a3b9a3e-6f1d-4c55-9d43-2f6b8d8c1a10"
    assert SQL.inline("WHERE id = $1", [Ecto.UUID.dump!(uuid)]) == "WHERE id = '#{uuid}'"
  end
end
