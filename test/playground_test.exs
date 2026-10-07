defmodule PlaygroundTest do
  use ExUnit.Case, async: false

  defp run(mode, code), do: GenServer.call(:playground, ["run", mode, code], 20_000)

  describe "elixir mode" do
    test "returns the result and what the snippet printed" do
      result = run("elixir", ~S'IO.puts("hi")
1 + 1')

      assert result.ok
      assert result.result == "2"
      assert result.stdout == "hi\n"
    end

    test "processes work" do
      result =
        run("elixir", ~S'''
        parent = self()
        for i <- 1..1000, do: spawn(fn -> send(parent, i) end)
        Enum.sum(for _ <- 1..1000, do: receive(do: (n -> n)))
        ''')

      assert result.result == "500500"
    end

    test "reports Elixir 1.20 type warnings with their line" do
      result =
        run("elixir", ~S'''
        defmodule M do
          def f(x) when is_integer(x), do: x + 1
          def g, do: f("two")
        end
        ''')

      assert [%{severity: "warning", line: 3, message: message}] = result.diagnostics
      assert message =~ "incompatible types given to f/1"
      refute message =~ "\e["
    end

    test "exceptions come back as the result" do
      result = run("elixir", ~S'Map.fetch!(%{}, :missing)')

      refute result.ok
      assert result.result =~ "KeyError"
    end

    test "an infinite loop is stopped and the server keeps working" do
      task = Task.async(fn -> run("elixir", "Stream.repeatedly(fn -> :ok end) |> Stream.run()") end)
      assert run("elixir", "40 + 2").result == "42"
      assert Task.await(task, 20_000).result =~ "Timeout"
    end
  end

  describe "ecto mode" do
    @schemas ~S'''
    defmodule User do
      use Ecto.Schema
      import Ecto.Changeset

      schema "users" do
        field :name, :string
        field :age, :integer
        has_many :posts, Post
      end

      def changeset(user, attrs) do
        user
        |> cast(attrs, [:name, :age])
        |> validate_required([:name])
        |> validate_number(:age, greater_than_or_equal_to: 18)
      end
    end

    defmodule Post do
      use Ecto.Schema

      schema "posts" do
        field :title, :string
        belongs_to :user, User
      end
    end

    import Ecto.Query
    '''

    test "a query becomes Postgres SQL with its params" do
      result =
        run("ecto", @schemas <> ~S'''
        min = 18
        from u in User, join: p in assoc(u, :posts), where: u.age >= ^min, select: u.name
        ''')

      assert result.kind == "sql"
      assert result.sql =~ ~s(INNER JOIN "posts" AS p1 ON p1."user_id" = u0."id")
      assert result.sql =~ "$1"
      assert result.params == ["18"]
    end

    test "a query without select selects every field, like Repo.all" do
      result = run("ecto", @schemas <> ~S'where(User, [u], u.age > 30)')

      assert result.kind == "sql"
      assert result.sql =~ ~s(SELECT u0."id", u0."name", u0."age" FROM "users" AS u0)
    end

    test "a schema module alone becomes a SELECT of the table" do
      assert run("ecto", @schemas <> "User").sql =~ ~s(FROM "users" AS u0)
    end

    test "any other value is just shown, even a string" do
      result = run("ecto", ~S'"not a table"')

      assert result.ok
      assert result.kind == "value"
      assert result.result == ~S'"not a table"'
    end

    test "a changeset shows whether it is valid and its errors" do
      result = run("ecto", @schemas <> ~S'User.changeset(%User{}, %{"age" => "12"})')

      assert result.kind == "changeset"
      refute result.changeset.valid
      fields = Enum.map(result.changeset.errors, & &1.field)
      assert "name" in fields
      assert "age" in fields
    end
  end
end
