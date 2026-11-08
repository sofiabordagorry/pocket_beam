defmodule PocketBeam.MixProject do
  use Mix.Project

  def project do
    [
      app: :pocket_beam,
      version: "0.1.0",
      elixir: "~> 1.20",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {PocketBeam.Application, []}
    ]
  end

  defp deps do
    [
      {:popcorn, "~> 1.0"},
      {:ecto_sql, "~> 3.13"},
      # Only needed at compile time: it makes Ecto's Postgres SQL generator
      # available. Nothing connects to a database in the browser.
      {:postgrex, "~> 0.20", runtime: false}
    ]
  end
end
