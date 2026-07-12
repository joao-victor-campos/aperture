-- Seed data for the Playwright E2E suite. Known, deterministic ground truth:
--   customers: 100 rows, names 'Customer 1'..'Customer 100'
--   orders:    250 rows referencing customers
CREATE TABLE customers (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  signup_date date NOT NULL,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO customers (id, name, email, signup_date, active)
SELECT g,
       'Customer ' || g,
       'customer' || g || '@example.com',
       DATE '2024-01-01' + (g % 365),
       g % 7 <> 0
FROM generate_series(1, 100) AS g;

CREATE TABLE orders (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id),
  amount numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL
);

INSERT INTO orders (id, customer_id, amount, created_at)
SELECT g,
       (g % 100) + 1,
       (g * 3.5)::numeric(10,2),
       TIMESTAMPTZ '2024-06-01 00:00:00+00' + (g || ' hours')::interval
FROM generate_series(1, 250) AS g;
