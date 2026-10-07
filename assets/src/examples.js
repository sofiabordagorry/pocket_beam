export const EXAMPLES = {
  elixir: [
    {
      name: "Hello, Elixir",
      code: `# Everything here runs in your browser, on a real BEAM.
defmodule Greeter do
  def greet(%{name: name, lang: :es}), do: "¡Hola, #{name}!"
  def greet(%{name: name}), do: "Hello, #{name}!"
end

[%{name: "Sofi", lang: :es}, %{name: "José"}]
|> Enum.map(&Greeter.greet/1)
|> Enum.each(&IO.puts/1)

String.upcase("elixir") |> String.graphemes() |> Enum.frequencies()
`,
    },
    {
      name: "1,000 processes",
      code: `# Spawn 1,000 processes. Each one sends its result back.
parent = self()

pids =
  for i <- 1..1_000 do
    spawn(fn -> send(parent, {:square, i, i * i}) end)
  end

squares = for _ <- pids, do: receive(do: ({:square, _i, sq} -> sq))

IO.puts("I am #{inspect(self())} and I talked to #{length(pids)} processes")
Enum.sum(squares)
`,
    },
    {
      name: "Type errors (1.20)",
      code: `# Elixir 1.20 infers types and warns about bugs before running.
# Look at the warnings and the underlined lines.
defmodule Cart do
  def total(items) when is_list(items) do
    Enum.reduce(items, 0, fn %{price: price, qty: qty}, acc -> acc + price * qty end)
  end

  def label(count) when is_integer(count), do: "#{count} items"

  def broken do
    label("three")
  end

  def also_broken do
    total(:not_a_list) + 1
  end
end

Cart.total([%{price: 10, qty: 2}, %{price: 5, qty: 1}])
`,
    },
    {
      name: "GenServer",
      code: `defmodule Counter do
  use GenServer

  def start_link(initial), do: GenServer.start_link(__MODULE__, initial)
  def increment(pid), do: GenServer.cast(pid, :increment)
  def value(pid), do: GenServer.call(pid, :value)

  @impl true
  def init(initial), do: {:ok, initial}

  @impl true
  def handle_cast(:increment, count), do: {:noreply, count + 1}

  @impl true
  def handle_call(:value, _from, count), do: {:reply, count, count}
end

{:ok, pid} = Counter.start_link(0)
for _ <- 1..41, do: Counter.increment(pid)
Counter.increment(pid)
Counter.value(pid)
`,
    },
    {
      name: "Let it crash",
      code: `# A supervisor restarts its children when they crash.
children = [
  %{id: :worker, start: {Agent, :start_link, [fn -> 0 end, [name: :worker]]}}
]

{:ok, _sup} = Supervisor.start_link(children, strategy: :one_for_one)

before = Process.whereis(:worker)
Process.exit(before, :kill)
Process.sleep(50)
later = Process.whereis(:worker)

IO.puts("before: #{inspect(before)}")
IO.puts("after:  #{inspect(later)}")
{:restarted?, before != later}
`,
    },
    {
      name: "Regex & dates",
      code: `# Full OTP: regexes, dates and the rest of the standard library.
text = "Elixir 1.20 shipped on 2026-06-03, OTP 29 a few weeks before."

versions = Regex.scan(~r/\\d+\\.\\d+/, text) |> List.flatten()
[date] = Regex.run(~r/\\d{4}-\\d{2}-\\d{2}/, text)

released = Date.from_iso8601!(date)

%{
  versions: versions,
  released: released,
  weekday: Date.day_of_week(released),
  days_until_2027: Date.diff(~D[2027-01-01], released)
}
`,
    },
  ],
  ecto: [
    {
      name: "Query with a join",
      code: `# Write schemas and a query. The last value becomes Postgres SQL.
# No database involved: Ecto generates the SQL right here.
defmodule User do
  use Ecto.Schema

  schema "users" do
    field :name, :string
    field :age, :integer
    has_many :posts, Post
  end
end

defmodule Post do
  use Ecto.Schema

  schema "posts" do
    field :title, :string
    field :published, :boolean
    belongs_to :user, User
  end
end

import Ecto.Query

min_age = 18

from u in User,
  join: p in assoc(u, :posts),
  where: u.age >= ^min_age and p.published,
  group_by: u.id,
  order_by: [desc: count(p.id)],
  select: %{name: u.name, posts: count(p.id)},
  limit: 10
`,
    },
    {
      name: "Changeset validations",
      code: `# If the last value is a changeset, you see its changes and errors.
defmodule User do
  use Ecto.Schema
  import Ecto.Changeset

  schema "users" do
    field :name, :string
    field :email, :string
    field :age, :integer
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :age])
    |> validate_required([:name, :email])
    |> validate_format(:email, ~r/@/)
    |> validate_number(:age, greater_than_or_equal_to: 18)
  end
end

User.changeset(%User{}, %{"email" => "sofi.at.example", "age" => "16"})
`,
    },
    {
      name: "Composable queries",
      code: `# Build a query step by step from optional filters.
defmodule Product do
  use Ecto.Schema

  schema "products" do
    field :name, :string
    field :price, :decimal
    field :category, :string
    field :in_stock, :boolean
  end
end

defmodule Catalog do
  import Ecto.Query

  def search(filters) do
    Enum.reduce(filters, from(p in Product), fn
      {:category, c}, q -> where(q, [p], p.category == ^c)
      {:max_price, max}, q -> where(q, [p], p.price <= ^max)
      {:in_stock, true}, q -> where(q, [p], p.in_stock)
      {:search, term}, q -> where(q, [p], ilike(p.name, ^"%#{term}%"))
      _, q -> q
    end)
    |> order_by([p], asc: p.price)
  end
end

Catalog.search(category: "books", max_price: Decimal.new("30"), in_stock: true, search: "elixir")
`,
    },
    {
      name: "Subquery",
      code: `defmodule Order do
  use Ecto.Schema

  schema "orders" do
    field :customer_id, :integer
    field :total, :decimal
    field :inserted_at, :naive_datetime
  end
end

import Ecto.Query

big_spenders =
  from o in Order,
    group_by: o.customer_id,
    having: sum(o.total) > 1000,
    select: %{customer_id: o.customer_id, spent: sum(o.total)}

from s in subquery(big_spenders),
  order_by: [desc: s.spent],
  select: {s.customer_id, s.spent}
`,
    },
  ],
};
